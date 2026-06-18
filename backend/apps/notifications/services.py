from __future__ import annotations

import json
import logging
import random
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django_celery_beat.models import ClockedSchedule, PeriodicTask

from .models import Event

logger = logging.getLogger(__name__)

# Dotted path of the task beat dispatches to fire one event. Stored on the
# PeriodicTask row, so it lives as a string here (importing the task would be a
# needless cycle).
FIRE_TASK = "apps.notifications.tasks.fire_event"

# Name prefix for the per-event one-off PeriodicTask rows. The name is a pure
# function of the event id, so the row can always be found without storing a
# reference. CRITICAL: ``sync_scheduled_tasks`` must exclude this prefix from
# pruning, or every sync would delete all armed fire schedules.
FIRE_TASK_NAME_PREFIX = "fire-event-"

# Slack allowed when deciding "is this event due yet?". A clocked row beat
# dispatched whose event has since been pushed more than this into the future is
# treated as a stale dispatch: it defers instead of firing. One second keeps us
# within the second-accuracy target.
RETIME_TOLERANCE = timedelta(seconds=1)

# Rolling horizon for arming. The windower (``sync_event_window``, every 10s) arms
# only events due within this many seconds and disarms SCHEDULED events pushed
# back beyond it, so the number of clocked beat rows tracks "events firing soon",
# not the entire future backlog — which can be millions of rows.
WINDOW_SECONDS = 60

# States from which an event can still be fired or re-armed (i.e. not done).
_LIVE_STATUSES = (Event.Status.PENDING, Event.Status.SCHEDULED)


def fire_task_name(event_id: object) -> str:
    """Deterministic ``PeriodicTask.name`` for an event's one-off fire schedule."""
    return f"{FIRE_TASK_NAME_PREFIX}{event_id}"


@transaction.atomic
def generate_future_events(count: int = 5, within_minutes: int = 20) -> list[Event]:
    """Create ``count`` pending events at random times across the next
    ``within_minutes`` minutes, starting from now.

    With the defaults this produces 5 events scattered randomly over the next
    20 minutes. Returns the created events, ordered by scheduled time.

    Arming is intentionally left to the windower (``sync_event_window``): events
    are created PENDING and only get a clocked beat row once they enter the 60s
    horizon, so creating a large backlog stays cheap.
    """
    if count < 1:
        raise ValueError("count must be >= 1")
    if within_minutes <= 0:
        raise ValueError("within_minutes must be > 0")

    now = timezone.now()
    # Scatter `count` events at random offsets within the window. Each offset is a
    # random fraction of the window, so events are unevenly spaced. Sort so the
    # returned list (and the `Generated event N` titles) run in chronological
    # order.
    window_seconds = within_minutes * 60
    offsets = sorted(random.uniform(0, window_seconds) for _ in range(count))

    events = [
        Event(
            title=f"Generated event {i + 1}",
            message=f"Auto-generated event firing within {within_minutes} minutes.",
            scheduled_time=now + timedelta(seconds=offset),
        )
        for i, offset in enumerate(offsets)
    ]
    return Event.objects.bulk_create(events)


# ── Exact-time scheduling via clocked beat tasks ─────────────────────────────


def _write_clocked_task(event: Event) -> None:
    """Create or update the one-off ``PeriodicTask`` (+ its ``ClockedSchedule``)
    that beat dispatches to fire ``event`` at ``scheduled_time``.

    Idempotent: keyed on the deterministic name, so retries and re-times both
    converge on a single row pointing at a schedule for the current time.
    """
    schedule, _ = ClockedSchedule.objects.get_or_create(
        clocked_time=event.scheduled_time
    )
    PeriodicTask.objects.update_or_create(
        name=fire_task_name(event.id),
        defaults={
            "task": FIRE_TASK,
            "clocked": schedule,
            "interval": None,
            "crontab": None,
            "one_off": True,
            "enabled": True,
            "args": json.dumps([str(event.id)]),
        },
    )


def _teardown_clocked_task(event_id: object) -> None:
    """Delete the per-event fire ``PeriodicTask``. Beat auto-disables a one-off
    row after it dispatches, but we delete so the beat tables don't grow
    unbounded. The now-orphaned ``ClockedSchedule`` is swept by the cleanup task.
    """
    PeriodicTask.objects.filter(name=fire_task_name(event_id)).delete()


def _arm_event(event: Event) -> bool:
    """Arm a one-off clocked ``fire_event`` task for ``event`` at its
    ``scheduled_time``.

    Transitions PENDING → SCHEDULED. The claim is done *before* writing the beat
    row so the status guard (``PENDING``) is the dedup lock: a concurrent armer
    that loses the claim never creates an orphan task. Returns ``True`` if this
    call armed it.
    """
    claimed = Event.objects.filter(pk=event.pk, status=Event.Status.PENDING).update(
        status=Event.Status.SCHEDULED
    )
    if not claimed:
        # Already SCHEDULED/FIRED by another pass — nothing to undo.
        return False

    _write_clocked_task(event)
    # Record the PeriodicTask name for inspectability / rollback. Guarded on
    # SCHEDULED so a status that advanced underneath us doesn't get a stale ref.
    Event.objects.filter(pk=event.pk, status=Event.Status.SCHEDULED).update(
        dispatch_task_id=fire_task_name(event.id)
    )
    return True


def _disarm_event(event: Event) -> bool:
    """Return a SCHEDULED event to PENDING and delete its clocked beat row.

    The inverse of ``_arm_event``: used when a re-time pushes an armed event back
    beyond the window. The status-guarded ``SCHEDULED → PENDING`` claim is the
    dedup lock (symmetric with arming), so a concurrent fire/disarm that loses the
    claim leaves the row alone. Returns ``True`` if this call disarmed it.
    """
    claimed = Event.objects.filter(pk=event.pk, status=Event.Status.SCHEDULED).update(
        status=Event.Status.PENDING, dispatch_task_id=None
    )
    if not claimed:
        # Already PENDING/FIRED by another pass — leave any row to fire/cleanup.
        return False

    _teardown_clocked_task(event.id)
    return True


def fire_single_event(event_id: str) -> str:
    """Fire exactly one event by id. Idempotent and re-time-aware — this is the
    body of the clocked ``fire_event`` task and the backstop that keeps a stale
    dispatch from firing at the wrong time.

    Returns a short status string: ``fired`` | ``already_fired`` | ``deferred``
    | ``missing`` | ``noop``.
    """
    now = timezone.now()
    try:
        event = Event.objects.get(pk=event_id)
    except Event.DoesNotExist:
        _teardown_clocked_task(event_id)
        return "missing"

    if event.status == Event.Status.FIRED:
        _teardown_clocked_task(event_id)
        return "already_fired"

    # Pushed into the future since beat dispatched this row → don't fire. Re-settle
    # against the window so a stale near-term row can't fire again before the next
    # windower pass: keep it armed at the new time if still in-window, otherwise
    # disarm (back to PENDING, row deleted; the windower re-arms it later).
    if event.scheduled_time > now + RETIME_TOLERANCE:
        if event.scheduled_time <= now + timedelta(seconds=WINDOW_SECONDS):
            _write_clocked_task(event)
        else:
            _disarm_event(event)
        return "deferred"

    fired = Event.objects.filter(pk=event_id, status__in=_LIVE_STATUSES).update(
        status=Event.Status.FIRED,
        fired_at=now,
    )
    if fired:
        delta = (now - event.scheduled_time).total_seconds()
        logger.info(
            "fired event %s (scheduled %s, %+.3fs)",
            event_id,
            event.scheduled_time.isoformat(),
            delta,
        )
        _teardown_clocked_task(event_id)
        return "fired"
    return "noop"


def retime_event(event: Event) -> None:
    """Handle an event whose ``scheduled_time`` just changed, immediately and
    window-aware, so a re-time to "fire in 5s" doesn't wait for the next windower
    pass:

    - new time within the window → arm (or move the clocked schedule in place if
      already SCHEDULED). No revoke — the schedule simply moves.
    - new time beyond the window → disarm if armed (back to PENDING, row deleted);
      the windower re-arms it once it re-enters the horizon.

    Called from the ``post_save`` signal, so it only runs on genuine ORM saves
    (admin/shell/API) — not on the windower's own ``.update()`` writes.
    """
    if event.status == Event.Status.FIRED:
        return

    in_window = event.scheduled_time <= timezone.now() + timedelta(
        seconds=WINDOW_SECONDS
    )
    if in_window:
        if event.status == Event.Status.SCHEDULED:
            _write_clocked_task(event)
        else:
            _arm_event(event)
    elif event.status == Event.Status.SCHEDULED:
        _disarm_event(event)


def sync_event_window(window_seconds: int = WINDOW_SECONDS) -> tuple[int, int]:
    """Reconcile the armed set to "events due within ``window_seconds``".

    Run periodically (every 10s), this is the steady-state engine *and* the
    backstop for rows created/edited by paths that bypass the ``post_save`` signal
    (bulk writes, ``QuerySet.update``):

    - **Arm forward** every PENDING event due within the horizon (including
      past-due ones — their clocked_time is in the past, so beat fires them at the
      next tick).
    - **Disarm backward** every SCHEDULED event now beyond the horizon (re-timed
      further out): back to PENDING, clocked row deleted.

    The status-guarded ``_arm_event`` / ``_disarm_event`` claims make overlapping
    passes safe. Returns ``(armed, disarmed)``.
    """
    horizon = timezone.now() + timedelta(seconds=window_seconds)

    armed = 0
    for event in Event.objects.filter(
        status=Event.Status.PENDING, scheduled_time__lte=horizon
    ):
        if _arm_event(event):
            armed += 1

    disarmed = 0
    for event in Event.objects.filter(
        status=Event.Status.SCHEDULED, scheduled_time__gt=horizon
    ):
        if _disarm_event(event):
            disarmed += 1

    return armed, disarmed


def cleanup_fired_clocked_tasks() -> int:
    """Delete per-event fire ``PeriodicTask`` rows whose event is gone or already
    FIRED, then sweep ``ClockedSchedule`` rows no task references.

    Backstop against unbounded growth: ``fire_single_event`` deletes a row on a
    successful fire, but this catches rows beat dispatched and disabled without a
    teardown (e.g. a fire that lost the status race). Returns the rows removed.
    """
    removed = 0
    for pt in PeriodicTask.objects.filter(name__startswith=FIRE_TASK_NAME_PREFIX):
        event_id = pt.name[len(FIRE_TASK_NAME_PREFIX) :]
        status = (
            Event.objects.filter(pk=event_id).values_list("status", flat=True).first()
        )
        if status is None or status == Event.Status.FIRED:
            pt.delete()
            removed += 1

    ClockedSchedule.objects.filter(periodictask__isnull=True).delete()
    return removed

from __future__ import annotations

import logging
import random
from datetime import timedelta

from celery import current_app
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Event

logger = logging.getLogger(__name__)

# How far ahead the scheduler arms one-shot fire tasks. Events further out than
# this stay unarmed until a later scheduler pass's window reaches them, which
# bounds how many ETA tasks sit in the broker at once.
SCHEDULE_WINDOW_MINUTES = 10

# Slack allowed when deciding "is this event due yet?". An armed task whose event
# has been pushed more than this into the future is treated as a re-time: it
# defers instead of firing. One second keeps us comfortably within the
# second-accuracy target.
RETIME_TOLERANCE = timedelta(seconds=1)


@transaction.atomic
def generate_future_events(count: int = 5, within_minutes: int = 20) -> list[Event]:
    """Create ``count`` pending events at random times across the next
    ``within_minutes`` minutes, starting from now.

    With the defaults this produces 5 events scattered randomly over the next
    20 minutes. Returns the created events, ordered by scheduled time.

    Arming is intentionally left to the periodic scheduler (and the re-time
    signal) rather than done here, so this stays a pure data-creation helper.
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


# ── Exact-time scheduling ────────────────────────────────────────────────────


def _revoke_dispatch(task_id: str | None) -> None:
    """Best-effort revoke of an armed fire_event task.

    Revoke is not guaranteed to reach a worker; the idempotent, re-time-aware
    ``fire_single_event`` is the real guard against a wrong-time fire. We skip it
    entirely under eager execution (tests), where there is no live task.
    """
    if not task_id or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        return
    try:
        current_app.control.revoke(task_id)
    except Exception:  # pragma: no cover - broker hiccups must not break a save
        logger.warning("failed to revoke dispatch task %s", task_id, exc_info=True)


# States from which an event can still be fired or re-armed (i.e. not done).
_LIVE_STATUSES = (Event.Status.PENDING, Event.Status.SCHEDULED)


def _arm_event(event: Event) -> bool:
    """Arm a one-shot ``fire_event`` task for ``event`` at its ``scheduled_time``.

    Transitions PENDING → SCHEDULED. The claim is done *before* enqueuing so the
    status guard (``PENDING``) is the dedup lock: a concurrent armer that loses
    the claim never creates an orphan task. Returns ``True`` if this call armed
    it.
    """
    from .tasks import fire_event

    claimed = Event.objects.filter(pk=event.pk, status=Event.Status.PENDING).update(
        status=Event.Status.SCHEDULED
    )
    if not claimed:
        # Already SCHEDULED/FIRED by another pass — nothing to undo.
        return False

    result = fire_event.apply_async(args=[str(event.id)], eta=event.scheduled_time)
    # Record the task id for revoke-on-retime. Guarded on SCHEDULED so an inline
    # (eager) fire/defer that already advanced the status doesn't get a stale id.
    Event.objects.filter(pk=event.pk, status=Event.Status.SCHEDULED).update(
        dispatch_task_id=result.id
    )
    return True


def schedule_upcoming_events(window_minutes: int = SCHEDULE_WINDOW_MINUTES) -> int:
    """Arm a one-shot fire task for every PENDING event whose ``scheduled_time``
    falls within the next ``window_minutes`` minutes.

    This is the rolling horizon: run periodically, it arms events (PENDING →
    SCHEDULED) as they enter the window. Past-due PENDING events are included
    (their ETA is in the past, so the worker runs them immediately). Already
    SCHEDULED events are skipped by the status filter. Returns the number armed.
    """
    horizon = timezone.now() + timedelta(minutes=window_minutes)
    upcoming = Event.objects.filter(
        status=Event.Status.PENDING,
        scheduled_time__lte=horizon,
    )

    armed = 0
    for event in upcoming:
        if _arm_event(event):
            armed += 1
    return armed


def fire_single_event(event_id: str) -> str:
    """Fire exactly one event by id. Idempotent and re-time-aware — this is the
    body of the armed ``fire_event`` task and the backstop that keeps a stale ETA
    from firing at the wrong time.

    Returns a short status string: ``fired`` | ``already_fired`` | ``deferred``
    | ``missing`` | ``noop``.
    """
    now = timezone.now()
    try:
        event = Event.objects.get(pk=event_id)
    except Event.DoesNotExist:
        return "missing"

    if event.status == Event.Status.FIRED:
        return "already_fired"

    # Pushed into the future since this task was armed → don't fire. Send it back
    # to PENDING (dropping the arm) so the scheduler re-arms it once its new time
    # re-enters the window.
    if event.scheduled_time > now + RETIME_TOLERANCE:
        Event.objects.filter(pk=event_id).exclude(status=Event.Status.FIRED).update(
            status=Event.Status.PENDING, dispatch_task_id=None
        )
        return "deferred"

    fired = Event.objects.filter(pk=event_id, status__in=_LIVE_STATUSES).update(
        status=Event.Status.FIRED,
        fired_at=now,
    )
    return "fired" if fired else "noop"


def retime_event(event: Event) -> None:
    """Handle an event whose ``scheduled_time`` just changed: revoke the stale
    arm, return it to PENDING, and re-arm immediately if the new time is already
    within the window (otherwise the rolling scheduler picks it up later).

    Called from the ``post_save`` signal, so it only runs on genuine ORM saves
    (admin/shell/API) — not on the scheduler's own ``.update()`` writes.
    """
    if event.status == Event.Status.FIRED:
        return

    if event.dispatch_task_id:
        _revoke_dispatch(event.dispatch_task_id)

    # Reset to a clean PENDING so _arm_event's PENDING-guarded claim can re-arm.
    Event.objects.filter(pk=event.pk).exclude(status=Event.Status.FIRED).update(
        status=Event.Status.PENDING, dispatch_task_id=None
    )
    event.status = Event.Status.PENDING
    event.dispatch_task_id = None

    horizon = timezone.now() + timedelta(minutes=SCHEDULE_WINDOW_MINUTES)
    if event.scheduled_time <= horizon:
        _arm_event(event)


def fire_due_events() -> int:
    """Mark every still-live (PENDING or SCHEDULED) event whose ``scheduled_time``
    has passed as fired.

    This is the low-frequency **sweeper** / durability backstop — it catches
    events whose armed task was lost (worker downtime, broker flush) or that were
    never armed. The exact-time path (``fire_single_event``) is the hot path.
    Returns the number of events fired.
    """
    now = timezone.now()
    due = Event.objects.filter(status__in=_LIVE_STATUSES, scheduled_time__lte=now)
    return due.update(status=Event.Status.FIRED, fired_at=now)

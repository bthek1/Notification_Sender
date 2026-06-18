import json
import random
import uuid
from datetime import timedelta
from itertools import pairwise

import pytest
from django.urls import reverse
from django.utils import timezone
from django_celery_beat.models import ClockedSchedule, PeriodicTask

from apps.notifications.models import Event
from apps.notifications.services import (
    FIRE_TASK,
    _arm_event,
    cleanup_fired_clocked_tasks,
    fire_single_event,
    fire_task_name,
    generate_future_events,
    reconcile_pending_events,
    retime_event,
)
from apps.notifications.tasks import (
    cleanup_fired_clocked_tasks_task,
    fire_event,
    generate_events,
    reconcile_pending_events_task,
)


def _pt(event: Event) -> PeriodicTask | None:
    return PeriodicTask.objects.filter(name=fire_task_name(event.id)).first()


@pytest.mark.django_db
class TestGenerateFutureEvents:
    def test_creates_requested_count(self):
        events = generate_future_events(count=5, within_minutes=20)
        assert len(events) == 5
        assert Event.objects.count() == 5

    def test_events_fall_within_window(self):
        now = timezone.now()
        generate_future_events(count=5, within_minutes=20)
        for event in Event.objects.all():
            assert now < event.scheduled_time <= now + timedelta(minutes=20, seconds=1)

    def test_events_returned_in_chronological_order(self):
        events = generate_future_events(count=10, within_minutes=20)
        times = [e.scheduled_time for e in events]
        assert times == sorted(times)

    def test_events_are_randomly_spaced(self):
        # Seed the RNG so the scatter is deterministic for assertion. With random
        # offsets the gaps between consecutive events should differ — unlike the
        # old evenly-spaced behaviour where every gap was identical.
        random.seed(1234)
        events = generate_future_events(count=8, within_minutes=20)
        times = sorted(e.scheduled_time for e in events)
        gaps = [round((b - a).total_seconds(), 6) for a, b in pairwise(times)]
        # Not all gaps equal -> events are not evenly spaced.
        assert len(set(gaps)) > 1

    def test_all_events_armed_at_creation(self):
        # bulk_create bypasses the post_save signal, so generate arms explicitly:
        # every created event is SCHEDULED with its own clocked PeriodicTask.
        events = generate_future_events(count=3, within_minutes=10)
        assert Event.objects.filter(status=Event.Status.SCHEDULED).count() == 3
        for event in events:
            pt = _pt(event)
            assert pt is not None
            assert pt.clocked.clocked_time == event.scheduled_time

    def test_invalid_count_raises(self):
        with pytest.raises(ValueError, match="count must be"):
            generate_future_events(count=0)

    def test_invalid_window_raises(self):
        with pytest.raises(ValueError, match="within_minutes must be"):
            generate_future_events(within_minutes=0)


@pytest.mark.django_db
class TestTasks:
    def test_generate_events_returns_ids(self):
        ids = generate_events(count=5, within_minutes=20)
        assert len(ids) == 5
        assert Event.objects.filter(id__in=ids).count() == 5

    def test_generate_events_delay(self):
        result = generate_events.delay(count=2, within_minutes=10)
        assert len(result.get()) == 2


@pytest.mark.django_db
class TestEventAPI:
    def test_list_events(self, client):
        generate_future_events(count=3, within_minutes=15)
        url = reverse("event-list")
        response = client.get(url)
        assert response.status_code == 200
        assert len(response.json()) == 3

    def test_generate_action_dispatches_task(self, client, mocker):
        mock_task = mocker.MagicMock()
        mock_task.id = "task-123"
        mock_delay = mocker.patch(
            "apps.notifications.views.generate_events.delay", return_value=mock_task
        )

        url = reverse("event-generate")
        response = client.post(
            url,
            data={"count": 5, "within_minutes": 20},
            content_type="application/json",
        )
        assert response.status_code == 202
        assert response.json()["task_id"] == "task-123"
        mock_delay.assert_called_once_with(count=5, within_minutes=20)

    def test_generate_action_uses_defaults(self, client, mocker):
        mock_delay = mocker.patch("apps.notifications.views.generate_events.delay")
        mock_delay.return_value.id = "x"

        url = reverse("event-generate")
        response = client.post(url, data={}, content_type="application/json")
        assert response.status_code == 202
        mock_delay.assert_called_once_with(count=5, within_minutes=20)

    def test_generate_action_rejects_invalid_count(self, client):
        url = reverse("event-generate")
        response = client.post(url, data={"count": 0}, content_type="application/json")
        assert response.status_code == 400


@pytest.mark.django_db
class TestArmEvent:
    """Arming claims PENDING → SCHEDULED and writes a one-off clocked PeriodicTask."""

    def test_claims_pending_and_writes_clocked_task(self):
        now = timezone.now()
        event = Event.objects.create(
            title="e", scheduled_time=now + timedelta(minutes=3)
        )
        # The create signal already armed it; clear and re-arm to assert directly.
        _pt(event).delete()
        Event.objects.filter(pk=event.pk).update(
            status=Event.Status.PENDING, dispatch_task_id=None
        )
        event.refresh_from_db()

        assert _arm_event(event) is True
        event.refresh_from_db()
        assert event.status == Event.Status.SCHEDULED
        assert event.dispatch_task_id == fire_task_name(event.id)

        pt = _pt(event)
        assert pt is not None
        assert pt.task == FIRE_TASK
        assert pt.one_off is True
        assert pt.enabled is True
        assert json.loads(pt.args) == [str(event.id)]
        assert pt.clocked.clocked_time == event.scheduled_time

    def test_lost_race_returns_false_without_writing(self):
        now = timezone.now()
        event = Event.objects.create(
            title="e",
            scheduled_time=now + timedelta(minutes=3),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="winner",
        )
        # No clocked row exists for it; a lost claim must not create one.
        assert _arm_event(event) is False
        assert _pt(event) is None
        event.refresh_from_db()
        assert event.dispatch_task_id == "winner"  # unchanged

    def test_dedups_clocked_schedule_by_time(self):
        now = timezone.now()
        t = now + timedelta(minutes=4)
        e1 = Event.objects.create(title="a", scheduled_time=t)
        e2 = Event.objects.create(title="b", scheduled_time=t)
        assert _pt(e1).clocked_id == _pt(e2).clocked_id
        assert ClockedSchedule.objects.filter(clocked_time=t).count() == 1


@pytest.mark.django_db
class TestFireSingleEvent:
    def test_fires_due_scheduled_event_and_tears_down(self):
        now = timezone.now()
        event = Event.objects.create(
            title="due", scheduled_time=now - timedelta(seconds=1)
        )
        assert fire_single_event(str(event.id)) == "fired"
        event.refresh_from_db()
        assert event.status == Event.Status.FIRED
        assert event.fired_at is not None
        assert _pt(event) is None  # torn down

    def test_already_fired_is_noop_and_tears_down_stray_row(self):
        now = timezone.now()
        event = Event.objects.create(
            title="done",
            scheduled_time=now - timedelta(seconds=1),
            status=Event.Status.FIRED,
            fired_at=now,
        )
        # A stray clocked row beat dispatched a second time must be cleaned up.
        clocked = ClockedSchedule.objects.create(clocked_time=now)
        PeriodicTask.objects.create(
            name=fire_task_name(event.id), task=FIRE_TASK, clocked=clocked, one_off=True
        )
        assert fire_single_event(str(event.id)) == "already_fired"
        assert _pt(event) is None

    def test_noop_when_fire_update_loses_race(self, mocker):
        # A concurrent fire flips the row out of {pending, scheduled} between our
        # read and our status-guarded UPDATE, so the UPDATE matches 0 rows.
        now = timezone.now()
        event = Event.objects.create(
            title="race", scheduled_time=now - timedelta(seconds=1)
        )
        mocker.patch("django.db.models.query.QuerySet.update", return_value=0)
        assert fire_single_event(str(event.id)) == "noop"

    def test_retimed_later_defers_and_reasserts_arm(self):
        now = timezone.now()
        event = Event.objects.create(
            title="moved",
            scheduled_time=now + timedelta(minutes=5),
            status=Event.Status.SCHEDULED,
            dispatch_task_id=fire_task_name(uuid.uuid4()),
        )
        assert fire_single_event(str(event.id)) == "deferred"
        event.refresh_from_db()
        # Stays SCHEDULED (no bounce to PENDING); arm re-asserted at the new time.
        assert event.status == Event.Status.SCHEDULED
        pt = _pt(event)
        assert pt is not None
        assert pt.clocked.clocked_time == event.scheduled_time

    def test_missing_event_tears_down_stray_row(self):
        ghost_id = uuid.uuid4()
        clocked = ClockedSchedule.objects.create(clocked_time=timezone.now())
        PeriodicTask.objects.create(
            name=fire_task_name(ghost_id), task=FIRE_TASK, clocked=clocked, one_off=True
        )
        assert fire_single_event(str(ghost_id)) == "missing"
        assert not PeriodicTask.objects.filter(name=fire_task_name(ghost_id)).exists()

    def test_fire_event_task_wrapper(self):
        now = timezone.now()
        event = Event.objects.create(
            title="due", scheduled_time=now - timedelta(seconds=1)
        )
        assert fire_event(str(event.id)) == "fired"


@pytest.mark.django_db
class TestRetimeOnSave:
    """Changing a scheduled event's time moves its clocked schedule in place —
    no revoke, no status bounce."""

    def test_changing_time_moves_clocked_schedule_in_place(self):
        now = timezone.now()
        Event.objects.create(title="e", scheduled_time=now + timedelta(minutes=30))
        event = Event.objects.get(title="e")  # reload → _loaded_scheduled_time set
        pt_pk_before = _pt(event).pk
        new_time = now + timedelta(minutes=5)
        event.scheduled_time = new_time
        event.save()

        event.refresh_from_db()
        assert event.status == Event.Status.SCHEDULED
        pt = _pt(event)
        assert pt is not None
        assert pt.clocked.clocked_time == new_time
        # Same row updated in place (not a new task), and exactly one exists.
        assert pt.pk == pt_pk_before
        assert PeriodicTask.objects.filter(name=fire_task_name(event.id)).count() == 1

    def test_retime_of_unarmed_event_arms_it(self):
        now = timezone.now()
        event = Event.objects.create(
            title="f", scheduled_time=now + timedelta(minutes=5)
        )
        # Force it back to an unarmed PENDING state (e.g. a create that bypassed
        # arming): drop the row and reset status.
        PeriodicTask.objects.filter(name=fire_task_name(event.id)).delete()
        Event.objects.filter(pk=event.pk).update(
            status=Event.Status.PENDING, dispatch_task_id=None
        )
        event = Event.objects.get(pk=event.pk)
        event.scheduled_time = now + timedelta(minutes=8)
        event.save()

        event.refresh_from_db()
        assert event.status == Event.Status.SCHEDULED
        assert _pt(event) is not None

    def test_save_without_time_change_keeps_schedule(self):
        now = timezone.now()
        Event.objects.create(title="g", scheduled_time=now + timedelta(minutes=5))
        event = Event.objects.get(title="g")
        before = _pt(event).clocked_id
        event.title = "g renamed"
        event.save()
        assert _pt(event).clocked_id == before

    def test_retime_event_ignores_fired_events(self):
        now = timezone.now()
        event = Event.objects.create(
            title="h",
            scheduled_time=now + timedelta(minutes=5),
            status=Event.Status.FIRED,
            fired_at=now,
        )
        retime_event(event)
        assert _pt(event) is None


@pytest.mark.django_db
class TestReconciler:
    def test_arms_pending_events_missing_a_schedule(self):
        now = timezone.now()
        # Simulate a bulk/out-of-band create that bypassed the signal.
        Event.objects.bulk_create(
            [
                Event(title="x", scheduled_time=now + timedelta(minutes=2)),
                Event(title="y", scheduled_time=now + timedelta(minutes=3)),
            ]
        )
        assert reconcile_pending_events() == 2
        assert Event.objects.filter(status=Event.Status.SCHEDULED).count() == 2

    def test_skips_already_scheduled(self):
        now = timezone.now()
        Event.objects.create(title="armed", scheduled_time=now + timedelta(minutes=2))
        assert reconcile_pending_events() == 0

    def test_task_wrapper_returns_count(self):
        now = timezone.now()
        Event.objects.bulk_create(
            [Event(title="z", scheduled_time=now + timedelta(minutes=2))]
        )
        assert reconcile_pending_events_task() == 1


@pytest.mark.django_db
class TestCleanup:
    def test_removes_rows_for_fired_events(self):
        now = timezone.now()
        event = Event.objects.create(
            title="soon", scheduled_time=now + timedelta(minutes=2)
        )
        assert _pt(event) is not None
        # Beat fired it but left the (disabled) row behind.
        Event.objects.filter(pk=event.pk).update(
            status=Event.Status.FIRED, fired_at=now
        )
        assert cleanup_fired_clocked_tasks() == 1
        assert _pt(event) is None

    def test_removes_rows_for_missing_events(self):
        ghost = fire_task_name(uuid.uuid4())
        schedule = ClockedSchedule.objects.create(clocked_time=timezone.now())
        PeriodicTask.objects.create(
            name=ghost, task=FIRE_TASK, clocked=schedule, one_off=True
        )
        assert cleanup_fired_clocked_tasks() == 1
        assert not PeriodicTask.objects.filter(name=ghost).exists()

    def test_keeps_live_scheduled_rows(self):
        now = timezone.now()
        event = Event.objects.create(
            title="live", scheduled_time=now + timedelta(minutes=5)
        )
        assert cleanup_fired_clocked_tasks() == 0
        assert _pt(event) is not None

    def test_sweeps_orphaned_clocked_schedules(self):
        ClockedSchedule.objects.create(clocked_time=timezone.now())
        cleanup_fired_clocked_tasks()
        assert ClockedSchedule.objects.filter(periodictask__isnull=True).count() == 0

    def test_task_wrapper_returns_count(self):
        now = timezone.now()
        event = Event.objects.create(
            title="soon", scheduled_time=now + timedelta(minutes=2)
        )
        Event.objects.filter(pk=event.pk).update(
            status=Event.Status.FIRED, fired_at=now
        )
        assert cleanup_fired_clocked_tasks_task() == 1


@pytest.mark.django_db
class TestStatusLifecycle:
    """The PENDING → SCHEDULED → FIRED state machine."""

    def test_full_lifecycle(self):
        now = timezone.now()
        # 1. created → armed → SCHEDULED (due now so step 2 can fire it)
        event = Event.objects.create(
            title="lifecycle", scheduled_time=now - timedelta(seconds=1)
        )
        event.refresh_from_db()
        assert event.status == Event.Status.SCHEDULED
        assert _pt(event) is not None

        # 2. clocked task fires once due → FIRED, row torn down
        assert fire_single_event(str(event.id)) == "fired"
        event.refresh_from_db()
        assert event.status == Event.Status.FIRED
        assert event.fired_at is not None
        assert _pt(event) is None


@pytest.mark.django_db
class TestEventModel:
    def test_str_includes_title_and_time(self):
        when = timezone.now()
        event = Event.objects.create(title="Launch", scheduled_time=when)
        assert str(event) == f"Launch @ {when.isoformat()}"

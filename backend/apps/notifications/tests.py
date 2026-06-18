import random
from datetime import timedelta
from itertools import pairwise

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.notifications.models import Event
from apps.notifications.services import (
    _arm_event,
    fire_due_events,
    fire_single_event,
    generate_future_events,
    retime_event,
    schedule_upcoming_events,
)
from apps.notifications.tasks import (
    fire_event,
    fire_events,
    generate_events,
    schedule_upcoming_events_task,
)


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

    def test_all_events_start_pending(self):
        generate_future_events(count=3, within_minutes=10)
        assert Event.objects.filter(status=Event.Status.PENDING).count() == 3

    def test_invalid_count_raises(self):
        with pytest.raises(ValueError, match="count must be"):
            generate_future_events(count=0)

    def test_invalid_window_raises(self):
        with pytest.raises(ValueError, match="within_minutes must be"):
            generate_future_events(within_minutes=0)


@pytest.mark.django_db
class TestFireDueEvents:
    def test_fires_only_past_events(self):
        now = timezone.now()
        past = Event.objects.create(
            title="past", scheduled_time=now - timedelta(minutes=1)
        )
        future = Event.objects.create(
            title="future", scheduled_time=now + timedelta(minutes=10)
        )

        fired = fire_due_events()

        assert fired == 1
        past.refresh_from_db()
        future.refresh_from_db()
        assert past.status == Event.Status.FIRED
        assert past.fired_at is not None
        assert future.status == Event.Status.PENDING

    def test_does_not_refire(self):
        Event.objects.create(
            title="past",
            scheduled_time=timezone.now() - timedelta(minutes=1),
            status=Event.Status.FIRED,
        )
        assert fire_due_events() == 0


@pytest.mark.django_db
class TestTasks:
    def test_generate_events_returns_ids(self):
        ids = generate_events(count=5, within_minutes=20)
        assert len(ids) == 5
        assert Event.objects.filter(id__in=ids).count() == 5

    def test_generate_events_delay(self):
        result = generate_events.delay(count=2, within_minutes=10)
        assert len(result.get()) == 2

    def test_fire_events_task(self):
        Event.objects.create(
            title="due", scheduled_time=timezone.now() - timedelta(seconds=30)
        )
        assert fire_events() == 1


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
class TestScheduleUpcomingEvents:
    """The rolling-horizon scheduler arms a one-shot fire task per in-window
    event. ``fire_event.apply_async`` is mocked so nothing executes eagerly."""

    def test_arms_only_events_within_window(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        mock_apply.return_value.id = "armed-1"

        in_window = Event.objects.create(
            title="soon", scheduled_time=now + timedelta(minutes=5)
        )
        out_window = Event.objects.create(
            title="later", scheduled_time=now + timedelta(minutes=30)
        )

        armed = schedule_upcoming_events(window_minutes=10)

        assert armed == 1
        in_window.refresh_from_db()
        out_window.refresh_from_db()
        assert in_window.status == Event.Status.SCHEDULED
        assert in_window.dispatch_task_id == "armed-1"
        assert out_window.status == Event.Status.PENDING
        assert out_window.dispatch_task_id is None
        mock_apply.assert_called_once()
        _, kwargs = mock_apply.call_args
        assert kwargs["eta"] == in_window.scheduled_time
        assert kwargs["args"] == [str(in_window.id)]

    def test_does_not_rearm_already_scheduled(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        Event.objects.create(
            title="armed",
            scheduled_time=now + timedelta(minutes=2),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="already",
        )
        assert schedule_upcoming_events(window_minutes=10) == 0
        mock_apply.assert_not_called()

    def test_skips_already_fired(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        Event.objects.create(
            title="done",
            scheduled_time=now - timedelta(minutes=1),
            status=Event.Status.FIRED,
        )
        assert schedule_upcoming_events(window_minutes=10) == 0
        mock_apply.assert_not_called()

    def test_arms_past_due_unarmed_event(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        mock_apply.return_value.id = "late"
        overdue = Event.objects.create(
            title="overdue", scheduled_time=now - timedelta(minutes=1)
        )
        assert schedule_upcoming_events(window_minutes=10) == 1
        overdue.refresh_from_db()
        assert overdue.status == Event.Status.SCHEDULED
        assert overdue.dispatch_task_id == "late"

    def test_task_wrapper_returns_count(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        mock_apply.return_value.id = "y"
        Event.objects.create(title="soon", scheduled_time=now + timedelta(minutes=1))
        assert schedule_upcoming_events_task(window_minutes=10) == 1


@pytest.mark.django_db
class TestFireSingleEvent:
    def test_fires_due_scheduled_event(self):
        now = timezone.now()
        event = Event.objects.create(
            title="due",
            scheduled_time=now - timedelta(seconds=1),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="t1",
        )
        assert fire_single_event(str(event.id)) == "fired"
        event.refresh_from_db()
        assert event.status == Event.Status.FIRED
        assert event.fired_at is not None

    def test_already_fired_is_noop(self):
        now = timezone.now()
        event = Event.objects.create(
            title="done",
            scheduled_time=now - timedelta(seconds=1),
            status=Event.Status.FIRED,
            fired_at=now,
        )
        assert fire_single_event(str(event.id)) == "already_fired"

    def test_retimed_later_defers_back_to_pending(self):
        now = timezone.now()
        event = Event.objects.create(
            title="moved",
            scheduled_time=now + timedelta(minutes=5),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="stale",
        )
        assert fire_single_event(str(event.id)) == "deferred"
        event.refresh_from_db()
        assert event.status == Event.Status.PENDING
        assert event.dispatch_task_id is None

    def test_missing_event(self):
        import uuid

        assert fire_single_event(str(uuid.uuid4())) == "missing"

    def test_fire_event_task_wrapper(self):
        now = timezone.now()
        event = Event.objects.create(
            title="due", scheduled_time=now - timedelta(seconds=1)
        )
        assert fire_event(str(event.id)) == "fired"


@pytest.mark.django_db
class TestRetimeOnSave:
    """Changing a pending event's scheduled_time revokes the stale arm and
    re-arms if the new time is in-window. ``_revoke_dispatch`` / ``_arm_event``
    are mocked to observe the behaviour without a broker."""

    def test_changing_time_into_window_revokes_and_rearms(self, mocker):
        now = timezone.now()
        revoke = mocker.patch("apps.notifications.services._revoke_dispatch")
        arm = mocker.patch("apps.notifications.services._arm_event")
        Event.objects.create(
            title="e",
            scheduled_time=now + timedelta(minutes=30),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="old",
        )

        event = Event.objects.get(title="e")  # reload → _loaded_scheduled_time set
        event.scheduled_time = now + timedelta(minutes=5)
        event.save()

        revoke.assert_called_once_with("old")
        event.refresh_from_db()
        assert event.status == Event.Status.PENDING
        assert event.dispatch_task_id is None
        arm.assert_called_once()

    def test_changing_time_outside_window_does_not_rearm(self, mocker):
        now = timezone.now()
        mocker.patch("apps.notifications.services._revoke_dispatch")
        arm = mocker.patch("apps.notifications.services._arm_event")
        Event.objects.create(
            title="f",
            scheduled_time=now + timedelta(minutes=5),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="old",
        )

        event = Event.objects.get(title="f")
        event.scheduled_time = now + timedelta(minutes=40)
        event.save()

        arm.assert_not_called()
        event.refresh_from_db()
        # Stale arm is dropped even though it won't be re-armed until in-window.
        assert event.status == Event.Status.PENDING
        assert event.dispatch_task_id is None

    def test_save_without_time_change_is_noop(self, mocker):
        now = timezone.now()
        revoke = mocker.patch("apps.notifications.services._revoke_dispatch")
        arm = mocker.patch("apps.notifications.services._arm_event")
        Event.objects.create(title="g", scheduled_time=now + timedelta(minutes=5))

        event = Event.objects.get(title="g")
        event.title = "g renamed"
        event.save()

        revoke.assert_not_called()
        arm.assert_not_called()

    def test_retime_event_ignores_fired_events(self, mocker):
        now = timezone.now()
        revoke = mocker.patch("apps.notifications.services._revoke_dispatch")
        arm = mocker.patch("apps.notifications.services._arm_event")
        event = Event.objects.create(
            title="h",
            scheduled_time=now + timedelta(minutes=5),
            status=Event.Status.FIRED,
            fired_at=now,
            dispatch_task_id="old",
        )

        retime_event(event)

        revoke.assert_not_called()
        arm.assert_not_called()


@pytest.mark.django_db
class TestArmEvent:
    def test_claims_pending_and_stores_task_id(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        mock_apply.return_value.id = "task-9"
        event = Event.objects.create(
            title="e", scheduled_time=now + timedelta(minutes=3)
        )

        assert _arm_event(event) is True
        event.refresh_from_db()
        assert event.status == Event.Status.SCHEDULED
        assert event.dispatch_task_id == "task-9"

    def test_lost_race_returns_false_without_enqueuing(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        # Already claimed (SCHEDULED) by a concurrent pass -> the PENDING-guarded
        # claim matches 0 rows, so we never enqueue an orphan task.
        event = Event.objects.create(
            title="e",
            scheduled_time=now + timedelta(minutes=3),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="winner",
        )

        assert _arm_event(event) is False
        mock_apply.assert_not_called()
        event.refresh_from_db()
        assert event.dispatch_task_id == "winner"  # unchanged


@pytest.mark.django_db
class TestSweeperCoexistence:
    """The sweeper (fire_due_events) is idempotent against the exact-time path:
    an armed-but-not-yet-fired due event is still fired, and arming metadata
    never causes a double fire."""

    def test_sweeper_fires_armed_due_event(self):
        now = timezone.now()
        event = Event.objects.create(
            title="armed-overdue",
            scheduled_time=now - timedelta(seconds=5),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="armed",
        )

        assert fire_due_events() == 1
        event.refresh_from_db()
        assert event.status == Event.Status.FIRED

    def test_sweeper_does_not_refire_after_exact_path(self):
        now = timezone.now()
        event = Event.objects.create(
            title="due", scheduled_time=now - timedelta(seconds=5)
        )
        # Exact-time path fires it first...
        assert fire_single_event(str(event.id)) == "fired"
        # ...the sweeper then finds nothing to do.
        assert fire_due_events() == 0


@pytest.mark.django_db
class TestArmToFireIntegration:
    """End-to-end through the real Celery eager path (no apply_async mock): in
    eager mode the armed task runs inline, exercising arm -> fire_event ->
    fire_single_event as one chain."""

    def test_scheduling_a_due_event_fires_it(self):
        now = timezone.now()
        event = Event.objects.create(
            title="overdue", scheduled_time=now - timedelta(seconds=2)
        )

        armed = schedule_upcoming_events(window_minutes=10)

        assert armed == 1
        event.refresh_from_db()
        assert event.status == Event.Status.FIRED
        assert event.fired_at is not None

    def test_scheduling_a_future_event_does_not_fire_it(self):
        now = timezone.now()
        event = Event.objects.create(
            title="future", scheduled_time=now + timedelta(minutes=5)
        )

        schedule_upcoming_events(window_minutes=10)

        event.refresh_from_db()
        # Eager run of the armed task sees the event isn't due yet and defers.
        assert event.status == Event.Status.PENDING


@pytest.mark.django_db
class TestStatusLifecycle:
    """The PENDING → SCHEDULED → FIRED state machine, driven via mocked arming
    so each transition is asserted in isolation."""

    def test_full_lifecycle(self, mocker):
        now = timezone.now()
        mock_apply = mocker.patch("apps.notifications.tasks.fire_event.apply_async")
        mock_apply.return_value.id = "task-1"

        # 1. created → PENDING (due now, so step 3 can fire it)
        event = Event.objects.create(
            title="lifecycle", scheduled_time=now - timedelta(seconds=1)
        )
        assert event.status == Event.Status.PENDING

        # 2. scheduler arms it → SCHEDULED
        assert schedule_upcoming_events(window_minutes=10) == 1
        event.refresh_from_db()
        assert event.status == Event.Status.SCHEDULED
        assert event.dispatch_task_id == "task-1"

        # 3. armed task runs once due → FIRED
        assert fire_single_event(str(event.id)) == "fired"
        event.refresh_from_db()
        assert event.status == Event.Status.FIRED
        assert event.fired_at is not None

    def test_scheduled_can_return_to_pending_on_retime(self, mocker):
        now = timezone.now()
        mocker.patch("apps.notifications.services._revoke_dispatch")
        mocker.patch(
            "apps.notifications.tasks.fire_event.apply_async"
        ).return_value.id = "t"

        event = Event.objects.create(
            title="bounce",
            scheduled_time=now + timedelta(minutes=2),
            status=Event.Status.SCHEDULED,
            dispatch_task_id="old",
        )
        reloaded = Event.objects.get(pk=event.pk)
        reloaded.scheduled_time = now + timedelta(minutes=40)  # out of window
        reloaded.save()

        reloaded.refresh_from_db()
        assert reloaded.status == Event.Status.PENDING
        assert reloaded.dispatch_task_id is None

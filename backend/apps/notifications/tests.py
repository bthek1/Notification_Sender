from datetime import timedelta
from itertools import pairwise

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.notifications.models import Event
from apps.notifications.services import fire_due_events, generate_future_events
from apps.notifications.tasks import fire_events, generate_events


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

    def test_events_are_evenly_spaced(self):
        events = generate_future_events(count=4, within_minutes=20)
        times = sorted(e.scheduled_time for e in events)
        gaps = [(b - a).total_seconds() for a, b in pairwise(times)]
        # 20 min / 4 = 5 min spacing; allow small float tolerance.
        assert all(abs(gap - 300) < 1 for gap in gaps)

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

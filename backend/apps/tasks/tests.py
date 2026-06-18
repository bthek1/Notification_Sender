import json
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from django_celery_beat.models import (
    ClockedSchedule,
    CrontabSchedule,
    IntervalSchedule,
    PeriodicTask,
)
from django_celery_results.models import TaskResult
from rest_framework.test import APIClient

from apps.tasks.scheduled_tasks import SCHEDULED_TASKS
from apps.tasks.serializers import PeriodicTaskSerializer

User = get_user_model()


@pytest.fixture
def auth_client(db):
    user = User.objects.create_user(email="ops@example.com", password="pass12345")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ── sync_scheduled_tasks command ────────────────────────────────────────────────


@pytest.mark.django_db
class TestSyncScheduledTasks:
    def test_creates_all_managed_tasks(self):
        call_command("sync_scheduled_tasks")
        names = {spec["name"] for spec in SCHEDULED_TASKS}
        assert names.issubset(set(PeriodicTask.objects.values_list("name", flat=True)))

    def test_interval_and_kwargs_applied(self):
        call_command("sync_scheduled_tasks")
        task = PeriodicTask.objects.get(name="notifications-generate-events")
        assert task.task == "apps.notifications.tasks.generate_events"
        assert task.interval.every == 1
        assert task.interval.period == IntervalSchedule.MINUTES
        assert json.loads(task.kwargs) == {"count": 10, "within_minutes": 5}

    def test_reconcile_and_cleanup_tasks_synced(self):
        call_command("sync_scheduled_tasks")
        reconcile = PeriodicTask.objects.get(name="notifications-reconcile-pending")
        assert (
            reconcile.task == "apps.notifications.tasks.reconcile_pending_events_task"
        )
        assert reconcile.interval.every == 1
        assert reconcile.interval.period == IntervalSchedule.MINUTES

        cleanup = PeriodicTask.objects.get(name="notifications-cleanup-fired")
        assert (
            cleanup.task == "apps.notifications.tasks.cleanup_fired_clocked_tasks_task"
        )
        assert cleanup.interval.every == 10
        assert cleanup.interval.period == IntervalSchedule.MINUTES

    def test_idempotent(self):
        call_command("sync_scheduled_tasks")
        before = PeriodicTask.objects.count()
        call_command("sync_scheduled_tasks")
        assert PeriodicTask.objects.count() == before

    def test_prunes_unmanaged_task(self):
        schedule, _ = IntervalSchedule.objects.get_or_create(
            every=5, period=IntervalSchedule.MINUTES
        )
        PeriodicTask.objects.create(
            name="stale-task", task="apps.pages.tasks.add", interval=schedule
        )
        call_command("sync_scheduled_tasks")
        assert not PeriodicTask.objects.filter(name="stale-task").exists()

    def test_preserves_celery_backend_cleanup(self):
        schedule, _ = IntervalSchedule.objects.get_or_create(
            every=1, period=IntervalSchedule.DAYS
        )
        PeriodicTask.objects.create(
            name="celery.backend_cleanup",
            task="celery.backend_cleanup",
            interval=schedule,
        )
        call_command("sync_scheduled_tasks")
        assert PeriodicTask.objects.filter(name="celery.backend_cleanup").exists()

    def test_dry_run_writes_nothing(self):
        out = StringIO()
        call_command("sync_scheduled_tasks", "--dry-run", stdout=out)
        assert PeriodicTask.objects.count() == 0
        assert "would create" in out.getvalue()

    def test_updates_changed_task(self):
        call_command("sync_scheduled_tasks")
        task = PeriodicTask.objects.get(name="notifications-reconcile-pending")
        task.enabled = False
        task.save()
        call_command("sync_scheduled_tasks")
        task.refresh_from_db()
        assert task.enabled is True  # reset to source-of-truth value

    def test_does_not_prune_per_event_fire_tasks(self):
        # CRITICAL: per-event "fire-event-*" clocked rows are armed dynamically and
        # are not in SCHEDULED_TASKS. sync must never delete them, or all pending
        # firing would be silently disabled.
        clocked = ClockedSchedule.objects.create(clocked_time=timezone.now())
        PeriodicTask.objects.create(
            name="fire-event-abc123",
            task="apps.notifications.tasks.fire_event",
            clocked=clocked,
            one_off=True,
        )
        call_command("sync_scheduled_tasks")
        assert PeriodicTask.objects.filter(name="fire-event-abc123").exists()


# ── REST API ────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestScheduleAPI:
    def test_list_requires_auth(self):
        response = APIClient().get("/api/tasks/schedules/")
        assert response.status_code == 401

    def test_list_schedules(self, auth_client):
        call_command("sync_scheduled_tasks")
        response = auth_client.get("/api/tasks/schedules/")
        assert response.status_code == 200
        names = {row["name"] for row in response.json()}
        assert "notifications-reconcile-pending" in names
        row = next(
            r for r in response.json() if r["name"] == "notifications-generate-events"
        )
        assert row["schedule"]["type"] == "interval"
        assert row["schedule"]["every"] == 1

    def test_toggle_schedule(self, auth_client):
        call_command("sync_scheduled_tasks")
        task = PeriodicTask.objects.get(name="notifications-reconcile-pending")
        response = auth_client.patch(
            f"/api/tasks/schedules/{task.pk}/",
            {"enabled": False},
            format="json",
        )
        assert response.status_code == 200
        task.refresh_from_db()
        assert task.enabled is False

    def test_trigger_schedule(self, auth_client, mocker):
        call_command("sync_scheduled_tasks")
        task = PeriodicTask.objects.get(name="notifications-reconcile-pending")
        mock_result = mocker.MagicMock()
        mock_result.id = "fired-123"
        mock_send = mocker.patch(
            "apps.tasks.views.current_app.send_task", return_value=mock_result
        )

        response = auth_client.post(f"/api/tasks/schedules/{task.pk}/trigger/")
        assert response.status_code == 202
        assert response.json()["task_id"] == "fired-123"
        mock_send.assert_called_once()
        assert (
            mock_send.call_args.args[0]
            == "apps.notifications.tasks.reconcile_pending_events_task"
        )

    def test_trigger_passes_kwargs(self, auth_client, mocker):
        call_command("sync_scheduled_tasks")
        task = PeriodicTask.objects.get(name="notifications-generate-events")
        mock_send = mocker.patch("apps.tasks.views.current_app.send_task")
        mock_send.return_value.id = "x"

        auth_client.post(f"/api/tasks/schedules/{task.pk}/trigger/")
        assert mock_send.call_args.kwargs["kwargs"] == {
            "count": 10,
            "within_minutes": 5,
        }

    def test_trigger_decodes_json_args(self, auth_client, mocker):
        # args/kwargs are stored as JSON strings on PeriodicTask; the view must
        # decode them into real lists/dicts before dispatching.
        schedule, _ = IntervalSchedule.objects.get_or_create(
            every=2, period=IntervalSchedule.MINUTES
        )
        task = PeriodicTask.objects.create(
            name="with-args",
            task="apps.pages.tasks.add",
            interval=schedule,
            args=json.dumps([4, 6]),
        )
        mock_send = mocker.patch("apps.tasks.views.current_app.send_task")
        mock_send.return_value.id = "args-1"

        auth_client.post(f"/api/tasks/schedules/{task.pk}/trigger/")
        assert mock_send.call_args.kwargs["args"] == [4, 6]

    def test_trigger_empty_args_kwargs_default(self, auth_client, mocker):
        # A task with no args/kwargs dispatches with [] / {} (not "" or "{}").
        schedule, _ = IntervalSchedule.objects.get_or_create(
            every=3, period=IntervalSchedule.MINUTES
        )
        task = PeriodicTask.objects.create(
            name="no-args", task="apps.pages.tasks.add", interval=schedule
        )
        mock_send = mocker.patch("apps.tasks.views.current_app.send_task")
        mock_send.return_value.id = "empty-1"

        auth_client.post(f"/api/tasks/schedules/{task.pk}/trigger/")
        assert mock_send.call_args.kwargs["args"] == []
        assert mock_send.call_args.kwargs["kwargs"] == {}

    def test_trigger_missing_schedule_returns_404(self, auth_client, mocker):
        mock_send = mocker.patch("apps.tasks.views.current_app.send_task")
        response = auth_client.post("/api/tasks/schedules/999999/trigger/")
        assert response.status_code == 404
        mock_send.assert_not_called()

    def test_toggle_missing_schedule_returns_404(self, auth_client):
        response = auth_client.patch(
            "/api/tasks/schedules/999999/",
            {"enabled": False},
            format="json",
        )
        assert response.status_code == 404


@pytest.mark.django_db
class TestResultsAPI:
    def test_list_results(self, auth_client):
        TaskResult.objects.create(
            task_id="abc",
            task_name="apps.notifications.tasks.reconcile_pending_events_task",
            status="SUCCESS",
        )
        response = auth_client.get("/api/tasks/results/")
        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_filter_results_by_status(self, auth_client):
        TaskResult.objects.create(task_id="ok", status="SUCCESS")
        TaskResult.objects.create(task_id="bad", status="FAILURE")
        response = auth_client.get("/api/tasks/results/?status=FAILURE")
        data = response.json()
        assert len(data) == 1
        assert data[0]["task_id"] == "bad"

    def test_result_detail(self, auth_client):
        TaskResult.objects.create(task_id="detail-1", status="SUCCESS")
        response = auth_client.get("/api/tasks/results/detail-1/")
        assert response.status_code == 200
        assert response.json()["task_id"] == "detail-1"

    def test_results_list_requires_auth(self):
        response = APIClient().get("/api/tasks/results/")
        assert response.status_code == 401

    def test_result_detail_missing_returns_404(self, auth_client):
        response = auth_client.get("/api/tasks/results/nope/")
        assert response.status_code == 404


@pytest.mark.django_db
class TestPeriodicTaskSerializer:
    """Cover the schedule-shape branches of PeriodicTaskSerializer.get_schedule."""

    def test_serializes_crontab_schedule(self):
        crontab, _ = CrontabSchedule.objects.get_or_create(
            minute="0", hour="1", day_of_week="0"
        )
        task = PeriodicTask.objects.create(
            name="weekly", task="apps.pages.tasks.add", crontab=crontab
        )
        schedule = PeriodicTaskSerializer(task).data["schedule"]
        assert schedule["type"] == "crontab"
        assert schedule["minute"] == "0"
        assert schedule["hour"] == "1"
        assert schedule["day_of_week"] == "0"

    def test_serializes_clocked_schedule(self):
        fire_at = timezone.now()
        clocked = ClockedSchedule.objects.create(clocked_time=fire_at)
        task = PeriodicTask.objects.create(
            name="one-shot-fire",
            task="apps.notifications.tasks.fire_event",
            clocked=clocked,
            one_off=True,
        )
        data = PeriodicTaskSerializer(task).data
        assert data["schedule"]["type"] == "clocked"
        assert data["schedule"]["clocked_time"] == fire_at.isoformat()
        assert data["one_off"] is True

    def test_schedule_is_none_without_interval_or_crontab(self):
        # An unsaved task with neither schedule yields a null schedule rather
        # than raising.
        task = PeriodicTask(name="bare", task="apps.pages.tasks.add")
        assert PeriodicTaskSerializer().get_schedule(task) is None


@pytest.mark.django_db
class TestPagesDemoEndpointsStillResolve:
    """The new /api/tasks/ namespace must not shadow the pages demo endpoints."""

    def test_pages_task_status_still_resolves(self, mocker):
        mock_result = mocker.MagicMock()
        mock_result.status = "PENDING"
        mock_result.successful.return_value = False
        mock_result.failed.return_value = False
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)
        # A bare task id under /api/tasks/<id>/ should fall through to pages.
        response = APIClient().get("/api/tasks/some-task-id/")
        assert response.status_code == 200
        assert response.json()["task_id"] == "some-task-id"

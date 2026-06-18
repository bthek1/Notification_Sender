import pytest
from celery import Celery
from django.urls import reverse

from apps.pages.tasks import add
from core.celery import app as celery_app


@pytest.mark.django_db
class TestHealthCheck:
    def test_health_check_returns_200(self, client):
        url = reverse("health-check")
        response = client.get(url)
        assert response.status_code == 200

    def test_health_check_returns_ok(self, client):
        url = reverse("health-check")
        response = client.get(url)
        assert response.json() == {"status": "ok"}


class TestCeleryConfig:
    """Verify the Celery application is correctly wired to Django settings."""

    def test_celery_app_is_celery_instance(self):
        assert isinstance(celery_app, Celery)

    def test_celery_app_name(self):
        assert celery_app.main == "core"

    def test_celery_app_uses_django_conf(self):
        # config_from_object with namespace="CELERY" means Django's
        # CELERY_BROKER_URL maps to broker_url, etc.
        assert celery_app.conf.task_serializer == "json"
        assert celery_app.conf.result_serializer == "json"
        assert "json" in celery_app.conf.accept_content

    def test_task_always_eager_in_test_settings(self):
        # Tasks must run synchronously during the test suite — no broker needed.
        from django.conf import settings

        assert getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False) is True


class TestAddTask:
    """Celery task unit tests — run eagerly via CELERY_TASK_ALWAYS_EAGER."""

    def test_add_called_directly(self):
        assert add(2, 3) == 5

    def test_add_delay_returns_correct_result(self):
        result = add.delay(4, 6)
        assert result.get() == 10

    def test_add_apply_returns_correct_result(self):
        result = add.apply(args=(7, 8))
        assert result.get() == 15

    def test_add_with_negative_numbers(self):
        assert add(-1, 1) == 0

    def test_add_with_zero(self):
        assert add(0, 0) == 0


# ── process_data task tests ────────────────────────────────────────────────────


class TestProcessDataTask:
    """Eager tests for process_data task — no broker required."""

    def test_process_data_success(self, mocker):
        """Task returns expected result when called directly."""
        from apps.pages.tasks import process_data

        mocker.patch("apps.pages.tasks.time.sleep")
        result = process_data({"key": "value", "count": 42})
        assert result["processed"] is True
        assert result["input"] == {"key": "value", "count": 42}
        assert result["items_count"] == 2

    def test_process_data_empty_payload(self, mocker):
        from apps.pages.tasks import process_data

        mocker.patch("apps.pages.tasks.time.sleep")
        result = process_data({})
        assert result["processed"] is True
        assert result["items_count"] == 0

    def test_process_data_apply_success(self, mocker):
        """Task runs eagerly via .apply() and returns correct result."""
        from apps.pages.tasks import process_data

        mocker.patch("apps.pages.tasks.time.sleep")
        ar = process_data.apply(args=[{"x": 1}])
        assert ar.successful()
        assert ar.result["processed"] is True

    def test_process_data_retries_on_exception(self, mocker):
        """Task calls self.retry() when an exception occurs (eager: raises Retry)."""
        from celery.exceptions import Retry

        import apps.pages.tasks as tasks_module

        mocker.patch.object(
            tasks_module.time, "sleep", side_effect=RuntimeError("boom")
        )
        # In eager mode, self.retry() raises celery.exceptions.Retry
        with pytest.raises(Retry):
            from apps.pages.tasks import process_data

            process_data.apply(args=[{"fail": True}], throw=True)


# ── Task trigger endpoint tests ────────────────────────────────────────────────


@pytest.mark.django_db
class TestTaskTriggerEndpoint:
    """POST /api/tasks/trigger/ — mock .delay() so no task actually runs."""

    def test_trigger_returns_202(self, client, mocker):
        mock_task = mocker.MagicMock()
        mock_task.id = "test-task-id-123"
        mocker.patch("apps.pages.views.process_data.delay", return_value=mock_task)

        url = reverse("task-trigger")
        response = client.post(url, data={}, content_type="application/json")
        assert response.status_code == 202

    def test_trigger_returns_task_id(self, client, mocker):
        mock_task = mocker.MagicMock()
        mock_task.id = "abc-def-456"
        mocker.patch("apps.pages.views.process_data.delay", return_value=mock_task)

        url = reverse("task-trigger")
        response = client.post(
            url, data={"demo": True}, content_type="application/json"
        )
        assert response.json()["task_id"] == "abc-def-456"

    def test_trigger_passes_payload_to_task(self, client, mocker):
        mock_delay = mocker.patch("apps.pages.views.process_data.delay")
        mock_delay.return_value.id = "xyz-789"

        url = reverse("task-trigger")
        client.post(url, data={"foo": "bar"}, content_type="application/json")
        mock_delay.assert_called_once_with({"foo": "bar"})


# ── Task status endpoint tests ─────────────────────────────────────────────────


@pytest.mark.django_db
class TestTaskStatusEndpoint:
    """GET /api/tasks/<task_id>/ — mock AsyncResult."""

    def test_status_pending(self, client, mocker):
        mock_result = mocker.MagicMock()
        mock_result.status = "PENDING"
        mock_result.successful.return_value = False
        mock_result.failed.return_value = False
        mock_result.traceback = None
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)

        url = reverse("task-status", kwargs={"task_id": "some-id"})
        response = client.get(url)
        assert response.status_code == 200
        data = response.json()
        assert data["task_id"] == "some-id"
        assert data["status"] == "PENDING"
        assert data["result"] is None
        assert data["traceback"] is None

    def test_status_success(self, client, mocker):
        mock_result = mocker.MagicMock()
        mock_result.status = "SUCCESS"
        mock_result.successful.return_value = True
        mock_result.failed.return_value = False
        mock_result.result = {"processed": True}
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)

        url = reverse("task-status", kwargs={"task_id": "done-id"})
        response = client.get(url)
        data = response.json()
        assert data["status"] == "SUCCESS"
        assert data["result"] == {"processed": True}

    def test_status_failure(self, client, mocker):
        mock_result = mocker.MagicMock()
        mock_result.status = "FAILURE"
        mock_result.successful.return_value = False
        mock_result.failed.return_value = True
        mock_result.traceback = "Traceback: RuntimeError"
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)

        url = reverse("task-status", kwargs={"task_id": "fail-id"})
        response = client.get(url)
        data = response.json()
        assert data["status"] == "FAILURE"
        assert data["traceback"] == "Traceback: RuntimeError"
        assert data["result"] is None


# ── Task revoke endpoint tests ─────────────────────────────────────────────────


@pytest.mark.django_db
class TestTaskRevokeEndpoint:
    """POST /api/tasks/<task_id>/revoke/."""

    def test_revoke_returns_revoked_true(self, client, mocker):
        mock_result = mocker.MagicMock()
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)

        url = reverse("task-revoke", kwargs={"task_id": "revoke-me"})
        response = client.post(url, data={}, content_type="application/json")
        assert response.status_code == 200
        data = response.json()
        assert data["revoked"] is True
        assert data["task_id"] == "revoke-me"

    def test_revoke_calls_revoke_with_terminate_false(self, client, mocker):
        mock_result = mocker.MagicMock()
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)

        url = reverse("task-revoke", kwargs={"task_id": "revoke-me"})
        client.post(url, data={}, content_type="application/json")
        mock_result.revoke.assert_called_once_with(terminate=False)

    def test_revoke_with_terminate_true(self, client, mocker):
        mock_result = mocker.MagicMock()
        mocker.patch("apps.pages.views.AsyncResult", return_value=mock_result)

        url = reverse("task-revoke", kwargs={"task_id": "revoke-me"})
        client.post(url, data={"terminate": True}, content_type="application/json")
        mock_result.revoke.assert_called_once_with(terminate=True)


# ── Beat registration test ─────────────────────────────────────────────────────


@pytest.mark.django_db
class TestBeatRegistration:
    """Verify django-celery-beat models can persist periodic tasks."""

    def test_create_interval_and_periodic_task(self):
        from django_celery_beat.models import IntervalSchedule, PeriodicTask

        schedule, _ = IntervalSchedule.objects.get_or_create(
            every=1,
            period=IntervalSchedule.MINUTES,
        )
        task = PeriodicTask.objects.create(
            interval=schedule,
            name="test-add-every-minute",
            task="apps.pages.tasks.add",
            kwargs='{"x": 1, "y": 2}',
        )
        assert PeriodicTask.objects.filter(name="test-add-every-minute").exists()
        assert task.interval.every == 1
        assert task.interval.period == IntervalSchedule.MINUTES

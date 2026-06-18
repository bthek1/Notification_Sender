## Complete Plan — Celery + uv + Django/DRF + React

---

### Project structure

```
myproject/
├── pyproject.toml
├── uv.lock
├── Procfile.dev
├── docker-compose.yml
├── manage.py
├── myproject/
│   ├── __init__.py
│   ├── settings.py
│   ├── celery.py
│   └── urls.py
└── myapp/
    ├── tasks.py
    ├── views.py
    └── urls.py

frontend/
└── src/
    └── hooks/
        └── useTaskPoller.ts
```

---

### 1. Dependencies

```bash
uv add celery redis django-celery-results django-celery-beat
uv add --dev flower honcho
```

`pyproject.toml` will reflect these. No `requirements.txt` needed.

---

### 2. Docker Compose — Redis only

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

---

### 3. `myproject/celery.py`

```python
import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "myproject.settings")

app = Celery("myproject")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
```

### 4. `myproject/__init__.py`

```python
from .celery import app as celery_app
__all__ = ("celery_app",)
```

### 5. `settings.py` additions

```python
INSTALLED_APPS = [
    ...
    "django_celery_results",
    "django_celery_beat",
]

# Broker & backend
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = "django-db"
CELERY_RESULT_EXTENDED = True          # stores args, kwargs, runtime, worker

# Serialization
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"

# Visibility & tracking
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_SEND_SENT_EVENT = True
CELERY_WORKER_SEND_TASK_EVENTS = True

# Reliability
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_SOFT_TIME_LIMIT = 300      # raises SoftTimeLimitExceeded
CELERY_TASK_TIME_LIMIT = 360           # hard kill

# Beat — DB-driven schedule (editable in Django admin)
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
```

---

### 6. Migrate

```bash
uv run python manage.py migrate
```

This creates tables for `django_celery_results` (task results) and `django_celery_beat` (periodic task schedules).

---

### 7. Writing tasks

```python
# myapp/tasks.py
from celery import shared_task
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    name="myapp.tasks.process_data",
)
def process_data(self, record_id: int) -> dict:
    try:
        logger.info("Processing record %s | task_id=%s", record_id, self.request.id)
        # ... do work ...
        return {"status": "ok", "record_id": record_id}
    except Exception as exc:
        logger.warning("Retrying task %s: %s", self.request.id, exc)
        raise self.retry(exc=exc)


@shared_task(name="myapp.tasks.scheduled_job")
def scheduled_job() -> None:
    """Example periodic task — registered in Django admin under Periodic Tasks."""
    logger.info("Running scheduled job")
```

---

### 8. DRF views — dispatch + poll

```python
# myapp/views.py
from celery.result import AsyncResult
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .tasks import process_data


@api_view(["POST"])
def trigger_task(request):
    record_id = request.data.get("record_id")
    if not record_id:
        return Response({"error": "record_id required"}, status=status.HTTP_400_BAD_REQUEST)
    task = process_data.delay(record_id)
    return Response({"task_id": task.id}, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
def task_status(request, task_id):
    result = AsyncResult(task_id)
    return Response({
        "task_id": task_id,
        "status": result.status,           # PENDING / STARTED / SUCCESS / FAILURE / REVOKED
        "result": result.result if result.ready() else None,
        "traceback": result.traceback if result.failed() else None,
    })


@api_view(["POST"])
def revoke_task(request, task_id):
    AsyncResult(task_id).revoke(terminate=True)
    return Response({"revoked": task_id})
```

```python
# myapp/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("tasks/trigger/", views.trigger_task),
    path("tasks/<str:task_id>/", views.task_status),
    path("tasks/<str:task_id>/revoke/", views.revoke_task),
]
```

```python
# myproject/urls.py
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("myapp.urls")),
]
```

---

### 9. React polling hook

```ts
// src/hooks/useTaskPoller.ts
import { useState, useEffect, useRef } from "react";

export type TaskStatus = "PENDING" | "STARTED" | "SUCCESS" | "FAILURE" | "REVOKED";

export interface TaskResult<T = unknown> {
  task_id: string;
  status: TaskStatus;
  result: T | null;
  traceback?: string;
}

export function useTaskPoller<T = unknown>(
  taskId: string | null,
  intervalMs = 2000
): TaskResult<T> | null {
  const [data, setData] = useState<TaskResult<T> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!taskId) return;

    const poll = async () => {
      const res = await fetch(`/api/tasks/${taskId}/`);
      const json: TaskResult<T> = await res.json();
      setData(json);
      if (json.status === "SUCCESS" || json.status === "FAILURE" || json.status === "REVOKED") {
        clearInterval(timer.current);
      }
    };

    poll();
    timer.current = setInterval(poll, intervalMs);
    return () => clearInterval(timer.current);
  }, [taskId, intervalMs]);

  return data;
}
```

```tsx
// src/components/TaskTrigger.tsx
import { useState } from "react";
import { useTaskPoller } from "../hooks/useTaskPoller";

export function TaskTrigger() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTaskPoller(taskId);

  const run = async () => {
    const res = await fetch("/api/tasks/trigger/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record_id: 42 }),
    });
    const { task_id } = await res.json();
    setTaskId(task_id);
  };

  return (
    <div>
      <button onClick={run}>Run Task</button>
      {task && (
        <div>
          <p>Status: <strong>{task.status}</strong></p>
          {task.result && <pre>{JSON.stringify(task.result, null, 2)}</pre>}
          {task.traceback && <pre style={{ color: "red" }}>{task.traceback}</pre>}
        </div>
      )}
    </div>
  );
}
```

---

### 10. Monitoring

**Flower** — real-time worker + task dashboard

```bash
uv run celery -A myproject flower --port=5555
# → http://localhost:5555
```

Shows: live workers, task states, retries, runtime, args — plus revoke controls.

**Django Admin** — persistent task history + schedule management

- `/admin/django_celery_results/taskresult/` — every result stored in DB, filterable by status/task name/date
- `/admin/django_celery_beat/periodictask/` — create/edit/disable periodic tasks without touching code

---

### 11. Procfile.dev — run everything in one command

```
# Procfile.dev
web:    uv run python manage.py runserver
worker: uv run celery -A myproject worker -l info -c 4
beat:   uv run celery -A myproject beat -l info
flower: uv run celery -A myproject flower --port=5555
```

```bash
docker compose up -d redis        # start Redis
uv run honcho start -f Procfile.dev   # start everything else
```

Colour-coded logs per process. Ctrl+C kills all four cleanly.

---

### Full flow summary

```
React POST /api/tasks/trigger/
  → DRF dispatches task.delay() → Redis broker
    → Celery worker picks up task
      → result written to postgres (django-db backend)
  → DRF returns { task_id }

React polls GET /api/tasks/<task_id>/
  → DRF reads AsyncResult from postgres
  → returns { status, result }
    → React stops polling on SUCCESS / FAILURE / REVOKED

Celery beat → fires scheduled tasks on DB-stored cron schedule
Flower      → monitors workers + tasks in real time
Django admin → inspect results + manage beat schedule
```

---

### Key decisions recap

| Setting | Reason |
|---|---|
| `CELERY_RESULT_BACKEND = "django-db"` | Results in Postgres, queryable via ORM, no extra infra |
| `CELERY_RESULT_EXTENDED = True` | Stores args, kwargs, worker name, runtime for debugging |
| `CELERY_TASK_ACKS_LATE = True` | Task survives worker crash — requeued automatically |
| `CELERY_WORKER_PREFETCH_MULTIPLIER = 1` | Long tasks don't block short ones on the same worker |
| `CELERY_TASK_TRACK_STARTED = True` | STARTED state visible — UI can show "in progress" vs "queued" |
| `DatabaseScheduler` for beat | Periodic tasks editable in Django admin at runtime |
| `bind=True` on tasks | Access to `self.retry()`, `self.request.id`, `self.request.retries` |

---

## Testing Celery in Django with pytest

### 1. Add test dependencies

```bash
uv add --dev pytest pytest-django pytest-celery
```

---

### 2. `pyproject.toml` — pytest config

```toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "myproject.settings"
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
```

---

### 3. `conftest.py`

```python
# conftest.py (project root)
import django
import pytest
from django.conf import settings


@pytest.fixture(scope="session")
def django_db_setup():
    pass


@pytest.fixture
def celery_config():
    return {
        "broker_url": "memory://",          # in-memory broker — no Redis needed
        "result_backend": "cache+memory://", # in-memory backend — no Postgres needed
        "task_always_eager": False,          # let pytest-celery control execution
    }
```

---

### 4. Three testing modes

#### Mode 1 — Eager (synchronous, no worker)

Tasks run inline in the same process. Fastest, simplest. Good for unit testing task logic.

```python
# myapp/tests/test_tasks_eager.py
import pytest
from myapp.tasks import process_data


@pytest.mark.django_db
def test_process_data_success(settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True  # surface exceptions

    result = process_data.delay(record_id=1)

    assert result.successful()
    assert result.result == {"status": "ok", "record_id": 1}


@pytest.mark.django_db
def test_process_data_failure(settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True

    with pytest.raises(Exception):
        process_data.delay(record_id=None)  # should raise / retry
```

#### Mode 2 — pytest-celery worker (real worker, in-memory broker)

Spins up a real Celery worker in a thread for the test session. Tests actual async behaviour without Redis.

```python
# myapp/tests/test_tasks_worker.py
import pytest
from celery.result import AsyncResult
from myapp.tasks import process_data


@pytest.mark.celery(broker="memory://", backend="cache+memory://")
@pytest.mark.django_db(transaction=True)  # transaction=True required for worker thread to see DB
def test_process_data_async(celery_worker):
    result = process_data.delay(record_id=1)
    output = result.get(timeout=10)         # blocks until complete

    assert output == {"status": "ok", "record_id": 1}


@pytest.mark.celery(broker="memory://", backend="cache+memory://")
@pytest.mark.django_db(transaction=True)
def test_task_retries(celery_worker, mocker):
    mocker.patch("myapp.tasks.some_external_call", side_effect=Exception("boom"))

    result = process_data.delay(record_id=99)

    with pytest.raises(Exception, match="boom"):
        result.get(timeout=10, propagate=True)
```

#### Mode 3 — Mock (no worker, no broker)

For testing code that *dispatches* tasks — views, signals, management commands. You don't care about task internals, just that the right task was called with the right args.

```python
# myapp/tests/test_views.py
import pytest
from unittest.mock import patch
from django.urls import reverse
from rest_framework.test import APIClient


@pytest.fixture
def api_client():
    return APIClient()


@pytest.mark.django_db
def test_trigger_endpoint_dispatches_task(api_client):
    with patch("myapp.tasks.process_data.delay") as mock_delay:
        mock_delay.return_value.id = "fake-task-id"

        response = api_client.post(
            "/api/tasks/trigger/",
            {"record_id": 42},
            format="json",
        )

    assert response.status_code == 202
    assert response.data["task_id"] == "fake-task-id"
    mock_delay.assert_called_once_with(42)


@pytest.mark.django_db
def test_status_endpoint(api_client):
    with patch("myapp.views.AsyncResult") as mock_result:
        mock_result.return_value.status = "SUCCESS"
        mock_result.return_value.ready.return_value = True
        mock_result.return_value.result = {"status": "ok", "record_id": 42}
        mock_result.return_value.failed.return_value = False

        response = api_client.get("/api/tasks/fake-task-id/")

    assert response.status_code == 200
    assert response.data["status"] == "SUCCESS"
```

---

### 5. Testing periodic tasks (beat)

Beat schedules live in the DB — test that the schedule is registered correctly, not that it fires on time.

```python
# myapp/tests/test_beat.py
import pytest
from django_celery_beat.models import PeriodicTask, IntervalSchedule


@pytest.mark.django_db
def test_scheduled_job_is_registered():
    schedule, _ = IntervalSchedule.objects.get_or_create(
        every=10,
        period=IntervalSchedule.MINUTES,
    )
    task = PeriodicTask.objects.create(
        interval=schedule,
        name="Test scheduled job",
        task="myapp.tasks.scheduled_job",
    )

    assert PeriodicTask.objects.filter(task="myapp.tasks.scheduled_job").exists()
    assert task.enabled is True
```

---

### 6. Shared task test fixtures

```python
# myapp/tests/conftest.py
import pytest


@pytest.fixture
def eager_celery(settings):
    """Force all tasks to run synchronously in tests."""
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True
    yield
    settings.CELERY_TASK_ALWAYS_EAGER = False


# Usage:
# def test_something(eager_celery):
#     result = process_data.delay(1)
#     assert result.successful()
```

---

### 7. Run tests

```bash
uv run pytest                          # all tests
uv run pytest myapp/tests/             # specific app
uv run pytest -k "test_tasks"          # filter by name
uv run pytest -v --tb=short            # verbose with short tracebacks
```

---

### Which mode to use when

| Scenario | Mode |
|---|---|
| Testing task logic (pure function behaviour) | Eager |
| Testing retry logic, async state transitions | pytest-celery worker |
| Testing views/signals that dispatch tasks | Mock `.delay()` |
| Testing beat schedule registration | DB + `django_celery_beat` models |
| CI pipeline (no Redis) | Eager or in-memory worker |
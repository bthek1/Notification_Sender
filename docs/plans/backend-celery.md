# Plan: Backend Celery Integration (Docker)

**Status:** In Progress
**Date:** 2026-03-18

---

## Goal

Add Celery (with Redis as the broker/result backend) to the Django backend, running the worker inside Docker. The `just dev` command is updated to automatically start Redis and the Celery worker containers alongside the local Django and Vite dev servers.

## Background

The backend currently has no async task queue. Adding Celery enables offloading slow or scheduled work (emails, data processing, periodic jobs) from the synchronous request cycle. Redis is the standard broker choice — lightweight, minimal ops overhead, and fully supported by Celery. Running Redis and the Celery worker in Docker keeps local dev machines clean while still allowing Django to run locally (for fast reloads and debugger access).

---

## Phases

### Phase 1 — Dependencies & Core Configuration

- [x] Add `celery[redis]` to `backend/pyproject.toml` dependencies
- [x] Create `backend/core/celery.py` — Celery app instance, auto-discovers tasks
- [x] Update `backend/core/__init__.py` to expose the Celery app (so Django loads it at startup)
- [x] Add Celery settings to `backend/core/settings/base.py`:
  - `CELERY_BROKER_URL`
  - `CELERY_RESULT_BACKEND`
  - `CELERY_ACCEPT_CONTENT`
  - `CELERY_TASK_SERIALIZER`
  - `CELERY_RESULT_SERIALIZER`
  - `CELERY_TIMEZONE` (mirrors `TIME_ZONE`)

### Phase 2 — Docker Services

- [x] Add `redis` service to `docker-compose.yml` (image `redis:7-alpine`, port `6379`)
- [x] Add `celery_worker` service to `docker-compose.yml`:
  - Builds from `./backend`
  - Command: `celery -A core worker --loglevel=info`
  - Depends on `db` and `redis`
  - Shares the same `env_file` and environment vars as `backend`
- [x] Add `celery_beat` service (optional, for periodic tasks):
  - Command: `celery -A core beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler`
  - Gated behind a comment — enable when `django-celery-beat` is added

### Phase 3 — `just dev` Integration

- [x] Add `celery-up` recipe to `justfile`:
  ```just
  celery-up:
      @docker compose ps --status running redis | grep -q redis \
          && echo "Redis already running." \
          || (echo "Starting Redis + Celery worker..." && docker compose up -d redis celery_worker)
  ```
- [x] Update `dev` recipe to call `celery-up` after `db-up`
- [x] Add `celery-logs` convenience recipe: `just logs-svc celery_worker`
- [x] Add `celery-worker` recipe to run the worker locally (outside Docker) for debugging

### Phase 4 — Example Task (Smoke Test)

- [ ] Create `backend/apps/pages/tasks.py` with a trivial `debug_task` that logs its request
- [ ] Write a test in `backend/apps/pages/tests.py` using `celery.contrib.pytest` fixtures (`celery_app`, `celery_worker`)

---

## Testing

**Unit tests:**
- Task functions are unit-tested directly (call the function, not `.delay()`)
- Use `@pytest.mark.django_db` where tasks touch the ORM
- Use `CELERY_TASK_ALWAYS_EAGER = True` in `test.py` settings so tasks run synchronously

**Integration tests:**
- Mark with `@pytest.mark.integration`
- Require a running Redis; skip in CI unless broker is available
- Use the `celery_worker` pytest fixture for in-process integration tests

**Manual verification:**
1. `just dev` — confirm Redis and celery_worker containers start
2. `docker compose logs -f celery_worker` — confirm worker connects to Redis and is ready
3. Open Django shell: `just be-shell`
4. `from apps.pages.tasks import debug_task; debug_task.delay()` — confirm task executes
5. Check celery_worker logs for task received + succeeded

---

## Risks & Notes

- **Broker URL env var:** `CELERY_BROKER_URL` must be set in `.env.example` (and `.env`). Inside Docker, use `redis://redis:6379/0`; locally, use `redis://localhost:6379/0`.
- **`celery_beat` deferred:** `django-celery-beat` requires a migration. It's included in Phase 2 as a commented service — activate only when periodic tasks are needed.
- **Worker concurrency:** Defaults to CPU count. For dev, `--concurrency=2` keeps resource usage low.
- **Result backend:** Redis is used for results too, keeping things simple. For production, consider a dedicated backend or disabling results if tasks are fire-and-forget.
- **No Flower in Phase 1:** Flower (Celery monitoring UI) can be added as a separate Docker service later (`just flower-up`).

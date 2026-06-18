# Plan: Dynamic Notification Scheduler

**Status:** Implemented
**Date:** 2026-06-18

---

## Goal

Build a test harness for **accurate background task execution at dynamic,
user-changeable times**: schedule an event to fire at time T, allow T to change
at any moment, and still have the event fire accurately at the new time — with
no worker/beat restart.

The "fire" action is intentionally lightweight (a log line + a status change on a
DB row recording scheduled vs. actual fire time) rather than hitting a real
notification channel — the point is to measure scheduling *accuracy*, not to
integrate a delivery provider.

## Background

The backend already runs Celery with `django-celery-beat`'s `DatabaseScheduler`
(see [completed/celery-full-implementation.md](completed/celery-full-implementation.md)),
so periodic schedules live in PostgreSQL and beat re-reads them continuously —
they are mutable at runtime. This plan builds the domain on top of that:

1. A model for the thing being scheduled (an `Event`).
2. Tasks that create future events and fire due ones.
3. A code-driven, version-controlled way to manage the periodic schedule, since
   the DB rows must not be hand-edited.

Conceptual background: [docs/explanations/dynamic-scheduling.md](../explanations/dynamic-scheduling.md).

---

## Phases

### Phase 1 — `notifications` app: the `Event` domain

- [x] `Event` model (UUID PK, `title`, `message`, `scheduled_time`, `status`
  pending/fired, `fired_at`, timestamps) with a `(status, scheduled_time)` index
- [x] `services.py`: `generate_future_events(count, within_minutes)` (evenly
  spaced events across the window) and `fire_due_events()` (the lightweight send)
- [x] `tasks.py`: `generate_events` and `fire_events` `@shared_task`s
- [x] REST API: `GET /api/notifications/events/` (list/detail) and
  `POST /api/notifications/events/generate/` (dispatch `generate_events`)
- [x] Admin registration + migration + tests

### Phase 2 — `tasks` app: code-driven periodic schedules

- [x] `scheduled_tasks.py` — `SCHEDULED_TASKS` source of truth (interval/crontab,
  optional args/kwargs); seeded with `generate_events` (every 20 min) and
  `fire_events` (every 1 min)
- [x] `sync_scheduled_tasks` management command — upserts `PeriodicTask` rows
  keyed on `name`, prunes unmanaged rows (preserves `celery.backend_cleanup`),
  supports `--dry-run`
- [x] Runtime control API: `/api/tasks/schedules/` (list/toggle/trigger) and
  `/api/tasks/results/` (list/detail)
- [x] Tests for the command and the API

### Phase 3 — Dev ergonomics & docs

- [x] `just be-sync-tasks` recipe; `be-dev` runs it after migrations
- [x] [docs/guides/background-tasks.md](../guides/background-tasks.md) guide
- [x] API contracts + architecture/dynamic-scheduling explanations updated

---

## How dynamic re-timing works

An event's `scheduled_time` is a plain DB column, editable at any time (admin,
shell, or a future PATCH endpoint). Because `fire_events` runs once a minute and
selects `status=pending, scheduled_time <= now`, changing an event's time
re-times when it fires — accurate to within the tick, no restart. The harness can
compare `scheduled_time` vs. `fired_at` to measure accuracy.

## Testing

- `just be-test` — unit tests for services (spacing, windowing, fire selection),
  both tasks, the events API, the `sync_scheduled_tasks` command (create/update/
  prune/dry-run), and the schedule/result API. Celery runs eagerly in tests.

## Risks & Notes

- **Polling floor.** Accuracy is bounded by beat's tick and the `fire_events`
  interval (1 min here). Sub-second precision is out of scope for a polling
  scheduler — lower the interval for tighter accuracy at the cost of more DB reads.
- **Managed rows are authoritative.** Hand-edited `PeriodicTask` rows for managed
  tasks are overwritten/pruned on the next `sync_scheduled_tasks`. Toggling
  `enabled` via the API is ad-hoc only; make it permanent in `scheduled_tasks.py`.
- **Out of scope (future):** per-notification `ClockedSchedule` re-timing, a
  dedicated `NotificationLog` table, and real delivery channels.
</content>
</invoke>

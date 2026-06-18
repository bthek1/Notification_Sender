# Background Tasks & `sync_scheduled_tasks`

How periodic background work is defined, scheduled, and run in Notification
Sender, and how the `sync_scheduled_tasks` management command keeps the database
in sync with version-controlled code.

## Overview

Background work is handled by **Celery** (async task execution) and **Celery
Beat** (the periodic scheduler). The scheduler reads its schedule from the
database via `django-celery-beat`'s `DatabaseScheduler`, configured in
[backend/core/settings/base.py](../../backend/core/settings/base.py):

```python
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
```

Because the schedule lives in the database (the `PeriodicTask` table), it is
**mutable at runtime** — beat re-reads it continuously, so a schedule can change
with no worker/beat restart. That is the whole point of this harness (see
[docs/explanations/dynamic-scheduling.md](../explanations/dynamic-scheduling.md)).
The flip side is that something has to drive those DB rows from code. That is the
job of `scheduled_tasks.py` (the source of truth) plus the `sync_scheduled_tasks`
command (the applier).

```
scheduled_tasks.py   ──►   sync_scheduled_tasks   ──►   PeriodicTask rows (DB)
(code, in git)             (management command)         (read by Celery Beat)
                                                              │
                                                              ▼
                                                        Celery worker runs
                                                        apps.notifications.tasks.*
```

## The pieces

| Piece | Location | Role |
|---|---|---|
| `app = Celery("core")` | [backend/core/celery.py](../../backend/core/celery.py) | Celery app; `autodiscover_tasks()` finds every `tasks.py` in installed apps |
| `SCHEDULED_TASKS` | [backend/apps/tasks/scheduled_tasks.py](../../backend/apps/tasks/scheduled_tasks.py) | **Single source of truth** — the list of all periodic tasks |
| `sync_scheduled_tasks` | [backend/apps/tasks/management/commands/sync_scheduled_tasks.py](../../backend/apps/tasks/management/commands/sync_scheduled_tasks.py) | Reconciles `PeriodicTask` rows with the list |
| Task functions | [backend/apps/notifications/tasks.py](../../backend/apps/notifications/tasks.py) | The actual `@shared_task` work that runs |
| REST API | [backend/apps/tasks/views.py](../../backend/apps/tasks/views.py), [urls.py](../../backend/apps/tasks/urls.py) | List/toggle/trigger schedules, inspect results |

> The `tasks` app has **no models of its own**. It relies on `django-celery-beat`
> (`PeriodicTask`, `IntervalSchedule`, `CrontabSchedule`, `ClockedSchedule` — the
> last used for per-event one-off fire schedules) and `django-celery-results`
> (`TaskResult`).

## `SCHEDULED_TASKS`: the source of truth

`scheduled_tasks.py` declares a list of dicts, one per periodic task. Each dict
maps to exactly one `PeriodicTask` row. Two schedule shapes are supported.

**Interval** — run every N units:

```python
{
    "name": "notifications-reconcile-pending",                          # unique identifier (also the DB row name)
    "task": "apps.notifications.tasks.reconcile_pending_events_task",   # dotted path to the @shared_task
    "schedule_type": "interval",
    "every": 1,
    "period": "minutes",                                             # seconds | minutes | hours | days
    "enabled": True,
}
```

**Crontab** — run at specific clock times (unspecified fields default to `"*"`):

```python
{
    "name": "example-weekly",
    "task": "apps.example.tasks.do_thing",
    "schedule_type": "crontab",
    "minute": "0",
    "hour": "1",
    "day_of_week": "0",                             # Sunday 01:00
    "enabled": True,
}
```

Optional `args` (list) and `kwargs` (dict) are passed through to the task — e.g.
`notifications-generate-events` uses `"kwargs": {"count": 5, "within_minutes": 20}`.

### To add or change a task

1. Edit the `SCHEDULED_TASKS` list in `scheduled_tasks.py`.
2. Run `just be-sync-tasks` (or `python manage.py sync_scheduled_tasks`).

Never hand-edit `PeriodicTask` rows in the DB or admin for managed tasks — the
next sync will overwrite (or prune) them.

## The `sync_scheduled_tasks` command

The command reconciles the database to match the code. For each spec it does an
`update_or_create` keyed on `name`; afterwards it prunes any `PeriodicTask` row
whose name is not in `SCHEDULED_TASKS` (the built-in `celery.backend_cleanup` row
and the dynamically-armed per-event `fire-event-*` clocked rows are always
preserved).

```bash
just be-sync-tasks            # apply changes
just be-sync-tasks --dry-run  # preview only, writes nothing
```

What it does, step by step:

1. **Resolve the schedule.** For an `interval` spec it `get_or_create`s an
   `IntervalSchedule(every, period)`; for a `crontab` spec it `get_or_create`s a
   `CrontabSchedule(minute, hour, day_of_week, day_of_month, month_of_year)`.
   Schedule objects are shared/reused across tasks with the same timing.
2. **Upsert the task.** `PeriodicTask.objects.update_or_create(name=...)` sets
   `task`, `enabled`, the resolved `interval`/`crontab` (one is set, the other
   `None`), and any JSON-encoded `args`/`kwargs`. Prints `created:` or `updated:`.
3. **Prune.** Any non-managed `PeriodicTask` is deleted (prints `delete:`), except
   `celery.backend_cleanup` and the per-event `fire-event-*` clocked rows (armed
   dynamically, never in `SCHEDULED_TASKS` — pruning them would silently disable
   all pending event firing). This is what makes the code authoritative — a
   removed entry in `scheduled_tasks.py` disappears from the DB on the next sync.

`--dry-run` prints `[dry-run] would create/update/delete: <name>` without
touching the database. The command is idempotent and safe to run on every deploy.

## The scheduled tasks

The actual work lives in
[backend/apps/notifications/tasks.py](../../backend/apps/notifications/tasks.py)
as Celery `@shared_task` functions.

| Task | Schedule | What it does |
|---|---|---|
| `generate_events` | every 1 min, `count=10, within_minutes=5` | Creates `pending` `Event` rows spread across the next few minutes and arms each one |
| `reconcile_pending_events_task` | every 1 min | Backstop: arms any `pending` event missing a clocked fire schedule (covers bulk/out-of-band creates that bypass the signal) |
| `cleanup_fired_clocked_tasks_task` | every 10 min | Deletes `fire-event-*` rows for gone/fired events and sweeps orphaned `ClockedSchedule` rows |
| `fire_event` | dispatched by beat from a one-off `ClockedSchedule` | Fires one `scheduled` event when its clocked time arrives; idempotent and re-time-aware |

Accuracy comes from a **clocked task per event**, not a poll: arming writes a
one-off `fire-event-<id>` `PeriodicTask` pointing at a `ClockedSchedule` for the
event's exact `scheduled_time`, and **beat** dispatches it at the first tick after
that time (accuracy bounded by `CELERY_BEAT_MAX_LOOP_INTERVAL`, set to 1 s).
Changing an event's `scheduled_time` at any moment moves that clocked schedule in
place (via a `post_save` signal) — no revoke, no restart. The lifecycle is an
explicit state machine — `pending → scheduled → fired` — described in
[dynamic-scheduling.md](../explanations/dynamic-scheduling.md#the-event-state-machine).
See [docs/plans/completed/clocked-event-firing.md](../plans/completed/clocked-event-firing.md).

## Inspecting and controlling tasks at runtime

The `tasks` app exposes a small REST API (all `IsAuthenticated`). Full request/
response shapes are in
[docs/standards/api-contracts.md](../standards/api-contracts.md#background-tasks).

| Endpoint | View | Purpose |
|---|---|---|
| `GET /api/tasks/schedules/` | `PeriodicTaskListView` | List all periodic tasks (with interval/crontab) |
| `PATCH /api/tasks/schedules/<pk>/` | `PeriodicTaskToggleView` | Enable/disable a task (`{"enabled": bool}`) |
| `POST /api/tasks/schedules/<pk>/trigger/` | `PeriodicTaskTriggerView` | Fire a task immediately; returns `{"task_id"}` |
| `GET /api/tasks/results/` | `TaskResultListView` | Recent run results (optional `?status=`) |
| `GET /api/tasks/results/<task_id>/` | `TaskResultDetailView` | One run's result |

Toggling `enabled` via the API is fine for ad-hoc pausing, but note that
`sync_scheduled_tasks` resets `enabled` to the value in `scheduled_tasks.py` on
the next run — make a setting permanent by editing the code.

## Running the stack locally

```bash
docker compose up            # api, worker, beat, redis, db, frontend
# or, piecemeal (see docs/guides/celery_setup.md):
just be-migrate              # create the django-celery-beat tables
just be-sync-tasks           # populate PeriodicTask rows from code
```

To trigger a single task without the scheduler, use the API `trigger` endpoint
or call it from `just be-shell`:

```python
from apps.notifications.tasks import generate_events
generate_events.delay(count=5, within_minutes=20)   # enqueue
generate_events(count=5, within_minutes=20)         # run inline (synchronous)
```

# Dynamic Scheduling

How this project fires background tasks at precise, **runtime-changeable** times.

## The problem

We want to schedule a notification to fire at a specific time, let a user **change that time later**, and still have it fire accurately at the new time — without restarting any process and without losing the schedule if a process crashes.

A few naive approaches and why they fail here:

| Approach | Why it breaks |
|----------|---------------|
| `time.sleep()` until fire time in a worker | Blocks a worker for the whole delay; the time can't change once scheduled; a restart loses it. |
| `task.apply_async(eta=...)` | The ETA task sits in the broker/worker; **revoking and rescheduling on every edit** is fiddly, and very long ETAs hold broker memory and don't survive cleanly. (This project used ETA tasks previously — see the superseded [second-accurate-firing plan](../plans/completed/second-accurate-firing.md) — and moved off them for exactly these reasons.) |
| Static Celery `beat_schedule` dict in settings | Schedules are code. Changing one means a deploy + a `beat` restart — the opposite of user-editable. |

## The mechanism: django-celery-beat DatabaseScheduler

Celery `beat` is a single process that wakes up periodically, asks its scheduler "what is due?", and enqueues those tasks onto the broker (Redis) for a worker to run.

The default scheduler reads a static dict. We instead use:

```python
# core/settings/base.py
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
```

With the **DatabaseScheduler**, the schedule is a set of **rows in PostgreSQL**, not code. Beat re-reads those rows continuously, so:

- **Creating** a schedule = inserting a row.
- **Changing the time** = updating a row. Beat picks it up on its next sync — no restart.
- **Cancelling** = deleting the row (or setting `enabled = False`).
- **Durability** = the schedule survives worker/beat restarts because it lives in the DB.

### The model objects

`django-celery-beat` provides these tables (all editable via the Django admin or the ORM):

| Model | Purpose |
|-------|---------|
| `PeriodicTask` | The schedule entry: which task to run, its args/kwargs, enabled flag, and a foreign key to **one** schedule object below. |
| `IntervalSchedule` | "Every N seconds/minutes/hours/days." Recurring. |
| `CrontabSchedule` | Cron-style "at 09:00 every weekday." Recurring, timezone-aware. |
| `ClockedSchedule` | **A single wall-clock datetime** — fire once, then auto-disable. This is the primary type for a one-off "send at this exact time" notification. |
| `SolarSchedule` | Sunrise/sunset-relative (not used here). |

A `PeriodicTask` pointing at a `ClockedSchedule` is exactly "run this task once, at this datetime." To **change the time**, update the `ClockedSchedule.clocked_time` (or repoint the `PeriodicTask` at a new one) and re-enable the task.

### How beat notices a change

`DatabaseScheduler` keeps an in-memory copy and refreshes it. Two things drive how quickly an edit takes effect:

- **`django_celery_beat` change signal** — saving a `PeriodicTask` bumps a `PeriodicTasks.last_update` timestamp; beat checks this and reloads the schedule when it changes.
- **`beat_max_loop_interval`** — the longest beat will sleep between ticks. With the database scheduler the effective sync interval is ~5 seconds by default. We lower it to **1 second** (`CELERY_BEAT_MAX_LOOP_INTERVAL = 1` in `core/settings/base.py`) so both edits *and fires* land within ~1 second.

This per-tick granularity is the key trade-off to understand for **accuracy** (below): because firing is now driven by beat (not a worker holding an ETA), the beat loop interval is the accuracy floor.

## Accuracy: scheduled vs. actual

"Accurate" here means: the task actually runs close to the time it was scheduled for, and we can *measure* the gap.

### From polling to clocked exact-time scheduling

The original approach polled: a single `fire_events` task ran every five minutes and bulk-marked every past-due event. That makes the delay between `scheduled_time` and `fired_at` as large as the poll interval — minutes — which is the dominant source by far.

We instead **give each event its own one-off `ClockedSchedule` + `PeriodicTask`**, and let **beat** dispatch it (see [docs/plans/completed/clocked-event-firing.md](../plans/completed/clocked-event-firing.md)):

1. When an event is created or re-timed, `_arm_event` claims it `pending → scheduled` and writes a one-off `PeriodicTask` named `fire-event-<id>` pointing at a `ClockedSchedule` for its `scheduled_time` (args `[id]`, `one_off=True`). The `ClockedSchedule` is deduped by time, so many events at the same instant share one row.
2. **Beat** scans all clocked rows every tick and dispatches each at the first tick `≥ clocked_time`. There is **no rolling-window armer** — beat already sees every clocked row regardless of how far out it is, so arming happens once, at creation.
3. `fire_event` (`fire_single_event`) is **idempotent and re-time-aware**: it no-ops an already-fired event, skips one whose time was pushed into the future since beat dispatched it, and on a successful fire **tears down** its `PeriodicTask` row.

> **Beat is on the hot path.** Every fire now depends on beat running — a beat outage stops all firing (with ETA, already-armed tasks would still fire from the broker). In exchange there are **no long-lived broker messages** and **no best-effort revoke**. The DB stays the source of truth, so a restarted beat re-reads every clocked row and resumes.

> **No sweeper, but a reconciler + cleanup.** A `pending` event that never got armed (e.g. a bulk write that bypassed the `post_save` signal) is caught by `reconcile_pending_events` (periodic, every 1 min), which arms any unarmed `pending` row. `cleanup_fired_clocked_tasks` (periodic, every 10 min) deletes `fire-event-*` rows for gone/fired events and sweeps orphaned `ClockedSchedule` rows so the beat tables don't grow unbounded.

### The event state machine

`Event.status` makes the dispatch lifecycle explicit:

```
            arm: write clocked PeriodicTask        beat dispatches at tick ≥ clocked_time
  PENDING ──────────────────────────────────▶ SCHEDULED ──────────────────────────────────▶ FIRED
     ▲                                             │
     └─────────────────────────────────────────────┘
        reconciler arms an unarmed PENDING row;  re-time moves the clocked schedule in place (stays SCHEDULED)
```

- **`pending`** — created, not yet armed. The arm's claim (`status=PENDING` → `SCHEDULED`) is the **dedup lock**: a concurrent armer that loses the claim never writes an orphan row.
- **`scheduled`** — a one-off clocked `fire_event` `PeriodicTask` exists for the exact time. A re-time **updates that row's schedule in place** — the event stays `scheduled`, no bounce back to `pending`.
- **`fired`** — terminal. The fire is a status-guarded `UPDATE` over `{pending, scheduled}`, so an event can never fire twice; the `PeriodicTask` row is then deleted.

### How dynamic re-timing stays accurate

Changing an event's `scheduled_time` via the ORM (admin/shell/API) triggers a `post_save` signal → `retime_event`, which **moves the clocked schedule** (`get_or_create` a `ClockedSchedule` at the new time, repoint the `PeriodicTask`). **No revoke** — the wrong-time fire simply can't be dispatched because the schedule itself moved. Beat re-reads the row and dispatches at the new time. The idempotent `fire_event` remains the backstop for the narrow window where beat dispatched the old time just before the edit landed: it sees the event isn't due yet, defers, and re-asserts the arm.

### Residual sources of delay

1. **Beat loop interval** — the dominant floor. A clocked task fires at the first beat tick `≥ clocked_time`, so accuracy is bounded by `CELERY_BEAT_MAX_LOOP_INTERVAL` (set to **1 s** here). This replaces ETA's sub-second worker-wake jitter — it is the central cost of the clocked design.
2. **Broker + worker pickup** — once beat enqueues, a free worker picks it up. Usually milliseconds; longer if all workers are busy (`CELERY_WORKER_PREFETCH_MULTIPLIER = 1` and `CELERY_TASK_ACKS_LATE = True` keep long tasks from starving short ones).
3. **Clock/timezone** — `CELERY_TIMEZONE` follows Django's `TIME_ZONE`. Always store and compare timezone-aware datetimes.

**How we measure it:** each `Event` row carries its *scheduled* time (`scheduled_time`) and, once fired, its *actual* fire time (`fired_at`, set to `timezone.now()` at execution, stamped per event). The delta between the two is the accuracy of a single event. `django-celery-results` separately records each task run's timing.

> **Target:** second accuracy (p99 < 2 s), looser than the ETA path's sub-second because of the beat-tick floor. If sub-second is a hard requirement, the ETA approach is strictly better on raw precision — see the [clocked-event-firing plan](../plans/completed/clocked-event-firing.md) for the tradeoff discussion.

## Where this lives in the repo

- `core/celery.py` — the Celery app; autodiscovers each app's `tasks.py`.
- `core/settings/base.py` — the `CELERY_*` config, including `CELERY_BEAT_SCHEDULER`.
- `docker-compose.yml` — `celery_worker` and `celery_beat` services (beat runs with `--scheduler django_celery_beat.schedulers:DatabaseScheduler`).
- `apps/notifications/` — the `Event` model (a point-in-time row with `scheduled_time`/`status`/`fired_at`/`dispatch_task_id`), the `generate_events` task that seeds + arms future events, `_arm_event`/`retime_event` (write and move the per-event clocked `PeriodicTask`), the `fire_event` task that fires one event when beat dispatches it, and the `reconcile_pending_events` / `cleanup_fired_clocked_tasks` backstops. A `post_save` signal arms new events and moves the clocked schedule when `scheduled_time` changes, so an event re-times accurately with no restart. Tune the reconciler/cleanup cadence in `apps/tasks/scheduled_tasks.py`.
- `apps/tasks/` — periodic-schedule management: `SCHEDULED_TASKS` (the in-git source of truth), the `sync_scheduled_tasks` command that applies it to `PeriodicTask` rows, and the `/api/tasks/` schedule/result API. See [docs/guides/background-tasks.md](../guides/background-tasks.md).

## Further reading

- [django-celery-beat docs](https://django-celery-beat.readthedocs.io/)
- [Celery periodic tasks](https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html)
- [docs/guides/celery_setup.md](../guides/celery_setup.md) — running the worker, beat, and Flower locally
</content>

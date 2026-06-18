# Dynamic Scheduling

How this project fires background tasks at precise, **runtime-changeable** times.

## The problem

We want to schedule a notification to fire at a specific time, let a user **change that time later**, and still have it fire accurately at the new time — without restarting any process and without losing the schedule if a process crashes.

A few naive approaches and why they fail here:

| Approach | Why it breaks |
|----------|---------------|
| `time.sleep()` until fire time in a worker | Blocks a worker for the whole delay; the time can't change once scheduled; a restart loses it. |
| `task.apply_async(eta=...)` | The ETA task sits in the broker/worker; **revoking and rescheduling on every edit** is fiddly, and very long ETAs hold broker memory and don't survive cleanly. |
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
- **`beat_max_loop_interval`** — the longest beat will sleep between ticks. With the database scheduler the effective sync interval is ~5 seconds by default, so edits are reflected within a few seconds.

This few-second granularity is the key trade-off to understand for **accuracy** (below).

## Accuracy: scheduled vs. actual

"Accurate" here means: the task actually runs close to the time it was scheduled for, and we can *measure* the gap.

### From polling to windowed exact-time scheduling

The original approach polled: a single `fire_events` task ran every five minutes and bulk-marked every past-due event. That makes the delay between `scheduled_time` and `fired_at` as large as the poll interval — minutes — which is the dominant source by far.

We instead **pre-schedule a one-shot task per event at its exact time** (see [docs/plans/second-accurate-firing.md](../plans/second-accurate-firing.md)):

1. A periodic **scheduler** (`schedule_upcoming_events`, every **1 minute**) looks a **10-minute window** into the future and, for each `pending` event entering that window, arms `fire_event.apply_async(args=[id], eta=scheduled_time)` and moves it to `scheduled`. The Celery id is stored on the row (`Event.dispatch_task_id`) so overlapping passes don't double-arm.
2. The **worker holds** each armed task and runs it at its `eta`, so firing is **second-accurate** — the delay is just the broker hop + worker dispatch, not a poll interval.
3. `fire_event` (`fire_single_event`) is **idempotent and re-time-aware**: it no-ops an already-fired event and, if the event was pushed into the future since arming, returns it to `pending` so the scheduler re-arms it at the new time.
4. A low-frequency **sweeper** (`fire_events` → `fire_due_events`, every 5 minutes) is the durability backstop: it fires anything past due (`pending` or `scheduled`) whose armed task was lost (worker downtime, broker flush) or never armed.

### The event state machine

`Event.status` makes the dispatch lifecycle explicit rather than inferring it from `dispatch_task_id`:

```
            scheduler arms (eta set)            worker fires at eta / sweeper
  PENDING ───────────────────────────▶ SCHEDULED ───────────────────────────▶ FIRED
     ▲                                     │
     └─────────────────────────────────────┘
        re-timed (post_save) or pushed-later defer → back to PENDING, re-armed
```

- **`pending`** — created, not yet armed. The scheduler's claim (`status=PENDING` → `SCHEDULED`) is also the **dedup lock**: a concurrent armer that loses the claim never enqueues an orphan task.
- **`scheduled`** — a one-shot `fire_event` is armed with an exact `eta`.
- **`fired`** — terminal. The fire is a status-guarded `UPDATE` over `{pending, scheduled}`, so an event can never fire twice.

A re-time (or a pushed-later defer) sends a `scheduled` event back to `pending` so it can be cleanly re-armed.

The 10-minute window bounds how far ahead any ETA sits in the broker, so this stays light regardless of how far out events are scheduled.

### How dynamic re-timing stays accurate

Changing an event's `scheduled_time` via the ORM (admin/shell/API) triggers a `post_save` signal that **revokes** the stale armed task and **re-arms** at the new time (immediately if it's already inside the window, otherwise the next scheduler pass picks it up). Revoke is best-effort, so the idempotent `fire_event` is the real guard — a stale task that still runs is a no-op or a skip, never a wrong-time fire.

### Residual sources of delay

1. **Broker + worker pickup** — enqueue → a free worker picks it up. Usually milliseconds; longer if all workers are busy (note `CELERY_WORKER_PREFETCH_MULTIPLIER = 1` and `CELERY_TASK_ACKS_LATE = True` keep long tasks from starving short ones).
2. **Arming latency for near-term events** — an event whose `scheduled_time` is sooner than the next scheduler pass (i.e. created <1 min before it's due) is only armed on that pass and may fire via the sweeper instead. Events spread over minutes (the harness default) are unaffected.
3. **Clock/timezone** — `CELERY_TIMEZONE` follows Django's `TIME_ZONE`. Always store and compare timezone-aware datetimes.

**How we measure it:** each `Event` row carries its *scheduled* time (`scheduled_time`) and, once fired, its *actual* fire time (`fired_at`, set to `timezone.now()` at execution — now stamped **per event** on the exact-time path, not batched). The delta between the two is the accuracy of a single event. `django-celery-results` separately records each task run's timing.

> **Target:** second accuracy (p99 < 1 s), not microseconds. Tighter precision would need a busy-wait timer process and clock discipline — out of scope; see the plan's "honest floor" discussion.

## Where this lives in the repo

- `core/celery.py` — the Celery app; autodiscovers each app's `tasks.py`.
- `core/settings/base.py` — the `CELERY_*` config, including `CELERY_BEAT_SCHEDULER`.
- `docker-compose.yml` — `celery_worker` and `celery_beat` services (beat runs with `--scheduler django_celery_beat.schedulers:DatabaseScheduler`).
- `apps/notifications/` — the `Event` model (a point-in-time row with `scheduled_time`/`status`/`fired_at`/`dispatch_task_id`), the `generate_events` task that seeds future events, the `schedule_upcoming_events` scheduler that arms an exact-time `fire_event` task per upcoming event, the `fire_event` task that fires one event at its `eta`, and the `fire_events` sweeper backstop. A `post_save` signal revokes/re-arms when `scheduled_time` changes, so an event re-times accurately with no restart. Tune the scheduler interval/window and the sweeper in `apps/tasks/scheduled_tasks.py`.
- `apps/tasks/` — periodic-schedule management: `SCHEDULED_TASKS` (the in-git source of truth), the `sync_scheduled_tasks` command that applies it to `PeriodicTask` rows, and the `/api/tasks/` schedule/result API. See [docs/guides/background-tasks.md](../guides/background-tasks.md).

## Further reading

- [django-celery-beat docs](https://django-celery-beat.readthedocs.io/)
- [Celery periodic tasks](https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html)
- [docs/guides/celery_setup.md](../guides/celery_setup.md) — running the worker, beat, and Flower locally
</content>

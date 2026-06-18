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

Sources of delay between the scheduled time and the actual run:

1. **Beat tick granularity** — beat only checks "what's due?" every few seconds, so a task can fire up to roughly one tick interval late.
2. **Broker + worker pickup** — enqueue → a free worker picks it up. Usually milliseconds; longer if all workers are busy (note `CELERY_WORKER_PREFETCH_MULTIPLIER = 1` and `CELERY_TASK_ACKS_LATE = True` in settings keep long tasks from starving short ones).
3. **Clock/timezone** — `CELERY_TIMEZONE` follows Django's `TIME_ZONE`. Always store and compare timezone-aware datetimes; `ClockedSchedule` is UTC-based internally.

**How we measure it:** each `Event` row carries its *scheduled* time (`scheduled_time`) and, once `fire_events` processes it, its *actual* fire time (`fired_at`, set to `timezone.now()` at execution). The delta between the two is the accuracy of a single event. `django-celery-results` separately records each task run's timing. Comparing these over many events is the actual experiment this repo exists to run. (A dedicated `NotificationLog` table is noted as out of scope for now — see the [plan](../plans/dynamic-notification-scheduler.md).)

> **Tuning note:** if you need tighter-than-tick accuracy, lower beat's max loop interval — at the cost of more frequent DB reads. There is a floor: this is a *polling* scheduler, not an interrupt. Sub-second precision is out of scope for django-celery-beat.

## Where this lives in the repo

- `core/celery.py` — the Celery app; autodiscovers each app's `tasks.py`.
- `core/settings/base.py` — the `CELERY_*` config, including `CELERY_BEAT_SCHEDULER`.
- `docker-compose.yml` — `celery_worker` and `celery_beat` services (beat runs with `--scheduler django_celery_beat.schedulers:DatabaseScheduler`).
- `apps/notifications/` — the `Event` model (a point-in-time row with `scheduled_time`/`status`/`fired_at`), the `generate_events` task that seeds future events, and the `fire_events` task that marks events as fired once their time passes. An event's `scheduled_time` can be changed at any moment and `fire_events` (running every 5 minutes — tune the interval in `apps/tasks/scheduled_tasks.py`) still fires it accurately at the new time, bounded by that interval.
- `apps/tasks/` — periodic-schedule management: `SCHEDULED_TASKS` (the in-git source of truth), the `sync_scheduled_tasks` command that applies it to `PeriodicTask` rows, and the `/api/tasks/` schedule/result API. See [docs/guides/background-tasks.md](../guides/background-tasks.md).

## Further reading

- [django-celery-beat docs](https://django-celery-beat.readthedocs.io/)
- [Celery periodic tasks](https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html)
- [docs/guides/celery_setup.md](../guides/celery_setup.md) — running the worker, beat, and Flower locally
</content>

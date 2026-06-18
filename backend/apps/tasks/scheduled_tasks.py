"""Single source of truth for all periodic (Celery Beat) tasks.

Each dict in ``SCHEDULED_TASKS`` maps to exactly one ``PeriodicTask`` row in the
database. The rows are not hand-edited — run ``python manage.py
sync_scheduled_tasks`` to reconcile the database with this list (see
``apps.tasks.management.commands.sync_scheduled_tasks``).

Two schedule shapes are supported:

* ``interval`` — run every N units::

    {
        "name": "notifications-reconcile-pending",
        "task": "apps.notifications.tasks.reconcile_pending_events_task",
        "schedule_type": "interval",
        "every": 1,
        "period": "minutes",          # seconds | minutes | hours | days
        "enabled": True,
    }

* ``crontab`` — run at specific clock times (unspecified fields default to "*")::

    {
        "name": "example-weekly",
        "task": "apps.example.tasks.do_thing",
        "schedule_type": "crontab",
        "minute": "0",
        "hour": "1",
        "day_of_week": "0",           # Sunday 01:00
        "enabled": True,
    }

Optional ``args`` (list) and ``kwargs`` (dict) are passed through to the task.
"""

SCHEDULED_TASKS = [
    {
        "name": "notifications-generate-events",
        "task": "apps.notifications.tasks.generate_events",
        "schedule_type": "interval",
        "every": 1,
        "period": "minutes",
        "kwargs": {"count": 10, "within_minutes": 5},
        "enabled": True,
    },
    {
        # Backstop reconciler: arm any PENDING event that has no clocked fire
        # schedule. Firing itself is driven by per-event one-off ClockedSchedule
        # rows that beat dispatches directly — there is no rolling-window armer.
        # This only catches events created/edited by paths that bypass the
        # post_save signal (e.g. QuerySet.update); near-term events are armed at
        # creation, so a 1-minute cadence is ample.
        "name": "notifications-reconcile-pending",
        "task": "apps.notifications.tasks.reconcile_pending_events_task",
        "schedule_type": "interval",
        "every": 1,
        "period": "minutes",
        "enabled": True,
    },
    {
        # Cleanup: delete fire PeriodicTask rows for gone/FIRED events and sweep
        # orphaned ClockedSchedule rows so the beat tables don't grow unbounded.
        "name": "notifications-cleanup-fired",
        "task": "apps.notifications.tasks.cleanup_fired_clocked_tasks_task",
        "schedule_type": "interval",
        "every": 10,
        "period": "minutes",
        "enabled": True,
    },
]

"""Single source of truth for all periodic (Celery Beat) tasks.

Each dict in ``SCHEDULED_TASKS`` maps to exactly one ``PeriodicTask`` row in the
database. The rows are not hand-edited — run ``python manage.py
sync_scheduled_tasks`` to reconcile the database with this list (see
``apps.tasks.management.commands.sync_scheduled_tasks``).

Two schedule shapes are supported:

* ``interval`` — run every N units::

    {
        "name": "notifications-fire-events",
        "task": "apps.notifications.tasks.fire_events",
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
        "every": 20,
        "period": "minutes",
        "kwargs": {"count": 5, "within_minutes": 20},
        "enabled": True,
    },
    {
        "name": "notifications-fire-events",
        "task": "apps.notifications.tasks.fire_events",
        "schedule_type": "interval",
        "every": 5,
        "period": "minutes",
        "enabled": True,
    },
]

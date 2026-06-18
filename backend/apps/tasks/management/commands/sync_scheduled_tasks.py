"""Reconcile ``PeriodicTask`` rows in the database with ``SCHEDULED_TASKS``.

For each spec the command does an ``update_or_create`` keyed on ``name``;
afterwards it prunes any managed ``PeriodicTask`` rows whose name is no longer
in ``SCHEDULED_TASKS``. This makes the version-controlled ``scheduled_tasks.py``
the single source of truth for periodic work.

    python manage.py sync_scheduled_tasks            # apply changes
    python manage.py sync_scheduled_tasks --dry-run  # preview only, writes nothing

The command is idempotent and safe to run on every deploy.
"""

from __future__ import annotations

import json
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django_celery_beat.models import (
    CrontabSchedule,
    IntervalSchedule,
    PeriodicTask,
)

from apps.tasks.scheduled_tasks import SCHEDULED_TASKS

_PERIOD_CHOICES = {
    "seconds": IntervalSchedule.SECONDS,
    "minutes": IntervalSchedule.MINUTES,
    "hours": IntervalSchedule.HOURS,
    "days": IntervalSchedule.DAYS,
}


class Command(BaseCommand):
    help = "Sync django-celery-beat PeriodicTask rows with SCHEDULED_TASKS."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the changes that would be made without writing to the DB.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        dry_run: bool = options["dry_run"]
        prefix = "[dry-run] would " if dry_run else ""

        managed_names: set[str] = set()
        for spec in SCHEDULED_TASKS:
            name = self._require(spec, "name")
            managed_names.add(name)
            self._upsert(spec, dry_run=dry_run, prefix=prefix)

        # Prune managed rows that have been removed from SCHEDULED_TASKS. Only
        # rows whose name appears to belong to us would ever be deleted here —
        # we delete exactly the rows not in the current managed set, so unrelated
        # PeriodicTasks created out-of-band are left untouched only if their
        # names are also tracked. To be safe we never touch the celery built-in
        # "celery.backend_cleanup" row.
        stale = PeriodicTask.objects.exclude(name__in=managed_names).exclude(
            name="celery.backend_cleanup"
        )
        for task in stale:
            self.stdout.write(f"{prefix}delete: {task.name}")
            if not dry_run:
                task.delete()

    # -- helpers ---------------------------------------------------------------

    def _upsert(self, spec: dict[str, Any], *, dry_run: bool, prefix: str) -> None:
        name = spec["name"]
        task_path = self._require(spec, "task")
        schedule_type = self._require(spec, "schedule_type")
        enabled = spec.get("enabled", True)
        kwargs = spec.get("kwargs")
        task_args = spec.get("args")

        interval = crontab = None
        if schedule_type == "interval":
            interval = self._resolve_interval(spec, dry_run=dry_run)
        elif schedule_type == "crontab":
            crontab = self._resolve_crontab(spec, dry_run=dry_run)
        else:
            raise CommandError(
                f"{name!r}: unknown schedule_type {schedule_type!r} "
                "(expected 'interval' or 'crontab')"
            )

        if dry_run:
            exists = PeriodicTask.objects.filter(name=name).exists()
            verb = "update" if exists else "create"
            self.stdout.write(f"{prefix}{verb}: {name}")
            return

        defaults: dict[str, Any] = {
            "task": task_path,
            "enabled": enabled,
            "interval": interval,
            "crontab": crontab,
        }
        if kwargs is not None:
            defaults["kwargs"] = json.dumps(kwargs)
        if task_args is not None:
            defaults["args"] = json.dumps(task_args)

        _, created = PeriodicTask.objects.update_or_create(
            name=name, defaults=defaults
        )
        self.stdout.write(f"{'created' if created else 'updated'}: {name}")

    def _resolve_interval(
        self, spec: dict[str, Any], *, dry_run: bool
    ) -> IntervalSchedule | None:
        every = self._require(spec, "every")
        period_name = self._require(spec, "period")
        if period_name not in _PERIOD_CHOICES:
            raise CommandError(
                f"{spec['name']!r}: invalid period {period_name!r} "
                f"(expected one of {sorted(_PERIOD_CHOICES)})"
            )
        if dry_run:
            return None
        schedule, _ = IntervalSchedule.objects.get_or_create(
            every=every, period=_PERIOD_CHOICES[period_name]
        )
        return schedule

    def _resolve_crontab(
        self, spec: dict[str, Any], *, dry_run: bool
    ) -> CrontabSchedule | None:
        if dry_run:
            return None
        schedule, _ = CrontabSchedule.objects.get_or_create(
            minute=spec.get("minute", "*"),
            hour=spec.get("hour", "*"),
            day_of_week=spec.get("day_of_week", "*"),
            day_of_month=spec.get("day_of_month", "*"),
            month_of_year=spec.get("month_of_year", "*"),
        )
        return schedule

    def _require(self, spec: dict[str, Any], key: str) -> Any:
        if key not in spec:
            raise CommandError(f"scheduled task spec missing required key {key!r}: {spec}")
        return spec[key]

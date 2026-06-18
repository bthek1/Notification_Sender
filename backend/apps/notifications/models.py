import uuid
from datetime import datetime

from django.db import models


class Event(models.Model):
    """A point-in-time event scheduled to occur at ``scheduled_time``.

    Events are typically created ahead of time (e.g. by the
    ``generate_future_events`` task) and fired by a worker once their
    ``scheduled_time`` is reached. The "fire" action in this harness is
    intentionally lightweight — see ``apps.notifications.tasks``.
    """

    class Status(models.TextChoices):
        # Lifecycle: PENDING (created, not yet armed) → SCHEDULED (a one-off
        # clocked fire_event PeriodicTask is armed for the exact time) → FIRED
        # (sent). A re-time moves the clocked schedule in place; the event stays
        # SCHEDULED. The reconciler arms any PENDING event missing a schedule.
        PENDING = "pending", "Pending"
        SCHEDULED = "scheduled", "Scheduled"
        FIRED = "fired", "Fired"

    # Set by ``from_db`` to the persisted scheduled_time; used by the re-time
    # signal to detect a changed schedule. Not a database field.
    _loaded_scheduled_time: datetime | None = None

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True)
    scheduled_time = models.DateTimeField(
        help_text="When this event is scheduled to occur.",
        db_index=True,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    fired_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Actual time the event was fired (null until fired).",
    )
    dispatch_task_id = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        editable=False,
        help_text=(
            "Name of the one-off clocked fire_event PeriodicTask armed while this "
            "event is SCHEDULED (deterministically 'fire-event-<id>'). Stored for "
            "inspectability/rollback; the row is keyed by name, not this column."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_time"]
        indexes = [
            models.Index(fields=["status", "scheduled_time"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} @ {self.scheduled_time.isoformat()}"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        # Remember the persisted scheduled_time so a post_save signal can detect
        # a re-time (and move the clocked schedule) without an extra query.
        instance._loaded_scheduled_time = instance.scheduled_time
        return instance

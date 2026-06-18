import uuid

from django.db import models


class Event(models.Model):
    """A point-in-time event scheduled to occur at ``scheduled_time``.

    Events are typically created ahead of time (e.g. by the
    ``generate_future_events`` task) and fired by a worker once their
    ``scheduled_time`` is reached. The "fire" action in this harness is
    intentionally lightweight — see ``apps.notifications.tasks``.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        FIRED = "fired", "Fired"

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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_time"]
        indexes = [
            models.Index(fields=["status", "scheduled_time"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} @ {self.scheduled_time.isoformat()}"

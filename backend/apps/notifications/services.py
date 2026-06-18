from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import Event


@transaction.atomic
def generate_future_events(count: int = 5, within_minutes: int = 20) -> list[Event]:
    """Create ``count`` pending events spread evenly across the next
    ``within_minutes`` minutes, starting from now.

    With the defaults this produces 5 events in the next 20 minutes
    (one roughly every 4 minutes). Returns the created events.
    """
    if count < 1:
        raise ValueError("count must be >= 1")
    if within_minutes <= 0:
        raise ValueError("within_minutes must be > 0")

    now = timezone.now()
    # Evenly space `count` events across the window. The first event lands one
    # interval in, the last lands at the end of the window.
    step = timedelta(minutes=within_minutes) / count

    events = [
        Event(
            title=f"Generated event {i + 1}",
            message=f"Auto-generated event firing within {within_minutes} minutes.",
            scheduled_time=now + step * (i + 1),
        )
        for i in range(count)
    ]
    return Event.objects.bulk_create(events)


def fire_due_events() -> int:
    """Mark every pending event whose ``scheduled_time`` has passed as fired.

    Returns the number of events fired. This is the lightweight "send" action
    for the harness — in a real system it would dispatch to a channel.
    """
    now = timezone.now()
    due = Event.objects.filter(status=Event.Status.PENDING, scheduled_time__lte=now)
    return due.update(status=Event.Status.FIRED, fired_at=now)

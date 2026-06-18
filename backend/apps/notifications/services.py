from __future__ import annotations

import random
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import Event


@transaction.atomic
def generate_future_events(count: int = 5, within_minutes: int = 20) -> list[Event]:
    """Create ``count`` pending events at random times across the next
    ``within_minutes`` minutes, starting from now.

    With the defaults this produces 5 events scattered randomly over the next
    20 minutes. Returns the created events, ordered by scheduled time.
    """
    if count < 1:
        raise ValueError("count must be >= 1")
    if within_minutes <= 0:
        raise ValueError("within_minutes must be > 0")

    now = timezone.now()
    # Scatter `count` events at random offsets within the window. Each offset is a
    # random fraction of the window, so events are unevenly spaced. Sort so the
    # returned list (and the `Generated event N` titles) run in chronological
    # order.
    window_seconds = within_minutes * 60
    offsets = sorted(random.uniform(0, window_seconds) for _ in range(count))

    events = [
        Event(
            title=f"Generated event {i + 1}",
            message=f"Auto-generated event firing within {within_minutes} minutes.",
            scheduled_time=now + timedelta(seconds=offset),
        )
        for i, offset in enumerate(offsets)
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

import logging

from celery import shared_task

from .services import fire_due_events, generate_future_events

logger = logging.getLogger(__name__)


@shared_task
def generate_events(count: int = 5, within_minutes: int = 20) -> list[str]:
    """Generate ``count`` events spread across the next ``within_minutes`` minutes.

    Defaults to 5 events over the next 20 minutes. Returns the created event ids.
    """
    events = generate_future_events(count=count, within_minutes=within_minutes)
    logger.info(
        "generate_events created %d events over the next %d minutes",
        len(events),
        within_minutes,
    )
    return [str(event.id) for event in events]


@shared_task
def fire_events() -> int:
    """Fire all pending events whose scheduled_time has passed.

    Intended to be run periodically by Celery beat. Returns the count fired.
    """
    fired = fire_due_events()
    if fired:
        logger.info("fire_events fired %d due event(s)", fired)
    return fired

import logging

from celery import shared_task

from .services import (
    fire_due_events,
    fire_single_event,
    generate_future_events,
    schedule_upcoming_events,
)

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
def schedule_upcoming_events_task(window_minutes: int = 10) -> int:
    """Periodic scheduler: arm a one-shot fire task for each event entering the
    next ``window_minutes``-minute window. Returns the number armed this pass.
    """
    armed = schedule_upcoming_events(window_minutes=window_minutes)
    if armed:
        logger.info("schedule_upcoming_events armed %d event(s)", armed)
    return armed


@shared_task
def fire_event(event_id: str) -> str:
    """Fire a single event at its exact scheduled time. Armed by the scheduler
    with an ``eta``; idempotent and re-time-aware (see ``fire_single_event``).
    """
    result = fire_single_event(event_id)
    if result == "fired":
        logger.info("fire_event fired event %s", event_id)
    return result


@shared_task
def fire_events() -> int:
    """Sweeper: fire all pending events already past due. Low-frequency
    durability backstop for the exact-time path. Returns the count fired.
    """
    fired = fire_due_events()
    if fired:
        logger.info("fire_events (sweeper) fired %d due event(s)", fired)
    return fired

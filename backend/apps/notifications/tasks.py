import logging

from celery import shared_task

from .services import (
    cleanup_fired_clocked_tasks,
    fire_single_event,
    generate_future_events,
    reconcile_pending_events,
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
def fire_event(event_id: str) -> str:
    """Fire a single event at its scheduled time. Dispatched by beat from a
    one-off ``ClockedSchedule``; idempotent and re-time-aware (see
    ``fire_single_event``).
    """
    return fire_single_event(event_id)


@shared_task
def reconcile_pending_events_task() -> int:
    """Periodic backstop: arm any PENDING event missing a clocked fire schedule
    (covers bulk creates / out-of-band edits that bypass the re-time signal).
    Returns the number armed this pass.
    """
    armed = reconcile_pending_events()
    if armed:
        logger.info("reconcile_pending_events armed %d event(s)", armed)
    return armed


@shared_task
def cleanup_fired_clocked_tasks_task() -> int:
    """Periodic cleanup: delete fire PeriodicTask rows for gone/FIRED events and
    sweep orphaned ClockedSchedule rows. Returns the number of task rows removed.
    """
    removed = cleanup_fired_clocked_tasks()
    if removed:
        logger.info("cleanup_fired_clocked_tasks removed %d task row(s)", removed)
    return removed

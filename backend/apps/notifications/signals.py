from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Event
from .services import _arm_event, retime_event


@receiver(post_save, sender=Event)
def arm_or_retime_on_save(sender, instance: Event, created: bool, **kwargs):  # noqa: ARG001
    """Arm newly created events immediately, and move an event's clocked schedule
    when its ``scheduled_time`` changes.

    Only fires on real ORM saves (admin/shell/API ``PATCH``); the scheduler and
    fire tasks use ``QuerySet.update()``, which does not emit ``post_save``. Bulk
    creates (``generate_future_events``) bypass this and arm explicitly.
    """
    if instance.status == Event.Status.FIRED:
        return

    if created:
        _arm_event(instance)
        return

    old = getattr(instance, "_loaded_scheduled_time", None)
    if old is None or old == instance.scheduled_time:
        return

    retime_event(instance)
    # Keep the in-memory marker in sync for any subsequent save on this instance.
    instance._loaded_scheduled_time = instance.scheduled_time

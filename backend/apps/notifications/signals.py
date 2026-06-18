from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Event
from .services import retime_event


@receiver(post_save, sender=Event)
def retime_on_save(sender, instance: Event, created: bool, **kwargs):  # noqa: ARG001
    """Re-settle an event's clocked schedule when its ``scheduled_time`` changes.

    New events are *not* armed here — they stay PENDING until the windower
    (``sync_event_window``) reaches them, so creating a large future backlog stays
    cheap. Only a genuine re-time on a real ORM save (admin/shell/API ``PATCH``)
    does immediate work; the windower and fire tasks use ``QuerySet.update()``,
    which does not emit ``post_save``.
    """
    if created or instance.status == Event.Status.FIRED:
        return

    old = getattr(instance, "_loaded_scheduled_time", None)
    if old is None or old == instance.scheduled_time:
        return

    retime_event(instance)
    # Keep the in-memory marker in sync for any subsequent save on this instance.
    instance._loaded_scheduled_time = instance.scheduled_time

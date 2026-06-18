from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Event
from .services import retime_event


@receiver(post_save, sender=Event)
def revoke_and_rearm_on_retime(sender, instance: Event, created: bool, **kwargs):  # noqa: ARG001
    """When a pending event's ``scheduled_time`` changes, revoke its stale armed
    fire task and re-arm at the new time.

    Only fires on real ORM saves (admin/shell/API ``PATCH``); the scheduler and
    fire tasks use ``QuerySet.update()``, which does not emit ``post_save``. New
    rows are left to the periodic scheduler to arm.
    """
    if created:
        return
    old = getattr(instance, "_loaded_scheduled_time", None)
    if old is None or old == instance.scheduled_time:
        return

    retime_event(instance)
    # Keep the in-memory marker in sync for any subsequent save on this instance.
    instance._loaded_scheduled_time = instance.scheduled_time

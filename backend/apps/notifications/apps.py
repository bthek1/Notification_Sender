from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    name = "apps.notifications"
    label = "notifications"

    def ready(self) -> None:
        # Register the re-time post_save signal.
        from . import signals  # noqa: F401

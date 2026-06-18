import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings.dev")

app = Celery("core")

# Read config from Django settings, using the CELERY_ namespace prefix.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Auto-discover tasks.py in all INSTALLED_APPS.
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")  # noqa: T201

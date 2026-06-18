from django.urls import path

from .views import health_check, task_revoke, task_status, task_trigger

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("tasks/trigger/", task_trigger, name="task-trigger"),
    path("tasks/<str:task_id>/", task_status, name="task-status"),
    path("tasks/<str:task_id>/revoke/", task_revoke, name="task-revoke"),
]

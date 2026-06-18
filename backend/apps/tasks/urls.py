from django.urls import path

from .views import (
    PeriodicTaskListView,
    PeriodicTaskToggleView,
    PeriodicTaskTriggerView,
    TaskResultDetailView,
    TaskResultListView,
)

urlpatterns = [
    path("schedules/", PeriodicTaskListView.as_view(), name="schedule-list"),
    path(
        "schedules/<int:pk>/",
        PeriodicTaskToggleView.as_view(),
        name="schedule-toggle",
    ),
    path(
        "schedules/<int:pk>/trigger/",
        PeriodicTaskTriggerView.as_view(),
        name="schedule-trigger",
    ),
    path("results/", TaskResultListView.as_view(), name="result-list"),
    path(
        "results/<str:task_id>/",
        TaskResultDetailView.as_view(),
        name="result-detail",
    ),
]

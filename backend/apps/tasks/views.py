from celery import current_app
from django_celery_beat.models import PeriodicTask
from django_celery_results.models import TaskResult
from rest_framework import generics
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    PeriodicTaskSerializer,
    PeriodicTaskToggleSerializer,
    TaskResultSerializer,
)


class PeriodicTaskListView(generics.ListAPIView):
    """GET /api/tasks/schedules/ — list all periodic tasks."""

    queryset = PeriodicTask.objects.select_related("interval", "crontab").order_by(
        "name"
    )
    serializer_class = PeriodicTaskSerializer


class PeriodicTaskToggleView(generics.UpdateAPIView):
    """PATCH /api/tasks/schedules/<pk>/ — enable/disable a task."""

    queryset = PeriodicTask.objects.all()
    serializer_class = PeriodicTaskToggleSerializer
    http_method_names = ["patch"]


class PeriodicTaskTriggerView(APIView):
    """POST /api/tasks/schedules/<pk>/trigger/ — fire a task immediately."""

    def post(self, request: Request, pk: int) -> Response:
        task = generics.get_object_or_404(PeriodicTask, pk=pk)
        async_result = current_app.send_task(
            task.task,
            args=task.args or [],
            kwargs=task.kwargs or {},
        )
        return Response({"task_id": async_result.id}, status=202)


class TaskResultListView(generics.ListAPIView):
    """GET /api/tasks/results/ — recent run results (optional ?status=)."""

    serializer_class = TaskResultSerializer

    def get_queryset(self):
        qs = TaskResult.objects.order_by("-date_done")
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        return qs


class TaskResultDetailView(generics.RetrieveAPIView):
    """GET /api/tasks/results/<task_id>/ — one run's result."""

    queryset = TaskResult.objects.all()
    serializer_class = TaskResultSerializer
    lookup_field = "task_id"

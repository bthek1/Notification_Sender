from celery.result import AsyncResult
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .tasks import process_data


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok"})


@api_view(["POST"])
@permission_classes([AllowAny])
def task_trigger(request):
    """Dispatch process_data task. Returns task_id."""
    payload = request.data if isinstance(request.data, dict) else {}
    task = process_data.delay(payload)
    return Response({"task_id": task.id}, status=202)


@api_view(["GET"])
@permission_classes([AllowAny])
def task_status(request, task_id: str):
    """Return current status and result for task_id."""
    result = AsyncResult(task_id)
    data: dict = {
        "task_id": task_id,
        "status": result.status,
        "result": None,
        "traceback": None,
    }
    if result.successful():
        data["result"] = result.result
    elif result.failed():
        data["traceback"] = str(result.traceback)
    return Response(data)


@api_view(["POST"])
@permission_classes([AllowAny])
def task_revoke(request, task_id: str):
    """Revoke (and optionally terminate) a running task."""
    terminate = bool(request.data.get("terminate", False))
    result = AsyncResult(task_id)
    result.revoke(terminate=terminate)
    return Response({"task_id": task_id, "revoked": True})

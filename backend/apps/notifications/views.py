from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Event
from .serializers import EventSerializer, GenerateEventsSerializer
from .tasks import generate_events


class EventViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Read-only access to events, plus a ``generate`` action that dispatches
    the background task to create future events.
    """

    queryset = Event.objects.all()
    serializer_class = EventSerializer
    permission_classes = [AllowAny]

    @action(detail=False, methods=["post"])
    def generate(self, request):
        """Dispatch the generate_events task (default: 5 events / next 20 min)."""
        params = GenerateEventsSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        task = generate_events.delay(**params.validated_data)
        return Response({"task_id": task.id}, status=202)

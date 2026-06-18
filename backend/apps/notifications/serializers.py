from rest_framework import serializers

from .models import Event


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "message",
            "scheduled_time",
            "status",
            "fired_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "fired_at", "created_at", "updated_at"]


class GenerateEventsSerializer(serializers.Serializer):
    """Validates parameters for the generate-events endpoint."""

    count = serializers.IntegerField(min_value=1, max_value=100, default=5)
    within_minutes = serializers.IntegerField(min_value=1, max_value=1440, default=20)

from django_celery_beat.models import PeriodicTask
from django_celery_results.models import TaskResult
from rest_framework import serializers


class PeriodicTaskSerializer(serializers.ModelSerializer):
    """Read view of a periodic task plus its interval/crontab/clocked timing."""

    schedule = serializers.SerializerMethodField()

    class Meta:
        model = PeriodicTask
        fields = [
            "id",
            "name",
            "task",
            "enabled",
            "schedule",
            "one_off",
            "args",
            "kwargs",
            "last_run_at",
            "total_run_count",
            "date_changed",
        ]
        read_only_fields = fields

    def get_schedule(self, obj: PeriodicTask) -> dict | None:
        if obj.interval is not None:
            return {
                "type": "interval",
                "every": obj.interval.every,
                "period": obj.interval.period,
            }
        if obj.crontab is not None:
            c = obj.crontab
            return {
                "type": "crontab",
                "minute": c.minute,
                "hour": c.hour,
                "day_of_week": c.day_of_week,
                "day_of_month": c.day_of_month,
                "month_of_year": c.month_of_year,
            }
        if obj.clocked is not None:
            return {
                "type": "clocked",
                "clocked_time": obj.clocked.clocked_time.isoformat(),
            }
        return None


class PeriodicTaskToggleSerializer(serializers.ModelSerializer):
    """Writable serializer used only to enable/disable a task."""

    class Meta:
        model = PeriodicTask
        fields = ["enabled"]


class TaskResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskResult
        fields = [
            "task_id",
            "task_name",
            "status",
            "result",
            "date_created",
            "date_done",
            "traceback",
        ]
        read_only_fields = fields

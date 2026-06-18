from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("title", "scheduled_time", "status", "fired_at", "created_at")
    list_filter = ("status",)
    search_fields = ("title", "message")
    ordering = ("scheduled_time",)
    readonly_fields = ("id", "created_at", "updated_at", "fired_at")

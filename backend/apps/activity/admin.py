from django.contrib import admin
from .models import ActivityLog


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "company", "user", "action", "status", "object_type", "object_id", "error_code")
    list_filter = ("status", "action", "company")
    search_fields = ("error_code", "error_detail", "object_id", "user__username", "company__name")
    readonly_fields = ("created_at", "company", "user", "action", "status", "object_type", "object_id", "error_code", "error_detail")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

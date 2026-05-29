from django.contrib import admin

from .models import VanRoute


@admin.register(VanRoute)
class VanRouteAdmin(admin.ModelAdmin):
    list_display = ["id", "date", "driver_name", "van_name", "van_warehouse", "status", "created_at"]
    list_filter = ["status", "date"]
    search_fields = ["driver_name", "van_name"]
    readonly_fields = ["id", "created_at", "updated_at", "mm_document"]
    filter_horizontal = ["orders"]

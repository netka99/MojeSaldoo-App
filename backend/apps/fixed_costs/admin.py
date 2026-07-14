from django.contrib import admin

from .models import FixedCost


@admin.register(FixedCost)
class FixedCostAdmin(admin.ModelAdmin):
    list_display = ["company", "category", "description", "amount_monthly", "active_from", "is_active"]
    list_filter = ["category", "is_active", "company"]
    search_fields = ["description", "company__name"]

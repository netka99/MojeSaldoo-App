from django.contrib import admin

from .models import CompanyOpexCategory, CompanyTaxConfig, DailyB2CRevenue, QuickExpense


@admin.register(CompanyTaxConfig)
class CompanyTaxConfigAdmin(admin.ModelAdmin):
    list_display = ["company", "tax_form", "tax_rate", "vat_payer", "vat_method", "updated_at"]
    list_filter = ["tax_form", "vat_payer", "vat_method"]
    search_fields = ["company__name"]
    readonly_fields = ["created_at", "updated_at", "balance_updated_at"]


@admin.register(QuickExpense)
class QuickExpenseAdmin(admin.ModelAdmin):
    list_display = ["company", "date", "amount", "category", "cost_type", "has_vat", "vendor"]
    list_filter = ["category", "cost_type", "has_vat", "company"]
    search_fields = ["vendor", "document_number", "notes"]
    readonly_fields = ["uuid", "created_at", "updated_at"]
    date_hierarchy = "date"


@admin.register(DailyB2CRevenue)
class DailyB2CRevenueAdmin(admin.ModelAdmin):
    list_display = ["company", "date", "amount", "vat_included", "vat_rate", "notes"]
    list_filter = ["vat_included", "company"]
    readonly_fields = ["uuid", "created_at", "updated_at"]
    date_hierarchy = "date"


@admin.register(CompanyOpexCategory)
class CompanyOpexCategoryAdmin(admin.ModelAdmin):
    list_display = ["company", "name", "slug", "is_active", "sort_order"]
    list_filter = ["is_active", "company"]
    search_fields = ["name", "slug", "company__name"]
    readonly_fields = ["uuid", "created_at"]

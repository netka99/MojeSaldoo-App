from django.contrib import admin

from .models import DeliveryDocument, DeliveryItem


class DeliveryItemInline(admin.TabularInline):
    model = DeliveryItem
    extra = 0
    raw_id_fields = ("order_item", "product")
    readonly_fields = ("created_at",)


@admin.register(DeliveryDocument)
class DeliveryDocumentAdmin(admin.ModelAdmin):
    list_display = (
        "document_number",
        "document_type",
        "status",
        "issue_date",
        "company",
        "order",
        "created_at",
    )
    list_filter = ("document_type", "status", "issue_date")
    search_fields = ("document_number", "order__order_number", "notes")
    raw_id_fields = ("company", "order", "user", "from_warehouse", "to_warehouse", "to_customer")
    readonly_fields = ("document_number", "created_at", "updated_at")
    inlines = (DeliveryItemInline,)


@admin.register(DeliveryItem)
class DeliveryItemAdmin(admin.ModelAdmin):
    list_display = (
        "delivery_document",
        "product",
        "quantity_planned",
        "quantity_actual",
        "quantity_returned",
        "created_at",
    )
    list_filter = ("is_damaged",)
    raw_id_fields = ("delivery_document", "order_item", "product")
    readonly_fields = ("created_at",)

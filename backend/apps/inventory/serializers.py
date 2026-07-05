from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer

from .models import InventoryCount, InventoryCountItem


class InventoryCountItemSerializer(UUIDModelSerializer):
    difference = serializers.SerializerMethodField()

    class Meta:
        model = InventoryCountItem
        fields = [
            "id",
            "inventory_count",
            "product",
            "product_name",
            "product_unit",
            "quantity_system",
            "quantity_actual",
            "notes",
            "created_at",
            "difference",
        ]
        read_only_fields = ["inventory_count", "product_name", "product_unit", "quantity_system", "created_at"]

    def get_difference(self, obj):
        diff = obj.difference
        if diff is None:
            return None
        return float(diff)


class InventoryCountSerializer(UUIDModelSerializer):
    items = InventoryCountItemSerializer(many=True, read_only=True)
    warehouse_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryCount
        fields = [
            "id",
            "company",
            "warehouse",
            "warehouse_name",
            "document_number",
            "status",
            "count_date",
            "notes",
            "created_by",
            "completed_at",
            "created_at",
            "updated_at",
            "items",
        ]
        read_only_fields = ["company", "document_number", "status", "created_by", "completed_at", "created_at", "updated_at"]

    def get_warehouse_name(self, obj):
        if obj.warehouse_id:
            return obj.warehouse.name
        return None


class InventoryCountCreateSerializer(UUIDModelSerializer):
    class Meta:
        model = InventoryCount
        fields = [
            "warehouse",
            "count_date",
            "notes",
        ]

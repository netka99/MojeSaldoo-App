"""Serializers for VanRoute API."""

from decimal import Decimal

from rest_framework import serializers

from apps.delivery.models import DeliveryDocument
from apps.orders.models import Order
from apps.products.models import Warehouse

from .models import VanRoute


# ── Nested read-only representations ──────────────────────────────────────────

class RouteOrderSerializer(serializers.ModelSerializer):
    """Minimal order info for route stops list."""
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "order_number",
            "customer_id",
            "customer_name",
            "delivery_date",
            "status",
            "item_count",
        ]

    def get_item_count(self, obj):
        return obj.items.count()


class RouteMmDocSerializer(serializers.ModelSerializer):
    """Minimal MM doc info — just enough for the dashboard header."""

    class Meta:
        model = DeliveryDocument
        fields = ["id", "document_number", "issue_date", "status"]


# ── Main serializers ───────────────────────────────────────────────────────────

class VanRouteListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for the routes list (no nested orders)."""

    van_warehouse_code = serializers.CharField(source="van_warehouse.code", read_only=True)
    main_warehouse_code = serializers.CharField(source="main_warehouse.code", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    order_count = serializers.SerializerMethodField()
    mm_document_number = serializers.CharField(
        source="mm_document.document_number", read_only=True, default=None
    )

    class Meta:
        model = VanRoute
        fields = [
            "id",
            "route_number",
            "date",
            "driver_name",
            "van_name",
            "van_warehouse_id",
            "van_warehouse_code",
            "main_warehouse_id",
            "main_warehouse_code",
            "status",
            "status_display",
            "order_count",
            "mm_document_id",
            "mm_document_number",
            "reconciliation_summary",
            "carry_over_items",
            "created_at",
            "updated_at",
        ]

    def get_order_count(self, obj):
        # Uses prefetch when available
        if hasattr(obj, "_prefetched_objects_cache") and "orders" in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache["orders"])
        return obj.orders.count()


class VanRouteDetailSerializer(serializers.ModelSerializer):
    """Full detail with nested orders and MM doc."""

    van_warehouse_id = serializers.UUIDField(source="van_warehouse.id", read_only=True)
    van_warehouse_code = serializers.CharField(source="van_warehouse.code", read_only=True)
    main_warehouse_id = serializers.UUIDField(source="main_warehouse.id", read_only=True)
    main_warehouse_code = serializers.CharField(source="main_warehouse.code", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    orders = RouteOrderSerializer(many=True, read_only=True)
    mm_document = RouteMmDocSerializer(read_only=True)

    class Meta:
        model = VanRoute
        fields = [
            "id",
            "route_number",
            "date",
            "driver_name",
            "van_name",
            "van_warehouse_id",
            "van_warehouse_code",
            "main_warehouse_id",
            "main_warehouse_code",
            "status",
            "status_display",
            "orders",
            "mm_document",
            "reconciliation_summary",
            "carry_over_items",
            "created_at",
            "updated_at",
        ]


class VanRouteCreateSerializer(serializers.Serializer):
    """Write serializer for POST /api/van-routes/."""

    date = serializers.DateField()
    driver_name = serializers.CharField(max_length=255, allow_blank=True, default="")
    van_name = serializers.CharField(max_length=255, allow_blank=True, default="")
    van_warehouse_id = serializers.UUIDField()
    main_warehouse_id = serializers.UUIDField()
    order_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=True,
        default=list,
    )


class VanRoutePatchSerializer(serializers.ModelSerializer):
    """Partial update — only while route is still planned."""

    class Meta:
        model = VanRoute
        fields = ["date", "driver_name", "van_name"]

    def validate(self, data):
        if self.instance and not self.instance.is_editable:
            raise serializers.ValidationError(
                "Route can only be edited while in 'planned' status."
            )
        return data


# ── Loading action ─────────────────────────────────────────────────────────────

class VanRouteLoadItemSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    quantity = serializers.DecimalField(
        max_digits=10, decimal_places=3, min_value=Decimal("0.001")
    )


class VanRouteStartLoadingSerializer(serializers.Serializer):
    """Body for POST /api/van-routes/:id/start-loading/."""

    items = VanRouteLoadItemSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one item is required.")
        ids = [str(i["product_id"]) for i in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Duplicate product_id in items.")
        return value

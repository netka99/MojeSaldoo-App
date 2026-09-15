from decimal import Decimal

from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer, UUIDRelatedField
from apps.products.models import Product
from apps.suppliers.models import Supplier

from .models import SupplierOrder, SupplierOrderItem


class SupplierOrderItemSerializer(UUIDModelSerializer):
    product_id = serializers.UUIDField(source="product.uuid", read_only=True)

    class Meta:
        model = SupplierOrderItem
        fields = [
            "id",
            "product_id",
            "product_name",
            "product_unit",
            "quantity_ordered",
            "quantity_received",
            "unit_price_net",
            "vat_rate",
            "notes",
            "created_at",
        ]
        read_only_fields = ["id", "product_name", "product_unit", "quantity_received", "created_at"]


class SupplierOrderItemWriteSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = SupplierOrderItem
        fields = [
            "product_id",
            "quantity_ordered",
            "unit_price_net",
            "vat_rate",
            "notes",
        ]

    def validate_product_id(self, value):
        try:
            return Product.objects.get(uuid=value)
        except Product.DoesNotExist:
            raise serializers.ValidationError("Produkt nie istnieje.")


class CreatePzItemOverrideSerializer(serializers.Serializer):
    """Item override when calling create-pz action — quantities/costs/batch data."""

    product_id = serializers.UUIDField()
    quantity_ordered = serializers.DecimalField(max_digits=10, decimal_places=2)
    unit_cost = serializers.DecimalField(
        max_digits=10, decimal_places=4, required=False, allow_null=True
    )
    batch_number = serializers.CharField(required=False, allow_blank=True, default="")
    expiry_date = serializers.DateField(required=False, allow_null=True)

    def validate_product_id(self, value):
        try:
            return Product.objects.get(uuid=value)
        except Product.DoesNotExist:
            raise serializers.ValidationError("Produkt nie istnieje.")


class SupplierOrderSerializer(UUIDModelSerializer):
    items = SupplierOrderItemSerializer(many=True, read_only=True)
    supplier_id = serializers.UUIDField(
        source="supplier.uuid", read_only=True, allow_null=True
    )
    source_order_id = serializers.UUIDField(
        source="source_order.uuid", read_only=True, allow_null=True
    )
    pz_count = serializers.SerializerMethodField()

    class Meta:
        model = SupplierOrder
        fields = [
            "id",
            "document_number",
            "status",
            "supplier_id",
            "supplier_name",
            "issue_date",
            "expected_delivery_date",
            "source_order_id",
            "notes",
            "items",
            "pz_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "document_number", "supplier_name",
            "pz_count", "created_at", "updated_at",
        ]

    def get_pz_count(self, obj) -> int:
        return obj.pz_documents.count()


class SupplierOrderWriteSerializer(serializers.Serializer):
    """Used for create and update of SupplierOrder + nested items."""

    supplier_id = serializers.UUIDField(required=False, allow_null=True)
    issue_date = serializers.DateField(required=False)
    expected_delivery_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    items = SupplierOrderItemWriteSerializer(many=True, required=True)

    def validate_supplier_id(self, value):
        if value is None:
            return None
        company = self.context["company"]
        try:
            return Supplier.objects.get(uuid=value, company=company)
        except Supplier.DoesNotExist:
            raise serializers.ValidationError("Dostawca nie istnieje.")

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Zamówienie musi mieć co najmniej jedną pozycję.")
        return value

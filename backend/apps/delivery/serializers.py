from decimal import Decimal

from rest_framework import serializers

from apps.customers.models import Customer
from apps.orders.models import Order
from apps.products.models import Warehouse

from .models import DeliveryDocument, DeliveryItem


class VanLoadingItemSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    # Match frontend (toFixed(3)) and WZ line precision; service layer uses Decimals
    quantity = serializers.DecimalField(
        max_digits=10, decimal_places=3, min_value=Decimal("0.01")
    )


class VanLoadingSerializer(serializers.Serializer):
    from_warehouse_id = serializers.UUIDField()
    to_warehouse_id = serializers.UUIDField()
    issue_date = serializers.DateField(required=False)
    driver_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    notes = serializers.CharField(required=False, allow_blank=True)
    items = VanLoadingItemSerializer(many=True)

    def validate(self, data):
        if not data.get("items"):
            raise serializers.ValidationError(
                {"items": "At least one line is required."}
            )
        return data


class VanReconciliationItemSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    quantity_actual_remaining = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0"),
    )


class VanReconciliationSerializer(serializers.Serializer):
    items = VanReconciliationItemSerializer(many=True, allow_empty=True)


class DeliveryItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = DeliveryItem
        fields = [
            "id",
            "order_item_id",
            "product_id",
            "product_name",
            "quantity_planned",
            "quantity_actual",
            "quantity_returned",
            "return_reason",
            "is_damaged",
            "notes",
            "created_at",
        ]
        read_only_fields = fields


class DeliveryItemCompleteRowSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    quantity_actual = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    quantity_returned = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        default=Decimal("0"),
    )
    return_reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=255,
    )
    is_damaged = serializers.BooleanField(required=False, default=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class DeliveryCompleteSerializer(serializers.Serializer):
    items = DeliveryItemCompleteRowSerializer(
        many=True,
        required=False,
        allow_empty=True,
    )
    receiver_name = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=255,
    )
    has_returns = serializers.BooleanField(required=False)
    returns_notes = serializers.CharField(required=False, allow_blank=True)


class DeliveryLineMutationSerializer(serializers.Serializer):
    """Subset of editable fields per line for ``POST .../update-lines/``."""

    id = serializers.UUIDField()
    quantity_planned = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
    )
    quantity_actual = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    quantity_returned = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
    )
    return_reason = serializers.CharField(required=False, allow_blank=True, max_length=255)
    is_damaged = serializers.BooleanField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class DeliveryUpdateLinesSerializer(serializers.Serializer):
    items = DeliveryLineMutationSerializer(many=True, allow_empty=False)


class DeliveryDocumentSerializer(serializers.ModelSerializer):
    order_id = serializers.PrimaryKeyRelatedField(
        queryset=Order.objects.all(),
        source="order",
        required=False,
        allow_null=True,
    )
    from_warehouse_id = serializers.PrimaryKeyRelatedField(
        queryset=Warehouse.objects.all(),
        source="from_warehouse",
        required=False,
        allow_null=True,
    )
    to_warehouse_id = serializers.PrimaryKeyRelatedField(
        queryset=Warehouse.objects.all(),
        source="to_warehouse",
        required=False,
        allow_null=True,
    )
    to_customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(),
        source="to_customer",
        required=False,
        allow_null=True,
    )
    items = DeliveryItemSerializer(many=True, read_only=True)
    order_number = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    locked_for_edit = serializers.SerializerMethodField()
    linked_invoices = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryDocument
        fields = [
            "id",
            "company",
            "order_id",
            "order_number",
            "customer_name",
            "user",
            "document_type",
            "document_number",
            "issue_date",
            "from_warehouse_id",
            "to_warehouse_id",
            "to_customer_id",
            "status",
            "has_returns",
            "returns_notes",
            "driver_name",
            "receiver_name",
            "delivered_at",
            "notes",
            "created_at",
            "updated_at",
            "locked_for_edit",
            "linked_invoices",
            "items",
        ]
        read_only_fields = [
            "id",
            "document_number",
            "company",
            "user",
            "status",
            "created_at",
            "updated_at",
            "items",
            "order_number",
            "customer_name",
            "locked_for_edit",
            "linked_invoices",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        cc_id = (
            getattr(request.user, "current_company_id", None)
            if request and request.user.is_authenticated
            else None
        )
        if cc_id:
            self.fields["order_id"].queryset = Order.objects.filter(company_id=cc_id)
            self.fields["from_warehouse_id"].queryset = Warehouse.objects.filter(
                company_id=cc_id
            )
            self.fields["to_warehouse_id"].queryset = Warehouse.objects.filter(
                company_id=cc_id
            )
            self.fields["to_customer_id"].queryset = Customer.objects.filter(
                company_id=cc_id
            )

    def get_order_number(self, obj):
        if obj.order_id:
            return obj.order.order_number
        return None

    def get_customer_name(self, obj):
        if obj.order_id and obj.order.customer_id:
            return obj.order.customer.name
        return None

    def get_locked_for_edit(self, obj):
        return obj.is_locked_by_invoice()

    def get_linked_invoices(self, obj):
        return [
            {"id": str(inv.id), "invoice_number": inv.invoice_number or ""}
            for inv in obj.invoices.all().order_by("created_at")
        ]

    def validate(self, data):
        doc_type = data.get("document_type")
        order = data.get("order")
        if not self.instance and doc_type != DeliveryDocument.DOC_TYPE_MM and not order:
            raise serializers.ValidationError(
                {"order_id": "This field is required for this document type."}
            )
        return data

    def validate_order(self, order: Order):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return order
        cc_id = getattr(request.user, "current_company_id", None)
        if cc_id and order.company_id != cc_id:
            raise serializers.ValidationError("Order does not belong to your company.")
        return order

    def _ensure_fk_company(self, value, label: str):
        if value is None:
            return value
        request = self.context.get("request")
        cc_id = (
            getattr(request.user, "current_company_id", None)
            if request and request.user.is_authenticated
            else None
        )
        if cc_id and value.company_id != cc_id:
            raise serializers.ValidationError(f"{label} does not belong to your company.")
        return value

    def validate_from_warehouse(self, wh):
        return self._ensure_fk_company(wh, "From warehouse")

    def validate_to_warehouse(self, wh):
        return self._ensure_fk_company(wh, "To warehouse")

    def validate_to_customer(self, customer):
        return self._ensure_fk_company(customer, "Customer")

    def update(self, instance, validated_data):
        if instance.is_locked_by_invoice():
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Delivery document is linked to an invoice and cannot be changed."
                    )
                }
            )
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            instance.user = request.user
        return super().update(instance, validated_data)

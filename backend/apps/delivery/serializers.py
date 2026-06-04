from decimal import Decimal

from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.customers.models import Customer
from apps.orders.models import Order
from apps.products.models import Warehouse
from apps.suppliers.models import Supplier
from apps.van_routes.models import VanRoute
from apps.van_routes.services import validate_wz_van_route_link

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
        decimal_places=3,
        min_value=Decimal("0"),
    )
    # Optional explicit write-off quantity (pre-load carry-over handling).
    # When provided (even as 0), activates "explicit split" mode:
    #   P (quantity_actual_remaining) → MM-P return to MG
    #   W (quantity_writeoff)         → DAMAGE write-off
    #   T - P - W                     → stays in van
    # When absent (None), falls back to legacy delta-based discrepancy logic
    # (used by end-of-route VanReconciliationPage).
    quantity_writeoff = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        min_value=Decimal("0"),
        required=False,
        allow_null=True,
        default=None,
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
            "unit_cost",
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


class LinkedZWItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = DeliveryItem
        fields = ["id", "product_id", "product_name", "quantity_planned", "return_reason"]
        read_only_fields = fields


class LinkedZWSerializer(serializers.ModelSerializer):
    """Minimal nested representation of ZW documents attached to a WZ."""
    items = LinkedZWItemSerializer(many=True, read_only=True)

    class Meta:
        model = DeliveryDocument
        fields = ["id", "document_number", "issue_date", "status", "items"]
        read_only_fields = fields


class PendingReturnItemSerializer(serializers.Serializer):
    """One line in the ``return_items`` payload sent to ``POST .../save/``."""

    product_id = serializers.UUIDField()
    quantity = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )
    return_reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=255,
        default="",
    )


class SaveWithReturnsSerializer(serializers.Serializer):
    """Optional body for ``POST .../save/`` when the driver is also collecting returns."""

    return_items = PendingReturnItemSerializer(many=True, required=False, allow_empty=True)


class DeliveryDocumentListSerializer(serializers.ModelSerializer):
    """Slim serializer for list endpoints — no items, return_documents, or invoice data.

    Used when ``?include_items`` is not set, so the list endpoint stays fast even
    for large page sizes (e.g. the "Wg sklepu" date-range fetch).
    """

    order_id = serializers.PrimaryKeyRelatedField(source="order", read_only=True)
    to_customer_id = serializers.PrimaryKeyRelatedField(source="to_customer", read_only=True)
    from_warehouse_id = serializers.PrimaryKeyRelatedField(source="from_warehouse", read_only=True)
    to_warehouse_id = serializers.PrimaryKeyRelatedField(source="to_warehouse", read_only=True)
    linked_wz_id = serializers.PrimaryKeyRelatedField(source="linked_wz", read_only=True)
    van_route_id = serializers.PrimaryKeyRelatedField(source="van_route", read_only=True)
    from_supplier_id = serializers.PrimaryKeyRelatedField(source="from_supplier", read_only=True)
    order_number = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    supplier_name = serializers.SerializerMethodField()
    from_warehouse_name = serializers.SerializerMethodField()
    to_warehouse_name = serializers.SerializerMethodField()
    van_route_date = serializers.SerializerMethodField()

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
            "from_warehouse_name",
            "to_warehouse_id",
            "to_warehouse_name",
            "to_customer_id",
            "from_supplier_id",
            "supplier_name",
            "linked_wz_id",
            "van_route_id",
            "van_route_date",
            "status",
            "has_returns",
            "returns_notes",
            "driver_name",
            "receiver_name",
            "delivered_at",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_supplier_name(self, obj):
        if obj.from_supplier_id:
            return obj.from_supplier.name
        return None

    def get_order_number(self, obj):
        if obj.order_id:
            return obj.order.order_number
        return None

    def get_customer_name(self, obj):
        if obj.order_id and obj.order.customer_id:
            return obj.order.customer.name
        if obj.to_customer_id:
            return obj.to_customer.name
        return None

    def get_from_warehouse_name(self, obj):
        if obj.from_warehouse_id:
            return obj.from_warehouse.name
        return None

    def get_to_warehouse_name(self, obj):
        if obj.to_warehouse_id:
            return obj.to_warehouse.name
        return None

    def get_van_route_date(self, obj):
        if obj.van_route_id:
            return obj.van_route.date.isoformat()
        return None


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
    from_supplier_id = serializers.PrimaryKeyRelatedField(
        queryset=Supplier.objects.all(),
        source="from_supplier",
        required=False,
        allow_null=True,
    )
    items = DeliveryItemSerializer(many=True, read_only=True)
    return_documents = LinkedZWSerializer(many=True, read_only=True)
    order_number = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    supplier_name = serializers.SerializerMethodField()
    from_warehouse_name = serializers.SerializerMethodField()
    to_warehouse_name = serializers.SerializerMethodField()
    locked_for_edit = serializers.SerializerMethodField()
    linked_invoices = serializers.SerializerMethodField()
    linked_wz_id = serializers.PrimaryKeyRelatedField(
        source="linked_wz",
        read_only=True,
    )
    van_route_id = serializers.PrimaryKeyRelatedField(
        queryset=VanRoute.objects.all(),
        source="van_route",
        required=False,
        allow_null=True,
    )
    linked_wz_number = serializers.SerializerMethodField()
    van_route_date = serializers.SerializerMethodField()

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
            "from_warehouse_name",
            "to_warehouse_id",
            "to_warehouse_name",
            "to_customer_id",
            "from_supplier_id",
            "supplier_name",
            "linked_wz_id",
            "linked_wz_number",
            "van_route_id",
            "van_route_date",
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
            "return_documents",
        ]
        read_only_fields = [
            "id",
            "document_number",
            "company",
            "user",
            "status",
            "linked_wz_id",
            "created_at",
            "updated_at",
            "items",
            "return_documents",
            "order_number",
            "customer_name",
            "supplier_name",
            "from_warehouse_name",
            "to_warehouse_name",
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
            self.fields["from_supplier_id"].queryset = Supplier.objects.filter(
                company_id=cc_id
            )
            self.fields["van_route_id"].queryset = VanRoute.objects.filter(
                company_id=cc_id
            )

    def get_supplier_name(self, obj):
        if obj.from_supplier_id:
            return obj.from_supplier.name
        return None

    def get_linked_wz_number(self, obj):
        if obj.linked_wz_id:
            return obj.linked_wz.document_number or None
        return None

    def get_van_route_date(self, obj):
        if obj.van_route_id:
            return obj.van_route.date.isoformat()
        return None

    def get_order_number(self, obj):
        if obj.order_id:
            return obj.order.order_number
        return None

    def get_customer_name(self, obj):
        if obj.order_id and obj.order.customer_id:
            return obj.order.customer.name
        if obj.to_customer_id:
            return obj.to_customer.name
        return None

    def get_from_warehouse_name(self, obj):
        if obj.from_warehouse_id:
            return obj.from_warehouse.name
        return None

    def get_to_warehouse_name(self, obj):
        if obj.to_warehouse_id:
            return obj.to_warehouse.name
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
        if self.instance and doc_type is None:
            doc_type = self.instance.document_type
        order = data.get("order")
        if order is None and self.instance:
            order = self.instance.order
        # MM, ZW, and PZ documents are not tied to a sales order
        order_not_required = doc_type in (
            DeliveryDocument.DOC_TYPE_MM,
            DeliveryDocument.DOC_TYPE_ZW,
            DeliveryDocument.DOC_TYPE_PZ,
        )
        if not self.instance and not order_not_required and not order:
            raise serializers.ValidationError(
                {"order_id": "This field is required for this document type."}
            )

        van_route = data.get("van_route")
        if van_route is None and self.instance and "van_route" not in data:
            van_route = self.instance.van_route
        if van_route and doc_type == DeliveryDocument.DOC_TYPE_WZ:
            issue_date = data.get("issue_date")
            if issue_date is None and self.instance:
                issue_date = self.instance.issue_date
            from_warehouse = data.get("from_warehouse")
            if from_warehouse is None and self.instance:
                from_warehouse = self.instance.from_warehouse
            try:
                validate_wz_van_route_link(
                    van_route,
                    order=order,
                    issue_date=issue_date,
                    from_warehouse=from_warehouse,
                )
            except ValidationError as exc:
                raise serializers.ValidationError(exc.detail) from exc
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

    def validate_van_route(self, route):
        return self._ensure_fk_company(route, "Van route")

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

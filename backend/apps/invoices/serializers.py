from decimal import Decimal

from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer, UUIDRelatedField
from apps.common.vat import net_from_gross

from apps.customers.models import Customer
from apps.delivery.models import DeliveryDocument
from apps.orders.models import Order
from apps.orders.serializers import OrderSerializer

from .models import Invoice, InvoiceItem


class InvoiceItemSerializer(UUIDModelSerializer):
    class Meta:
        model = InvoiceItem
        fields = [
            "id",
            "order_item",
            "product",
            "product_name",
            "product_unit",
            "pkwiu",
            "quantity",
            "is_removed",
            "unit_price_net",
            "vat_rate",
            "line_net",
            "line_vat",
            "line_gross",
            "created_at",
        ]
        read_only_fields = fields


class InvoiceItemWriteSerializer(serializers.Serializer):
    """Write-only shape for manual invoice line items.

    Accepts either ``unit_price_net`` (B2B) or ``unit_price_gross`` (retail/brutto mode).
    When ``unit_price_gross`` is provided, ``unit_price_net`` is derived from it using
    ``net_from_gross(gross, vat_rate)`` — Decimal ROUND_HALF_UP, 2 decimal places.
    """
    product = serializers.UUIDField(required=False, allow_null=True)
    product_name = serializers.CharField(max_length=255, required=False, default="")
    product_unit = serializers.CharField(max_length=20, required=False, default="")
    quantity = serializers.DecimalField(max_digits=10, decimal_places=2)
    unit_price_net = serializers.DecimalField(max_digits=12, decimal_places=4, required=False, allow_null=True)
    unit_price_gross = serializers.DecimalField(max_digits=12, decimal_places=4, required=False, allow_null=True)
    vat_rate = serializers.DecimalField(max_digits=5, decimal_places=2)

    def validate(self, data):
        net = data.get("unit_price_net")
        gross = data.get("unit_price_gross")
        if net is None and gross is None:
            raise serializers.ValidationError(
                "Podaj unit_price_net lub unit_price_gross."
            )
        if net is None:
            data["unit_price_net"] = net_from_gross(gross, data["vat_rate"])
        data.pop("unit_price_gross", None)
        return data


class InvoiceSerializer(UUIDModelSerializer):
    order = OrderSerializer(read_only=True)
    items = InvoiceItemSerializer(many=True, read_only=True)
    order_id = UUIDRelatedField(
        queryset=Order.objects.all(),
        source="order",
        write_only=True,
        required=False,
        allow_null=True,
    )
    customer_id = UUIDRelatedField(
        queryset=Customer.objects.all(),
        source="customer",
        write_only=True,
        required=False,
        allow_null=True,
    )
    delivery_document_id = UUIDRelatedField(
        queryset=DeliveryDocument.objects.all(),
        source="delivery_document",
        write_only=True,
        required=False,
        allow_null=True,
    )
    # Write-only items for manual invoices
    manual_items = InvoiceItemWriteSerializer(many=True, write_only=True, required=False)
    # Read-only list of order UUIDs linked via M2M
    order_ids = serializers.SerializerMethodField(read_only=True)
    # Resolved customer name — from direct FK or via order
    customer_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Invoice
        fields = "__all__"
        read_only_fields = ["invoice_number", "company", "user", "customer", "status", "paid_at", "created_at", "updated_at"]

    def get_customer_name(self, instance):
        if instance.customer_id:
            return instance.customer.name
        if instance.order_id and instance.order.customer_id:
            return instance.order.customer.name
        return ""

    def get_order_ids(self, instance):
        return [
            str(io.order.uuid)
            for io in instance.invoice_orders.select_related("order").all()
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
            self.fields["customer_id"].queryset = Customer.objects.filter(
                company_id=cc_id
            )
            self.fields["delivery_document_id"].queryset = (
                DeliveryDocument.objects.filter(company_id=cc_id)
            )

    def update(self, instance, validated_data):
        if instance.status != Invoice.STATUS_DRAFT:
            raise serializers.ValidationError(
                {"detail": "Only draft invoices can be edited."}
            )
        validated_data.pop("manual_items", None)
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Expose correction FK as UUID string
        data["corrects_invoice_id"] = (
            str(instance.corrects_invoice_id) if instance.corrects_invoice_id else None
        )
        data["corrects_invoice_number"] = (
            instance.corrects_invoice.invoice_number
            if instance.corrects_invoice_id
            else None
        )
        # List of corrections issued against this invoice (prefetched by view)
        data["corrections"] = [
            {"id": str(c.id), "invoice_number": c.invoice_number}
            for c in instance.corrections.all()
        ]
        # ZAL invoices linked to this ROZ invoice
        from apps.invoices.models import InvoiceAdvance
        links = InvoiceAdvance.objects.filter(
            roz_invoice=instance
        ).select_related("zal_invoice")
        data["advance_invoices_data"] = [
            {
                "id": str(link.zal_invoice.uuid),
                "invoice_number": link.zal_invoice.invoice_number,
                "issue_date": link.zal_invoice.issue_date.isoformat(),
                "total_gross": str(link.zal_invoice.total_gross),
                "deduction_amount": str(
                    link.deduction_amount
                    if link.deduction_amount is not None
                    else link.zal_invoice.total_gross
                ),
            }
            for link in links
        ]
        return data

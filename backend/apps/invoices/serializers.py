from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer, UUIDRelatedField

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


class InvoiceSerializer(UUIDModelSerializer):
    order = OrderSerializer(read_only=True)
    items = InvoiceItemSerializer(many=True, read_only=True)
    order_id = UUIDRelatedField(
        queryset=Order.objects.all(),
        source="order",
        write_only=True,
        required=True,
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

    class Meta:
        model = Invoice
        fields = "__all__"
        read_only_fields = ["invoice_number", "company", "user", "customer", "status", "paid_at", "created_at", "updated_at"]

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
        return data

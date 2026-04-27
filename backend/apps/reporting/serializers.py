from rest_framework import serializers

from apps.invoices.models import Invoice


class ReportingInvoiceSerializer(serializers.ModelSerializer):
    """Slim invoice row for reporting lists (includes KSeF status)."""

    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "issue_date",
            "sale_date",
            "due_date",
            "status",
            "ksef_status",
            "ksef_sent_at",
            "total_gross",
            "customer_name",
            "order_id",
        ]
        read_only_fields = fields


class ReportingRejectedInvoiceSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "issue_date",
            "ksef_status",
            "ksef_error_message",
            "total_gross",
            "customer_name",
        ]
        read_only_fields = fields

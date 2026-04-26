import django_filters

from .models import DeliveryDocument


class DeliveryDocumentFilter(django_filters.FilterSet):
    """List filters: order, status, document type, issue_date range."""

    issue_date_after = django_filters.DateFilter(
        field_name="issue_date",
        lookup_expr="gte",
    )
    issue_date_before = django_filters.DateFilter(
        field_name="issue_date",
        lookup_expr="lte",
    )

    class Meta:
        model = DeliveryDocument
        fields = ["order", "status", "document_type"]

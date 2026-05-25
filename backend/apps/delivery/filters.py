import django_filters
from django.db.models import Q

from .models import DeliveryDocument


class OrderIdsFilter(django_filters.CharFilter):
    """Match delivery documents belonging to the given comma-separated order IDs.

    Includes both direct matches (WZ/MM/PZ where order__in=ids) and ZW documents
    linked through their parent WZ (linked_wz__order__in=ids).
    """

    def filter(self, qs, value):
        if not value:
            return qs
        ids = [v.strip() for v in value.split(",") if v.strip()]
        if not ids:
            return qs
        return qs.filter(
            Q(order__in=ids) | Q(linked_wz__order__in=ids)
        ).distinct()


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
    order_ids = OrderIdsFilter()

    class Meta:
        model = DeliveryDocument
        fields = ["order", "status", "document_type", "to_customer"]

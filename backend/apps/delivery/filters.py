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
            Q(order__uuid__in=ids) | Q(linked_wz__order__uuid__in=ids)
        ).distinct()


class KsefUnlinkedFilter(django_filters.BooleanFilter):
    """
    ?ksef_unlinked=true → PZ documents with no linked KSeF invoice (M:M).

    Uses LEFT JOIN through ksef_links — .distinct() prevents duplicate rows
    when a PZ has multiple links.
    """

    def filter(self, qs, value):
        if value is True:
            return qs.filter(ksef_links__isnull=True).distinct()
        if value is False:
            return qs.filter(ksef_links__isnull=False).distinct()
        return qs


class HasPurchaseDocumentFilter(django_filters.BooleanFilter):
    """
    ?has_purchase_document=false → PZ documents with no linked FZ/KSeF invoice.
    ?has_purchase_document=true  → PZ documents that have at least one linked invoice.

    Uses the M:M reverse relation purchase_documents (PurchaseDocumentPzLink).
    """

    def filter(self, qs, value):
        if value is True:
            return qs.filter(purchase_doc_links__isnull=False).distinct()
        if value is False:
            return qs.filter(purchase_doc_links__isnull=True).distinct()
        return qs


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
    order = django_filters.UUIDFilter(field_name="order__uuid")
    to_customer = django_filters.UUIDFilter(field_name="to_customer__uuid")
    van_route = django_filters.UUIDFilter(field_name="van_route__uuid")
    from_supplier = django_filters.UUIDFilter(field_name="from_supplier__uuid")
    order_ids = OrderIdsFilter()
    ksef_unlinked = KsefUnlinkedFilter()
    has_purchase_document = HasPurchaseDocumentFilter()

    class Meta:
        model = DeliveryDocument
        fields = ["status", "document_type"]

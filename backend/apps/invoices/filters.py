import django_filters

from .models import Invoice


class InvoiceFilter(django_filters.FilterSet):
    """List filters: status, status__in, KSeF status, customer, issue_date range, correction flag."""

    issue_date_after = django_filters.DateFilter(
        field_name="issue_date",
        lookup_expr="gte",
    )
    issue_date_before = django_filters.DateFilter(
        field_name="issue_date",
        lookup_expr="lte",
    )
    is_correction = django_filters.BooleanFilter(field_name="is_correction")

    customer = django_filters.UUIDFilter(field_name="customer__uuid")

    # Allows filtering by multiple statuses: ?status__in=issued,sent
    status__in = django_filters.BaseInFilter(field_name="status", lookup_expr="in")

    class Meta:
        model = Invoice
        fields = ["status", "status__in", "ksef_status", "customer", "is_correction"]

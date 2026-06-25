import django_filters

from .models import Invoice


class InvoiceFilter(django_filters.FilterSet):
    """List filters: status, KSeF status, customer, issue_date range, correction flag."""

    issue_date_after = django_filters.DateFilter(
        field_name="issue_date",
        lookup_expr="gte",
    )
    issue_date_before = django_filters.DateFilter(
        field_name="issue_date",
        lookup_expr="lte",
    )
    is_correction = django_filters.BooleanFilter(field_name="is_correction")

    class Meta:
        model = Invoice
        fields = ["status", "ksef_status", "customer", "is_correction"]

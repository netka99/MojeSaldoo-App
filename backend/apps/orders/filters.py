import django_filters

from .models import Order


class OrderFilter(django_filters.FilterSet):
    """Filters for the order list; delivery range uses gte/lte on ``delivery_date``."""

    delivery_date_after = django_filters.DateFilter(
        field_name="delivery_date",
        lookup_expr="gte",
    )
    delivery_date_before = django_filters.DateFilter(
        field_name="delivery_date",
        lookup_expr="lte",
    )
    without_invoice = django_filters.BooleanFilter(method="filter_without_invoice")

    class Meta:
        model = Order
        fields = ["customer", "status", "delivery_date"]

    def filter_without_invoice(self, queryset, name, value):
        """``confirmed`` or ``delivered`` orders with no ``Invoice`` yet (invoice wizard)."""
        if not value:
            return queryset
        from apps.invoices.models import Invoice

        invoiced_ids = Invoice.objects.values_list("order_id", flat=True).distinct()
        return queryset.filter(
            status__in=(Order.STATUS_CONFIRMED, Order.STATUS_DELIVERED)
        ).exclude(id__in=invoiced_ids)

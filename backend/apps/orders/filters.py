import django_filters

from .models import Order


class OrderFilter(django_filters.FilterSet):
    """Filters for the order list; delivery range uses gte/lte on ``delivery_date``."""

    customer = django_filters.UUIDFilter(field_name="customer__uuid")
    delivery_date_after = django_filters.DateFilter(
        field_name="delivery_date",
        lookup_expr="gte",
    )
    delivery_date_before = django_filters.DateFilter(
        field_name="delivery_date",
        lookup_expr="lte",
    )
    without_invoice = django_filters.BooleanFilter(method="filter_without_invoice")
    exclude_routed = django_filters.BooleanFilter(method="filter_exclude_routed")

    class Meta:
        model = Order
        fields = ["status", "delivery_date"]

    def filter_without_invoice(self, queryset, name, value):
        """``confirmed`` or ``delivered`` orders with no ``Invoice`` yet (invoice wizard)."""
        if not value:
            return queryset
        from apps.invoices.models import Invoice

        invoiced_ids = Invoice.objects.values_list("order_id", flat=True).distinct()
        return queryset.filter(
            status__in=(Order.STATUS_CONFIRMED, Order.STATUS_DELIVERED)
        ).exclude(id__in=invoiced_ids)

    def filter_exclude_routed(self, queryset, name, value):
        """Exclude orders already assigned to an active (non-closed) van route."""
        if not value:
            return queryset
        from apps.van_routes.models import VanRoute

        routed_order_ids = (
            Order.objects.filter(
                van_routes__status__in=VanRoute.ACTIVE_STATUSES,
            )
            .values_list("id", flat=True)
        )
        return queryset.exclude(id__in=routed_order_ids)

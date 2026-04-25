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

    class Meta:
        model = Order
        fields = ["customer", "status", "delivery_date"]

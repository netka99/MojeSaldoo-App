import django_filters

from .models import Product


class ProductFilter(django_filters.FilterSet):
    """Query filters with sensible text matching (icontains) for catalog fields."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    unit = django_filters.CharFilter(field_name="unit", lookup_expr="icontains")
    sku = django_filters.CharFilter(field_name="sku", lookup_expr="icontains")
    barcode = django_filters.CharFilter(field_name="barcode", lookup_expr="icontains")
    is_active = django_filters.BooleanFilter()
    track_batches = django_filters.BooleanFilter()

    class Meta:
        model = Product
        fields = ["name", "unit", "sku", "barcode", "is_active", "track_batches"]

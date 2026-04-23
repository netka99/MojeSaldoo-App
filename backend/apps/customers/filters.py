import django_filters

from .models import Customer


class CustomerFilter(django_filters.FilterSet):
    """Query filters with sensible text matching (icontains) for list fields."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    nip = django_filters.CharFilter(field_name="nip", lookup_expr="icontains")
    country = django_filters.CharFilter(field_name="country", lookup_expr="iexact")
    city = django_filters.CharFilter(field_name="city", lookup_expr="icontains")
    is_active = django_filters.BooleanFilter()
    distance_km = django_filters.NumberFilter()

    class Meta:
        model = Customer
        fields = ["name", "nip", "country", "is_active", "city", "distance_km"]

from django.db.models import QuerySet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated

from .filters import CustomerFilter
from .models import Customer
from .serializers import CustomerSerializer


def _scoped_for_user(qs: QuerySet, user) -> QuerySet:
    if not user.is_authenticated:
        return qs.none()
    if user.is_staff:
        return qs
    return qs.filter(user=user)


class CustomerViewSet(viewsets.ModelViewSet):
    """Full CRUD for customers owned by the current user (staff see all)."""

    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = CustomerFilter
    search_fields = ["name", "nip"]
    ordering_fields = [
        "name",
        "company_name",
        "city",
        "distance_km",
        "payment_terms",
        "credit_limit",
        "created_at",
        "updated_at",
        "is_active",
    ]
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet:
        qs = Customer.objects.all().order_by("-created_at")
        return _scoped_for_user(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        serializer.save(user=self.request.user)

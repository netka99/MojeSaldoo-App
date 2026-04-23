from django.db.models import QuerySet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticated

from .filters import CustomerFilter
from .models import Customer
from .serializers import CustomerSerializer
from apps.users.tenant import filter_queryset_for_current_company


class CustomerViewSet(viewsets.ModelViewSet):
    """Full CRUD for customers in the user's active company."""

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
        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    def perform_update(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

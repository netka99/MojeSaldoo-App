from django.db.models import QuerySet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from django.utils import timezone

from apps.users.permissions import IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .filters import OrderFilter
from .models import Order
from .serializers import OrderItemSerializer, OrderSerializer


class OrderViewSet(viewsets.ModelViewSet):
    """
    CRUD for orders, scoped to ``request.user.current_company``.
    """

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsCompanyMember]
    filterset_class = OrderFilter
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    search_fields = [
        "id",
        "order_number",
        "customer__name",
    ]
    ordering_fields = ("delivery_date", "created_at", "total_gross")
    ordering = ["-created_at"]

    def get_queryset(self) -> QuerySet:
        qs = (
            Order.objects.all()
            .select_related("customer", "company", "user")
            .prefetch_related("items", "items__product")
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        """GET /{id}/items/ — list line items for this order."""
        order = self.get_object()
        data = OrderItemSerializer(
            order.items.all(),
            many=True,
            context=self.get_serializer_context(),
        ).data
        return Response(data)

    @action(detail=True, methods=["post"], url_path="confirm")
    def confirm(self, request, pk=None):
        """POST /{id}/confirm/ — draft → confirmed."""
        order = self.get_object()
        if order.status != Order.STATUS_DRAFT:
            return Response(
                {"error": "Only draft orders can be confirmed"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        order.status = Order.STATUS_CONFIRMED
        if not order.confirmed_at:
            order.confirmed_at = timezone.now()
        order.save()
        return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """POST /{id}/cancel/ — cancel (only when draft or confirmed)."""
        order = self.get_object()
        if order.status not in (Order.STATUS_DRAFT, Order.STATUS_CONFIRMED):
            return Response(
                {
                    "error": f"Order cannot be cancelled in status {order.status!r} "
                    f"(only draft or confirmed)."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        order.status = Order.STATUS_CANCELLED
        order.save()
        return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)

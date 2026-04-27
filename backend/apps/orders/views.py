from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.products.models import ProductStock, StockMovement, Warehouse
from apps.users.permissions import IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .filters import OrderFilter
from .models import Order
from .serializers import OrderItemSerializer, OrderSerializer

# Order was never reserved in draft; all later workflow statuses may still hold
# line reservations from confirm() until released (e.g. on cancel).
_ORDER_STATUSES_WITH_LINE_RESERVATION = frozenset(
    {
        Order.STATUS_CONFIRMED,
        Order.STATUS_IN_PREPARATION,
        Order.STATUS_LOADED,
        Order.STATUS_IN_DELIVERY,
        Order.STATUS_DELIVERED,
        Order.STATUS_INVOICED,
    }
)


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

        with transaction.atomic():
            order = (
                Order.objects.select_for_update()
                .select_related("company")
                .prefetch_related("items", "items__product")
                .get(pk=order.pk)
            )
            if order.status != Order.STATUS_DRAFT:
                return Response(
                    {"error": "Only draft orders can be confirmed"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            items = list(order.items.all())
            main_wh = None
            if items:
                main_wh = (
                    Warehouse.objects.select_for_update()
                    .filter(
                        company_id=order.company_id,
                        warehouse_type=Warehouse.WarehouseType.MAIN,
                        is_active=True,
                    )
                    .order_by("code")
                    .first()
                )
                if main_wh is None:
                    raise ValidationError(
                        {
                            "warehouse": (
                                "No active main warehouse found for this company. "
                                "Configure a warehouse with type 'main' before confirming orders."
                            )
                        }
                    )

            stocks_by_product = {}
            if items:
                product_ids = sorted({item.product_id for item in items})
                for pid in product_ids:
                    stock, _created = ProductStock.objects.get_or_create(
                        company_id=order.company_id,
                        product_id=pid,
                        warehouse=main_wh,
                        defaults={
                            "quantity_available": Decimal("0"),
                            "quantity_reserved": Decimal("0"),
                            "quantity_total": Decimal("0"),
                        },
                    )
                    stock = ProductStock.objects.select_for_update().get(pk=stock.pk)
                    stocks_by_product[pid] = stock

                needed = defaultdict(Decimal)
                for item in items:
                    needed[item.product_id] += item.quantity

                shortfalls = []
                for pid, need_qty in sorted(needed.items(), key=lambda x: str(x[0])):
                    stock = stocks_by_product[pid]
                    if stock.quantity_available < need_qty:
                        line = next(i for i in items if i.product_id == pid)
                        shortfalls.append(
                            {
                                "product_id": str(pid),
                                "product_name": line.product.name,
                                "quantity_available": str(stock.quantity_available),
                                "quantity_requested": str(need_qty),
                                "short_by": str(need_qty - stock.quantity_available),
                            }
                        )
                if shortfalls:
                    raise ValidationError({"stock": shortfalls})

            movement_user = order.user or request.user
            for item in items:
                stock = stocks_by_product[item.product_id]
                qty = item.quantity
                qty_before_avail = stock.quantity_available
                stock.quantity_available -= qty
                stock.quantity_reserved += qty
                stock.save(
                    update_fields=[
                        "quantity_available",
                        "quantity_reserved",
                    ]
                )
                StockMovement.objects.create(
                    company_id=order.company_id,
                    product_id=item.product_id,
                    warehouse=main_wh,
                    user=movement_user,
                    movement_type=StockMovement.MovementType.RESERVATION,
                    quantity=-qty,
                    quantity_before=qty_before_avail,
                    quantity_after=stock.quantity_available,
                    reference_type="order",
                    reference_id=order.id,
                    created_by=request.user,
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

        with transaction.atomic():
            order = (
                Order.objects.select_for_update()
                .select_related("company")
                .prefetch_related("items", "items__product")
                .get(pk=order.pk)
            )
            if order.status not in (Order.STATUS_DRAFT, Order.STATUS_CONFIRMED):
                return Response(
                    {
                        "error": f"Order cannot be cancelled in status {order.status!r} "
                        f"(only draft or confirmed)."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            release_stock = order.status in _ORDER_STATUSES_WITH_LINE_RESERVATION
            items = list(order.items.all())
            main_wh = None

            if release_stock and items:
                main_wh = (
                    Warehouse.objects.select_for_update()
                    .filter(
                        company_id=order.company_id,
                        warehouse_type=Warehouse.WarehouseType.MAIN,
                        is_active=True,
                    )
                    .order_by("code")
                    .first()
                )
                if main_wh is None:
                    raise ValidationError(
                        {
                            "warehouse": (
                                "No active main warehouse found for this company; "
                                "cannot release reserved stock."
                            )
                        }
                    )

                product_ids = sorted({item.product_id for item in items})
                stocks_by_product = {}
                for pid in product_ids:
                    try:
                        stock = ProductStock.objects.select_for_update().get(
                            company_id=order.company_id,
                            product_id=pid,
                            warehouse=main_wh,
                        )
                    except ProductStock.DoesNotExist:
                        line = next(i for i in items if i.product_id == pid)
                        raise ValidationError(
                            {
                                "stock": [
                                    {
                                        "product_id": str(pid),
                                        "product_name": line.product.name,
                                        "detail": (
                                            "No ProductStock row for this product at the "
                                            "main warehouse; cannot unreserve."
                                        ),
                                    }
                                ]
                            }
                        )
                    stocks_by_product[pid] = stock

                needed_reserved = defaultdict(Decimal)
                for item in items:
                    needed_reserved[item.product_id] += item.quantity

                shortfalls = []
                for pid, need_qty in sorted(
                    needed_reserved.items(), key=lambda x: str(x[0])
                ):
                    stock = stocks_by_product[pid]
                    if stock.quantity_reserved < need_qty:
                        line = next(i for i in items if i.product_id == pid)
                        shortfalls.append(
                            {
                                "product_id": str(pid),
                                "product_name": line.product.name,
                                "quantity_reserved": str(stock.quantity_reserved),
                                "quantity_to_release": str(need_qty),
                                "short_by": str(need_qty - stock.quantity_reserved),
                            }
                        )
                if shortfalls:
                    raise ValidationError({"stock": shortfalls})

                movement_user = order.user or request.user
                for item in items:
                    stock = stocks_by_product[item.product_id]
                    qty = item.quantity
                    qty_before_avail = stock.quantity_available
                    stock.quantity_reserved -= qty
                    stock.quantity_available += qty
                    stock.save(
                        update_fields=[
                            "quantity_available",
                            "quantity_reserved",
                        ]
                    )
                    StockMovement.objects.create(
                        company_id=order.company_id,
                        product_id=item.product_id,
                        warehouse=main_wh,
                        user=movement_user,
                        movement_type=StockMovement.MovementType.UNRESERVATION,
                        quantity=qty,
                        quantity_before=qty_before_avail,
                        quantity_after=stock.quantity_available,
                        reference_type="order",
                        reference_id=order.id,
                        created_by=request.user,
                    )

            order.status = Order.STATUS_CANCELLED
            order.save()

        return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)

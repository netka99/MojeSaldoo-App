from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Exists, OuterRef, QuerySet, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.products.models import ProductStock, StockMovement, Warehouse
from apps.users.permissions import HasCompanyPermission, IsCompanyMember, ModuleRequired, company_has_module
from apps.users.tenant import filter_queryset_for_current_company
from apps.activity.log import log_activity, log_error, log_success
from apps.activity.format import flatten_error_value
from apps.activity.models import ActivityLog

from .filters import OrderFilter
from .models import Order, OrderChangeLog
from .serializers import OrderChangeLogSerializer, OrderItemSerializer, OrderSerializer

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
    lookup_field = "uuid"

    serializer_class = OrderSerializer
    module_required = "orders"
    required_permission = 'can_manage_orders'
    permission_classes = [IsAuthenticated, IsCompanyMember, ModuleRequired, HasCompanyPermission]
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
        from apps.invoices.models import Invoice, InvoiceOrder
        from apps.delivery.models import DeliveryDocument
        _active = ["draft", "issued", "sent", "paid", "overdue"]
        has_legacy = Invoice.objects.filter(
            order=OuterRef("pk"),
            status__in=_active,
            is_correction=False,
        )
        has_multi = InvoiceOrder.objects.filter(
            order=OuterRef("pk"),
            invoice__status__in=_active,
            invoice__is_correction=False,
        )
        has_wz = DeliveryDocument.objects.filter(order=OuterRef("pk"))
        qs = (
            Order.objects.all()
            .select_related("customer", "company", "user")
            .prefetch_related(
                "items", "items__product", "production_orders",
                "delivery_documents",
                "delivery_documents__wz_corrections",
                "invoices",
                "invoices__corrections",
                "invoice_orders__invoice",
                "invoice_orders__invoice__corrections",
            )
            .annotate(
                has_active_invoice=Exists(has_legacy) | Exists(has_multi),
                has_wz=Exists(has_wz),
            )
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def list(self, request, *args, **kwargs):
        """List orders — same as default but adds `total_gross_sum` to the paginated response."""
        qs = self.filter_queryset(self.get_queryset())
        agg = qs.aggregate(total_gross_sum=Sum("total_gross"))
        total_gross_sum = agg["total_gross_sum"] or Decimal("0")

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            response = self.get_paginated_response(serializer.data)
            response.data["total_gross_sum"] = str(total_gross_sum)
            return response

        serializer = self.get_serializer(qs, many=True)
        return Response({"results": serializer.data, "total_gross_sum": str(total_gross_sum)})

    @action(detail=False, methods=["get"], url_path="product-summary")
    def product_summary(self, request):
        """GET /orders/product-summary/?<same filters as list>
        Returns per-product totals across all orders matching the current filters.
        Sorted by total_gross descending.
        """
        from .models import OrderItem
        order_qs = self.filter_queryset(self.get_queryset())
        rows = (
            OrderItem.objects
            .filter(order__in=order_qs)
            .values("product_name", "product_unit")
            .annotate(
                total_quantity=Sum("quantity"),
                total_gross=Coalesce(Sum("line_total_gross"), Value(Decimal("0"))),
            )
            .order_by("-total_gross")
        )
        return Response([
            {
                "product_name": r["product_name"],
                "unit": r["product_unit"],
                "total_quantity": str(r["total_quantity"]),
                "total_gross": str(r["total_gross"]),
            }
            for r in rows
        ])

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, uuid=None):
        """GET /{id}/items/ — list line items for this order."""
        order = self.get_object()
        data = OrderItemSerializer(
            order.items.all(),
            many=True,
            context=self.get_serializer_context(),
        ).data
        return Response(data)

    @action(detail=True, methods=["post"], url_path="confirm")
    def confirm(self, request, uuid=None):
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
                    {"error": "Tylko zamówienia w statusie 'szkic' mogą być potwierdzone."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            track_stock = company_has_module(order.company, "warehouses")
            items = list(order.items.all())
            main_wh = None

            if items and track_stock:
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
                    log_activity(
                        user=request.user,
                        action="order.confirm",
                        status=ActivityLog.STATUS_ERROR,
                        error_code="ORDER_NO_WAREHOUSE",
                        object_type="order",
                        object_id=str(order.uuid),
                        request=request,
                    )
                    raise ValidationError(
                        {
                            "warehouse": (
                                "Brak aktywnego magazynu głównego dla tej firmy. "
                                "Skonfiguruj magazyn typu 'main' przed potwierdzeniem zamówień."
                            )
                        }
                    )

            stocks_by_product = {}
            if items and track_stock:
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
                if shortfalls and not main_wh.allow_negative_stock:
                    log_error(
                        user=request.user, action="order.confirm",
                        error_code="ORDER_STOCK_SHORTFALL",
                        error_detail=flatten_error_value({"stock": shortfalls}),
                        object_type="order", object_id=str(order.uuid), request=request,
                    )
                    raise ValidationError({"stock": shortfalls})

            movement_user = order.user or request.user
            if track_stock:
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
                        reference_id=order.uuid,
                        created_by=request.user,
                    )

            order.status = Order.STATUS_CONFIRMED
            if not order.confirmed_at:
                order.confirmed_at = timezone.now()
            order.save()
            log_activity(
                user=request.user, action="order.confirm",
                status=ActivityLog.STATUS_SUCCESS,
                object_type="order", object_id=str(order.uuid),
            )

        return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="unblock")
    def unblock(self, request, uuid=None):
        """POST /{id}/unblock/ — revert invoiced order to delivered when all its invoices are corrected/cancelled."""
        from apps.invoices.models import Invoice, InvoiceOrder
        order = self.get_object()

        if order.status != Order.STATUS_INVOICED:
            return Response(
                {"error": "Tylko zamówienia w statusie 'zafakturowane' mogą być odblokowane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check that no active (non-corrected) invoice exists for this order
        _active = ["draft", "issued", "sent", "paid", "overdue"]
        has_active_legacy = Invoice.objects.filter(
            order=order, status__in=_active, is_correction=False
        ).exists()
        has_active_multi = InvoiceOrder.objects.filter(
            order=order, invoice__status__in=_active, invoice__is_correction=False
        ).exists()

        if has_active_legacy or has_active_multi:
            return Response(
                {"error": "Zamówienie ma aktywne faktury. Najpierw skoryguj lub anuluj wszystkie faktury."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        order.status = Order.STATUS_DELIVERED
        order.save(update_fields=["status", "updated_at"])
        log_activity(
            user=request.user, action="order.unblock",
            status="success",
            object_type="order", object_id=str(order.uuid),
        )
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, uuid=None):
        """POST /{id}/cancel/ — cancel (only when draft or confirmed)."""
        order = self.get_object()
        if order.status not in (Order.STATUS_DRAFT, Order.STATUS_CONFIRMED):
            log_error(
                user=request.user, action="order.cancel", error_code="DELIVERY_WRONG_STATUS",
                error_detail=f"Status zamówienia: {order.status}.",
                object_type="order", object_id=str(order.uuid), request=request,
            )
            return Response(
                {
                    "error": f"Zamówienie w statusie '{order.status}' nie może być anulowane "
                    "(tylko szkic lub potwierdzone)."
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
                        "error": f"Zamówienie w statusie '{order.status}' nie może być anulowane "
                        "(tylko szkic lub potwierdzone)."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            track_stock = company_has_module(order.company, "warehouses")
            release_stock = order.status in _ORDER_STATUSES_WITH_LINE_RESERVATION
            items = list(order.items.all())
            main_wh = None

            if release_stock and items and track_stock:
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
                                "Brak aktywnego magazynu głównego — nie można zwolnić "
                                "zarezerwowanego stanu magazynowego."
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
                                            "Brak rekordu stanu magazynowego dla tego produktu — "
                                            "nie można cofnąć rezerwacji."
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
                        reference_id=order.uuid,
                        created_by=request.user,
                    )

            order.status = Order.STATUS_CANCELLED
            order.save()

        log_success(
            user=request.user, action="order.cancel",
            object_type="order", object_id=str(order.uuid),
        )
        return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="changelog")
    def changelog(self, request, uuid=None):
        """GET /{id}/changelog/ — change history for this order, newest first."""
        order = self.get_object()
        qs = order.changelog.select_related("changed_by").order_by("-changed_at")
        data = OrderChangeLogSerializer(qs, many=True).data
        return Response(data)

    @action(detail=True, methods=["post"], url_path="apply-wz-correction")
    def apply_wz_correction(self, request, uuid=None):
        """
        POST /{id}/apply-wz-correction/
        body: { "wz_kor_id": "<uuid>" }

        Adjusts OrderItem.quantity for each product corrected by the WZ-KOR:
          new_quantity = quantity_delivered - wz_kor_quantity
        Writes OrderChangeLog entries per changed line.
        If all lines reach 0, cancels the order.
        """
        from apps.delivery.models import DeliveryDocument, DeliveryItem

        order = self.get_object()
        wz_kor_id = request.data.get("wz_kor_id")
        if not wz_kor_id:
            raise ValidationError({"wz_kor_id": "To pole jest wymagane."})

        try:
            wz_kor = DeliveryDocument.objects.prefetch_related(
                "items__product"
            ).get(uuid=wz_kor_id, document_type="WZ-KOR")
        except DeliveryDocument.DoesNotExist:
            raise ValidationError({"wz_kor_id": "Nie znaleziono dokumentu WZ-KOR."})

        if str(wz_kor.order_id) != str(order.uuid) and wz_kor.order_id != order.id:
            # wz_kor.order is FK by PK; order.uuid is the lookup field
            # Accept if the WZ-KOR's corrects_wz links back to this order
            from apps.delivery.models import DeliveryDocument as DD
            original_wz = wz_kor.corrects_wz
            if not original_wz or str(getattr(original_wz, "order_id", None)) != str(order.id):
                raise ValidationError({"wz_kor_id": "Ten WZ-KOR nie dotyczy tego zamówienia."})

        # Build product → correction quantity map from WZ-KOR items
        kor_qty: dict = {}
        for item in wz_kor.items.all():
            pid = item.product_id
            qty = item.quantity_planned or Decimal("0")
            kor_qty[pid] = kor_qty.get(pid, Decimal("0")) + qty

        order_items = list(order.items.select_related("product").all())

        with transaction.atomic():
            changelog_entries = []
            all_zero = True

            for oi in order_items:
                correction = kor_qty.get(oi.product_id)
                if correction is None:
                    # Not touched by this WZ-KOR
                    if oi.quantity > Decimal("0"):
                        all_zero = False
                    continue

                old_qty = oi.quantity
                new_qty = max(oi.quantity_delivered - correction, Decimal("0"))

                if new_qty != old_qty:
                    oi.quantity = new_qty
                    oi._recompute_line_totals()
                    oi.save(update_fields=["quantity", "line_total_net", "line_total_gross"])

                    changelog_entries.append(OrderChangeLog(
                        order=order,
                        changed_by=request.user,
                        change_type=OrderChangeLog.CHANGE_QTY,
                        product_id=oi.product.uuid,
                        product_name=oi.product_name or oi.product.name,
                        product_unit=oi.product_unit or oi.product.unit,
                        quantity_before=old_qty,
                        quantity_after=new_qty,
                    ))

                if oi.quantity > Decimal("0"):
                    all_zero = False

            if changelog_entries:
                OrderChangeLog.objects.bulk_create(changelog_entries)

            # Recalculate order totals after quantity changes using fresh DB values
            # Clear any prefetch cache on the order instance before querying items
            if hasattr(order, '_prefetched_objects_cache'):
                order._prefetched_objects_cache.clear()
            fresh_items = list(order.items.all())
            new_subtotal_gross = sum((i.line_total_gross for i in fresh_items), Decimal("0.00"))
            new_subtotal_net = sum((i.line_total_net for i in fresh_items), Decimal("0.00"))
            disc = order.discount_percent or Decimal("0")
            if disc > 0:
                factor = max(Decimal("1") - disc / Decimal("100"), Decimal("0"))
                order.subtotal_gross = new_subtotal_gross
                order.subtotal_net = new_subtotal_net
                order.total_gross = (new_subtotal_gross * factor).quantize(Decimal("0.01"))
                order.total_net = (new_subtotal_net * factor).quantize(Decimal("0.01"))
            else:
                order.subtotal_gross = new_subtotal_gross
                order.subtotal_net = new_subtotal_net
                order.total_gross = new_subtotal_gross
                order.total_net = new_subtotal_net
            order.save(update_fields=["subtotal_gross", "subtotal_net", "total_gross", "total_net"])

            if all_zero and order.status not in (Order.STATUS_CANCELLED,):
                order.status = Order.STATUS_CANCELLED
                order.save(update_fields=["status"])

            # Mark WZ-KOR as applied to order
            wz_kor.order_correction_applied = True
            wz_kor.save(update_fields=["order_correction_applied"])

            log_success(
                user=request.user,
                action="order.wz_kor_applied",
                object_type="order",
                object_id=str(order.uuid),
            )

        # Re-fetch fresh order data for response (calculate_total + status changes)
        order = Order.objects.get(pk=order.pk)
        return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)

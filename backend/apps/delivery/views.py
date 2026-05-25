from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.invoices.models import Invoice
from apps.orders.models import Order, OrderItem
from apps.products.models import ProductStock, StockMovement, Warehouse
from apps.users.permissions import IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .filters import DeliveryDocumentFilter
from .models import DeliveryDocument, DeliveryItem
from .serializers import (
    DeliveryCompleteSerializer,
    DeliveryDocumentListSerializer,
    DeliveryDocumentSerializer,
    DeliveryUpdateLinesSerializer,
    SaveWithReturnsSerializer,
    VanLoadingSerializer,
    VanReconciliationSerializer,
)
from .services import (
    apply_delivery_document_line_updates,
    apply_van_reconciliation,
    build_delivery_document_preview_data,
    create_van_loading_mm,
    create_zw_from_pending_returns,
    default_from_warehouse_for_delivery,
)


class DeliveryDocumentPagination(PageNumberPagination):
    """Allows callers to request up to 500 results via ``?page_size=N``."""

    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 500


class DeliveryDocumentViewSet(viewsets.ModelViewSet):
    """CRUD for delivery documents, scoped to ``request.user.current_company``."""

    serializer_class = DeliveryDocumentSerializer
    pagination_class = DeliveryDocumentPagination
    permission_classes = [IsAuthenticated, IsCompanyMember]
    filterset_class = DeliveryDocumentFilter
    filter_backends = [
        DjangoFilterBackend,
        filters.OrderingFilter,
    ]
    ordering_fields = ("issue_date", "created_at", "document_number", "status")
    ordering = ["-created_at"]

    def _wants_items(self) -> bool:
        """Return True when the caller explicitly requests item data via ``?include_items``."""
        return self.request.query_params.get("include_items", "").lower() in ("1", "true", "yes")

    def get_serializer_class(self):
        if self.action == "list" and not self._wants_items():
            return DeliveryDocumentListSerializer
        return DeliveryDocumentSerializer

    def get_queryset(self) -> QuerySet:
        qs = (
            DeliveryDocument.objects.all()
            .select_related(
                "company",
                "order",
                "order__customer",
                "user",
                "from_warehouse",
                "to_warehouse",
                "to_customer",
                "linked_wz",
            )
        )

        if self.action != "list" or self._wants_items():
            qs = qs.prefetch_related("items", "items__product", "items__order_item")
            qs = qs.prefetch_related(
                Prefetch(
                    "return_documents",
                    queryset=DeliveryDocument.objects.prefetch_related(
                        Prefetch(
                            "items",
                            queryset=DeliveryItem.objects.select_related("product"),
                        )
                    ),
                ),
            )
            qs = qs.prefetch_related(
                Prefetch(
                    "invoices",
                    queryset=Invoice.objects.order_by("created_at").only(
                        "id",
                        "delivery_document_id",
                        "invoice_number",
                    ),
                ),
            )

        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    @action(detail=False, methods=["post"], url_path="create-standalone")
    def create_standalone(self, request):
        """POST /delivery/create-standalone/ — create a draft WZ with items in one call.

        Body:
          {
            "to_customer_id": "<uuid>",
            "issue_date": "2026-05-19",          # optional, defaults to today
            "items": [
              {"product_id": "<uuid>", "quantity_planned": "3.00"},
              ...
            ]
          }

        Returns the created DeliveryDocument with items populated.
        """
        from apps.products.models import Product as ProductModel

        company_id = request.user.current_company_id
        to_customer_id = request.data.get("to_customer_id")
        issue_date_raw = request.data.get("issue_date")
        items_data = request.data.get("items", [])

        if not to_customer_id:
            return Response({"error": "to_customer_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not items_data:
            return Response({"error": "At least one item is required."}, status=status.HTTP_400_BAD_REQUEST)

        from apps.customers.models import Customer
        try:
            customer = Customer.objects.get(pk=to_customer_id, company_id=company_id)
        except Customer.DoesNotExist:
            return Response({"error": "Customer not found."}, status=status.HTTP_400_BAD_REQUEST)

        issue_date = timezone.localdate()
        if issue_date_raw:
            from django.utils.dateparse import parse_date
            parsed = parse_date(str(issue_date_raw))
            if parsed:
                issue_date = parsed

        product_ids = [row.get("product_id") for row in items_data if row.get("product_id")]
        products_by_id = {
            str(p.pk): p
            for p in ProductModel.objects.filter(pk__in=product_ids, company_id=company_id)
        }

        with transaction.atomic():
            doc = DeliveryDocument.objects.create(
                company=request.user.current_company,
                user=request.user,
                document_type=DeliveryDocument.DOC_TYPE_WZ,
                issue_date=issue_date,
                to_customer=customer,
                from_warehouse=default_from_warehouse_for_delivery(company_id),
                status=DeliveryDocument.STATUS_DRAFT,
            )
            for row in items_data:
                pid = str(row.get("product_id", ""))
                product = products_by_id.get(pid)
                if not product:
                    continue
                try:
                    qty = Decimal(str(row.get("quantity_planned", "1")))
                except Exception:
                    qty = Decimal("1")
                if qty <= 0:
                    continue
                DeliveryItem.objects.create(
                    delivery_document=doc,
                    product=product,
                    quantity_planned=qty,
                )

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_locked_by_invoice():
            raise ValidationError(
                {
                    "detail": (
                        "Delivery document is linked to an invoice and cannot be deleted."
                    )
                },
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="update-lines")
    def update_lines(self, request, pk=None):
        """Bulk update line fields; reconciles order + stock after ``delivered``."""
        doc = self.get_object()
        if doc.is_locked_by_invoice():
            raise ValidationError(
                {
                    "detail": (
                        "Delivery document is linked to an invoice and cannot be changed."
                    )
                },
            )
        ser = DeliveryUpdateLinesSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rows = ser.validated_data["items"]
        apply_delivery_document_line_updates(
            doc=doc,
            items_payload=list(rows),
            user=request.user,
        )
        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request, pk=None):
        doc = self.get_object()
        return Response(build_delivery_document_preview_data(doc))

    @action(detail=True, methods=["post"], url_path="save")
    def save(self, request, pk=None):
        """draft → saved.

        Optional body: ``{"return_items": [{"product_id": "...", "quantity": "2.00",
        "return_reason": "Po terminie"}]}``
        When ``return_items`` is present the system atomically:
          1. Creates a ZW (Zwrot Zewnętrzny) document with those lines.
          2. Adds returned stock back to the source warehouse (van).
          3. Transitions the WZ to ``saved``.
        """
        doc = self.get_object()
        if doc.is_locked_by_invoice():
            raise ValidationError(
                {
                    "detail": (
                        "Delivery document is linked to an invoice and cannot be changed."
                    )
                },
            )
        if doc.status != DeliveryDocument.STATUS_DRAFT:
            return Response(
                {"error": "Only draft documents can be saved."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Parse optional return items
        return_items = []
        if request.data:
            ser = SaveWithReturnsSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            return_items = ser.validated_data.get("return_items") or []

        with transaction.atomic():
            doc = (
                DeliveryDocument.objects.select_for_update()
                .select_related("company", "from_warehouse", "to_customer")
                .get(pk=doc.pk)
            )
            if doc.status != DeliveryDocument.STATUS_DRAFT:
                return Response(
                    {"error": "Only draft documents can be saved."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if return_items:
                create_zw_from_pending_returns(
                    wz_doc=doc,
                    return_items=[
                        {
                            "product_id": row["product_id"],
                            "quantity": row["quantity"],
                            "return_reason": row.get("return_reason") or "",
                        }
                        for row in return_items
                    ],
                    user=request.user,
                )

            doc.status = DeliveryDocument.STATUS_SAVED
            doc.user = request.user
            doc.save(update_fields=["status", "user", "updated_at"])

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"], url_path="start-delivery")
    def start_delivery(self, request, pk=None):
        """saved → in_transit."""
        doc = self.get_object()
        if doc.is_locked_by_invoice():
            raise ValidationError(
                {
                    "detail": (
                        "Delivery document is linked to an invoice and cannot be changed."
                    )
                },
            )
        if doc.status != DeliveryDocument.STATUS_SAVED:
            return Response(
                {"error": "Only saved documents can start delivery."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        doc.status = DeliveryDocument.STATUS_IN_TRANSIT
        doc.user = request.user
        doc.save(update_fields=["status", "user", "updated_at"])
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        """in_transit → delivered; apply actual quantities and returns; sync order lines."""
        doc = self.get_object()
        if doc.is_locked_by_invoice():
            raise ValidationError(
                {
                    "detail": (
                        "Delivery document is linked to an invoice and cannot be changed."
                    )
                },
            )
        if doc.status != DeliveryDocument.STATUS_IN_TRANSIT:
            return Response(
                {"error": "Only documents in transit can be completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = DeliveryCompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        rows = data.get("items") or []
        payload_by_id = {str(row["id"]): row for row in rows}

        doc_items_preview = list(
            doc.items.select_related("order_item")
        )
        valid_ids = {str(i.id) for i in doc_items_preview}
        extra = set(payload_by_id) - valid_ids
        if extra:
            return Response(
                {"error": f"Unknown delivery item id(s): {', '.join(sorted(extra))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            doc = (
                DeliveryDocument.objects.select_for_update()
                .select_related("from_warehouse", "company", "order", "user")
                .prefetch_related("items__product", "items__order_item")
                .get(pk=doc.pk)
            )
            if doc.status != DeliveryDocument.STATUS_IN_TRANSIT:
                return Response(
                    {"error": "Only documents in transit can be completed."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            doc_items = list(doc.items.select_related("order_item"))
            line_ops = []
            any_return = False

            for item in doc_items:
                row = payload_by_id.get(str(item.id))
                if row:
                    actual = row.get("quantity_actual")
                    ret = row.get("quantity_returned")
                    if ret is None:
                        ret = Decimal("0")
                    reason = row.get("return_reason", "")
                    is_damaged = row.get("is_damaged", False)
                    notes = row.get("notes", "")
                else:
                    actual = None
                    ret = Decimal("0")
                    reason = ""
                    is_damaged = False
                    notes = ""

                if actual is None:
                    actual = item.quantity_planned
                if ret < 0 or actual < 0:
                    return Response(
                        {"error": "Quantities cannot be negative."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if ret > actual:
                    return Response(
                        {
                            "error": (
                                f"quantity_returned cannot exceed quantity_actual "
                                f"for item {item.id}."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                oi = item.order_item
                oi.refresh_from_db()
                net = actual - ret
                if oi.quantity_delivered + net > oi.quantity:
                    return Response(
                        {
                            "error": (
                                f"Order line {oi.id} would exceed ordered quantity "
                                f"({oi.quantity_delivered} + {net} > {oi.quantity})."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                item.quantity_actual = actual
                item.quantity_returned = ret
                item.return_reason = reason or ""
                item.is_damaged = is_damaged
                item.notes = notes or ""
                item.save(
                    update_fields=[
                        "quantity_actual",
                        "quantity_returned",
                        "return_reason",
                        "is_damaged",
                        "notes",
                    ]
                )

                oi.quantity_delivered += net
                oi.quantity_returned += ret
                oi.save(update_fields=["quantity_delivered", "quantity_returned"])

                if ret > 0:
                    any_return = True

                line_ops.append((item, actual, ret))

            if any(a > 0 or r > 0 for _, a, r in line_ops):
                if doc.from_warehouse_id is None:
                    raise ValidationError(
                        {
                            "from_warehouse": (
                                "Delivery document has no source warehouse; "
                                "set from_warehouse before completing."
                            )
                        }
                    )

                sale_by_product = defaultdict(Decimal)
                return_by_product = defaultdict(Decimal)
                for item, actual, ret in line_ops:
                    if actual > 0:
                        sale_by_product[item.product_id] += actual
                    if ret > 0:
                        return_by_product[item.product_id] += ret

                all_product_ids = sorted(
                    set(sale_by_product) | set(return_by_product),
                    key=str,
                )
                stocks = {}
                for pid in all_product_ids:
                    try:
                        st = ProductStock.objects.select_for_update().get(
                            company_id=doc.company_id,
                            product_id=pid,
                            warehouse_id=doc.from_warehouse_id,
                        )
                    except ProductStock.DoesNotExist:
                        line = next(i for i, _, _ in line_ops if i.product_id == pid)
                        raise ValidationError(
                            {
                                "stock": [
                                    {
                                        "product_id": str(pid),
                                        "product_name": line.product.name,
                                        "detail": (
                                            "No ProductStock for this product at "
                                            "from_warehouse."
                                        ),
                                    }
                                ]
                            }
                        )
                    stocks[pid] = st

                shortfalls = []
                for pid, need in sorted(sale_by_product.items(), key=lambda x: str(x[0])):
                    if stocks[pid].quantity_reserved < need:
                        line = next(i for i, _, _ in line_ops if i.product_id == pid)
                        shortfalls.append(
                            {
                                "product_id": str(pid),
                                "product_name": line.product.name,
                                "quantity_reserved": str(stocks[pid].quantity_reserved),
                                "quantity_to_consume": str(need),
                                "short_by": str(need - stocks[pid].quantity_reserved),
                            }
                        )
                if shortfalls:
                    raise ValidationError({"stock": shortfalls})

                movement_user = doc.user or request.user

                for item, actual, ret in line_ops:
                    if actual <= 0:
                        continue
                    stock = stocks[item.product_id]
                    qty_before_avail = stock.quantity_available
                    stock.quantity_reserved -= actual
                    stock.save(update_fields=["quantity_reserved"])
                    StockMovement.objects.create(
                        company_id=doc.company_id,
                        product_id=item.product_id,
                        warehouse_id=doc.from_warehouse_id,
                        user=movement_user,
                        movement_type=StockMovement.MovementType.SALE,
                        quantity=-actual,
                        quantity_before=qty_before_avail,
                        quantity_after=stock.quantity_available,
                        reference_type="delivery",
                        reference_id=doc.id,
                        created_by=request.user,
                    )

                for item, actual, ret in line_ops:
                    if ret <= 0:
                        continue
                    stock = stocks[item.product_id]
                    qty_before_avail = stock.quantity_available
                    stock.quantity_available += ret
                    stock.save(update_fields=["quantity_available"])
                    StockMovement.objects.create(
                        company_id=doc.company_id,
                        product_id=item.product_id,
                        warehouse_id=doc.from_warehouse_id,
                        user=movement_user,
                        movement_type=StockMovement.MovementType.RETURN,
                        quantity=ret,
                        quantity_before=qty_before_avail,
                        quantity_after=stock.quantity_available,
                        reference_type="delivery",
                        reference_id=doc.id,
                        created_by=request.user,
                    )

            doc.status = DeliveryDocument.STATUS_DELIVERED
            doc.delivered_at = timezone.now()
            doc.user = request.user
            if data.get("receiver_name") is not None:
                doc.receiver_name = data["receiver_name"]
            if data.get("returns_notes") is not None:
                doc.returns_notes = data["returns_notes"]
            if "has_returns" in data:
                doc.has_returns = bool(data["has_returns"])
            else:
                doc.has_returns = any_return
            doc.save(
                update_fields=[
                    "status",
                    "delivered_at",
                    "user",
                    "receiver_name",
                    "returns_notes",
                    "has_returns",
                    "updated_at",
                ]
            )

            if doc.order_id:
                order = Order.objects.select_for_update().get(pk=doc.order_id)
                lines = list(order.items.all())
                if lines and all(
                    (oi.quantity_delivered or Decimal("0")) >= oi.quantity for oi in lines
                ):
                    if order.status not in (
                        Order.STATUS_DELIVERED,
                        Order.STATUS_INVOICED,
                        Order.STATUS_CANCELLED,
                    ):
                        order.update_status(Order.STATUS_DELIVERED)

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"], url_path="add-returns")
    def add_returns(self, request, pk=None):
        """POST /{id}/add-returns/ — create a ZW document from return items without
        changing the WZ status.  Works for any WZ in draft/saved/in_transit/delivered
        that is not invoice-locked or cancelled.

        Body: ``{"return_items": [{"product_id": "...", "quantity": "2.00",
        "return_reason": "Po terminie"}]}``
        """
        doc = self.get_object()
        if doc.is_locked_by_invoice():
            raise ValidationError(
                {"detail": "Delivery document is linked to an invoice and cannot be changed."}
            )
        if doc.status == DeliveryDocument.STATUS_CANCELLED:
            return Response(
                {"error": "Cannot add returns to a cancelled document."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if doc.document_type != DeliveryDocument.DOC_TYPE_WZ:
            return Response(
                {"error": "add-returns is only available for WZ documents."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = SaveWithReturnsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return_items = ser.validated_data.get("return_items") or []
        if not return_items:
            return Response({"error": "return_items must not be empty."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            create_zw_from_pending_returns(
                wz_doc=doc,
                return_items=[
                    {
                        "product_id": row["product_id"],
                        "quantity": row["quantity"],
                        "return_reason": row.get("return_reason") or "",
                    }
                    for row in return_items
                ],
                user=request.user,
            )

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(detail=False, methods=["post"], url_path="van-loading")
    def van_loading(self, request):
        """Create MM (main → mobile), move ``quantity_available``, return the document."""
        ser = VanLoadingSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        company_id = request.user.current_company_id
        data = ser.validated_data
        from_wh = get_object_or_404(
            Warehouse.objects.filter(company_id=company_id),
            pk=data["from_warehouse_id"],
        )
        to_wh = get_object_or_404(
            Warehouse.objects.filter(company_id=company_id),
            pk=data["to_warehouse_id"],
        )
        items = [
            {"product_id": row["product_id"], "quantity": row["quantity"]}
            for row in data["items"]
        ]
        doc = create_van_loading_mm(
            company_id=company_id,
            user=request.user,
            from_warehouse=from_wh,
            to_warehouse=to_wh,
            items=items,
            issue_date=data.get("issue_date"),
            driver_name=(data.get("driver_name") or "").strip(),
            notes=(data.get("notes") or "").strip(),
        )
        out = DeliveryDocumentSerializer(doc, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"van-reconciliation/(?P<van_warehouse_id>[^/.]+)",
    )
    def van_reconciliation(self, request, van_warehouse_id=None):
        """End-of-day van count: compare physical stock to MV book and write movements."""
        ser = VanReconciliationSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        company_id = request.user.current_company_id
        van_wh = get_object_or_404(
            Warehouse.objects.filter(company_id=company_id),
            pk=van_warehouse_id,
        )
        rows = ser.validated_data.get("items") or []
        items = [
            {
                "product_id": row["product_id"],
                "quantity_actual_remaining": row["quantity_actual_remaining"],
            }
            for row in rows
        ]
        summary = apply_van_reconciliation(
            company_id=company_id,
            user=request.user,
            van_warehouse=van_wh,
            items=items,
        )
        return Response(summary, status=status.HTTP_200_OK)

    def _wz_planned_lines(self, order: Order) -> list[tuple[OrderItem, Decimal]]:
        """Pairs of order item and remaining quantity to plan on a new WZ.

        Subtracts quantities already covered by delivered WZ (quantity_delivered on
        the order item) AND quantities planned on active WZ drafts/in-transit that
        have not yet been completed, to prevent double-booking.
        """
        # Sum quantity_planned per product across active (non-cancelled, non-completed) WZ
        active_statuses = (
            DeliveryDocument.STATUS_DRAFT,
            DeliveryDocument.STATUS_SAVED,
            DeliveryDocument.STATUS_IN_TRANSIT,
        )
        active_wz_qs = DeliveryDocument.objects.filter(
            order=order,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            status__in=active_statuses,
        ).prefetch_related("items")

        planned_by_product: dict[int, Decimal] = defaultdict(Decimal)
        for wz in active_wz_qs:
            for item in wz.items.all():
                planned_by_product[item.product_id] += item.quantity_planned or Decimal("0")

        rows: list[tuple[OrderItem, Decimal]] = []
        for oi in order.items.select_related("product"):
            already_delivered = oi.quantity_delivered or Decimal("0")
            already_planned = planned_by_product.get(oi.product_id, Decimal("0"))
            remaining = oi.quantity - already_delivered - already_planned
            if remaining > 0:
                rows.append((oi, remaining))
        return rows

    def _persist_wz_draft_from_order(
        self,
        request,
        order: Order,
        lines: list[tuple[OrderItem, Decimal]],
    ) -> DeliveryDocument:
        company_id = request.user.current_company_id
        doc = DeliveryDocument.objects.create(
            company=order.company,
            order=order,
            user=request.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=timezone.localdate(),
            to_customer=order.customer,
            from_warehouse=default_from_warehouse_for_delivery(company_id),
            status=DeliveryDocument.STATUS_SAVED,
        )
        for oi, qty in lines:
            DeliveryItem.objects.create(
                delivery_document=doc,
                order_item=oi,
                product=oi.product,
                quantity_planned=qty,
            )
        doc.refresh_from_db()
        return doc

    @action(
        detail=False,
        methods=["get"],
        url_path=r"generate-for-order/(?P<order_id>[^/.]+)",
    )
    def generate_for_order(self, request, order_id=None):
        """Create a draft WZ from a confirmed order (remaining quantities per line)."""
        company_id = request.user.current_company_id
        order = get_object_or_404(
            Order.objects.filter(company_id=company_id),
            pk=order_id,
        )
        if order.status != Order.STATUS_CONFIRMED:
            return Response(
                {"error": "Order must be confirmed to generate a delivery document."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lines = self._wz_planned_lines(order)
        if not lines:
            return Response(
                {"error": "No remaining quantity to deliver for this order."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            doc = self._persist_wz_draft_from_order(request, order, lines)
        return Response(self.get_serializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="sync-from-order")
    def sync_from_order(self, request, pk=None):
        """POST /{id}/sync-from-order/ — sync a draft/saved WZ's items to match the
        current order quantities. Updates existing lines, adds missing ones, removes
        lines whose order item was deleted (no WZ quantity can be negative).

        Only allowed while the WZ has not yet left (draft or saved). Locked WZ
        (invoice) and in_transit/delivered documents are rejected.
        """
        doc = self.get_object()

        if doc.is_locked_by_invoice():
            raise ValidationError({"detail": "Document is linked to an invoice and cannot be changed."})

        allowed_statuses = (DeliveryDocument.STATUS_DRAFT, DeliveryDocument.STATUS_SAVED)
        if doc.status not in allowed_statuses:
            return Response(
                {"error": f"Cannot sync a WZ in status '{doc.status}'. Only draft or saved documents can be synced."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if doc.document_type != DeliveryDocument.DOC_TYPE_WZ:
            return Response(
                {"error": "sync-from-order is only available for WZ documents."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not doc.order_id:
            return Response({"error": "This WZ is not linked to an order."}, status=status.HTTP_400_BAD_REQUEST)

        order = doc.order

        # Compute planned qty per product for OTHER active WZ (exclude this doc)
        active_statuses = (DeliveryDocument.STATUS_DRAFT, DeliveryDocument.STATUS_SAVED, DeliveryDocument.STATUS_IN_TRANSIT)
        other_wz_qs = DeliveryDocument.objects.filter(
            order=order,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            status__in=active_statuses,
        ).exclude(pk=doc.pk).prefetch_related("items")

        planned_by_other: dict[int, Decimal] = defaultdict(Decimal)
        for wz in other_wz_qs:
            for item in wz.items.all():
                planned_by_other[item.product_id] += item.quantity_planned or Decimal("0")

        # Build target lines: ordered qty - delivered - planned_by_other_wz
        target: dict[int, tuple[OrderItem, Decimal]] = {}
        for oi in order.items.select_related("product"):
            already_delivered = oi.quantity_delivered or Decimal("0")
            already_planned_elsewhere = planned_by_other.get(oi.product_id, Decimal("0"))
            qty = oi.quantity - already_delivered - already_planned_elsewhere
            if qty > 0:
                target[oi.product_id] = (oi, qty)

        with transaction.atomic():
            existing_items = {item.product_id: item for item in doc.items.all()}

            # Update or create items
            for product_id, (oi, qty) in target.items():
                if product_id in existing_items:
                    wz_item = existing_items[product_id]
                    wz_item.quantity_planned = qty
                    wz_item.save(update_fields=["quantity_planned"])
                else:
                    DeliveryItem.objects.create(
                        delivery_document=doc,
                        order_item=oi,
                        product=oi.product,
                        quantity_planned=qty,
                    )

            # Remove items whose product is no longer in the order target
            for product_id, wz_item in existing_items.items():
                if product_id not in target:
                    wz_item.delete()

            doc.user = request.user
            doc.save(update_fields=["user", "updated_at"])

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(detail=False, methods=["post"], url_path="generate-for-orders")
    def generate_for_orders(self, request):
        """Batch: generate WZ documents for a list of confirmed order IDs."""
        raw_ids = request.data.get("order_ids", [])
        if not isinstance(raw_ids, list):
            return Response(
                {"error": "order_ids must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        id_list: list[str] = []
        seen: set[str] = set()
        for x in raw_ids:
            sid = str(x)
            if sid not in seen:
                seen.add(sid)
                id_list.append(sid)

        if not id_list:
            return Response(
                {"error": "order_ids must not be empty."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        company_id = request.user.current_company_id
        orders = list(
            Order.objects.filter(company_id=company_id, pk__in=id_list)
            .select_related("company", "customer")
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=OrderItem.objects.select_related("product"),
                ),
            ),
        )
        by_id = {str(o.id): o for o in orders}
        missing = [oid for oid in id_list if oid not in by_id]
        if missing:
            return Response(
                {
                    "detail": "One or more orders were not found in this company.",
                    "missing_order_ids": missing,
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        not_confirmed = [
            oid for oid in id_list if by_id[oid].status != Order.STATUS_CONFIRMED
        ]
        if not_confirmed:
            return Response(
                {
                    "detail": "Every order must be confirmed to generate a delivery document.",
                    "not_confirmed_order_ids": not_confirmed,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        line_sets: dict[str, list[tuple[OrderItem, Decimal]]] = {}
        no_remaining: list[str] = []
        for oid in id_list:
            planned = self._wz_planned_lines(by_id[oid])
            line_sets[oid] = planned
            if not planned:
                no_remaining.append(oid)
        if no_remaining:
            return Response(
                {
                    "detail": "No remaining quantity to deliver for one or more orders.",
                    "no_remaining_quantity_order_ids": no_remaining,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        created: list[DeliveryDocument] = []
        with transaction.atomic():
            for oid in id_list:
                order = by_id[oid]
                doc = self._persist_wz_draft_from_order(
                    request,
                    order,
                    line_sets[oid],
                )
                created.append(doc)

        serializer = self.get_serializer(created, many=True)
        return Response(
            {"documents": serializer.data},
            status=status.HTTP_201_CREATED,
        )

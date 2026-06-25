from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, permissions, status, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.invoices.models import Invoice
from apps.orders.models import Order, OrderItem
from apps.products.models import ProductStock, StockMovement, Warehouse
from apps.users.permissions import HasCompanyPermission, IsCompanyMember, _get_active_membership
from apps.users.tenant import filter_queryset_for_current_company

from .filters import DeliveryDocumentFilter
from .models import DeliveryDocument, DeliveryItem
from .serializers import (
    DeliveryCompleteSerializer,
    DeliveryDocumentListSerializer,
    DeliveryDocumentSerializer,
    DeliveryUpdateLinesSerializer,
    PzKorSerializer,
    SaveWithReturnsSerializer,
    VanLoadingSerializer,
    VanReconciliationSerializer,
    WzKorSerializer,
)
from .services import (
    _deduct_fifo_batches,
    apply_delivery_document_line_updates,
    apply_pz_receipt,
    apply_van_reconciliation,
    build_delivery_document_preview_data,
    cancel_pz,
    create_pz_kor,
    create_van_loading_mm,
    create_wz_correction,
    create_zw_from_pending_returns,
    default_from_warehouse_for_delivery,
)


# Maps each document type to the permission flag required to read/write it.
_DOC_TYPE_PERMISSION = {
    DeliveryDocument.DOC_TYPE_WZ: 'can_manage_delivery',
    DeliveryDocument.DOC_TYPE_ZW: 'can_manage_delivery',
    DeliveryDocument.DOC_TYPE_WZ_KOR: 'can_manage_delivery',
    DeliveryDocument.DOC_TYPE_PZ: 'can_manage_purchasing',
    DeliveryDocument.DOC_TYPE_PZ_KOR: 'can_manage_purchasing',
    DeliveryDocument.DOC_TYPE_RW: 'can_manage_stock_moves',
    DeliveryDocument.DOC_TYPE_MM: 'can_manage_stock_moves',
}


class HasAnyDeliveryPermission(permissions.BasePermission):
    """Allow access if the user holds any delivery-related permission flag."""
    message = "Nie masz uprawnień do dokumentów magazynowych."

    def has_permission(self, request, view):
        m = _get_active_membership(request.user)
        if not m:
            return False
        if m.is_admin_member():
            return True
        perms = m.get_permissions()
        return any(perms.get(f) for f in _DOC_TYPE_PERMISSION.values())


class DeliveryDocumentPagination(PageNumberPagination):
    """Allows callers to request up to 500 results via ``?page_size=N``."""

    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 500


class DeliveryDocumentViewSet(viewsets.ModelViewSet):
    """CRUD for delivery documents, scoped to ``request.user.current_company``."""

    serializer_class = DeliveryDocumentSerializer
    pagination_class = DeliveryDocumentPagination
    permission_classes = [IsAuthenticated, IsCompanyMember, HasAnyDeliveryPermission]
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
                "from_supplier",
                "linked_wz",
                "van_route",
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

        qs = filter_queryset_for_current_company(qs, self.request.user)

        # Filter to only document types the user has permission to access.
        m = _get_active_membership(self.request.user)
        if m and not m.is_admin_member():
            perms = m.get_permissions()
            allowed = [dt for dt, flag in _DOC_TYPE_PERMISSION.items() if perms.get(flag)]
            qs = qs.filter(document_type__in=allowed)

        return qs

    def _check_doc_type_permission(self, doc_type: str):
        """Raise PermissionDenied if the user lacks permission for a specific document type."""
        flag = _DOC_TYPE_PERMISSION.get(doc_type)
        if not flag:
            return
        m = _get_active_membership(self.request.user)
        if not m or m.is_admin_member():
            return
        if not m.get_permissions().get(flag):
            self.permission_denied(
                self.request,
                message=f"Nie masz uprawnień do tworzenia dokumentu typu {doc_type}.",
            )

    def create(self, request, *args, **kwargs):
        self._check_doc_type_permission(request.data.get('document_type', ''))
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
        )

    @action(detail=False, methods=["post"], url_path="create-standalone")
    def create_standalone(self, request):
        """POST /delivery/create-standalone/ — create a draft WZ with items in one call.
        Requires can_manage_delivery.

        Body:
          {
            "to_customer_id": "<uuid>",          # optional — omit for unknown-client sales
            "van_route_id": "<uuid>",             # optional — link WZ to active van route
            "from_warehouse_id": "<uuid>",        # optional — override van warehouse
            "issue_date": "2026-05-19",           # optional, defaults to today
            "items": [
              {"product_id": "<uuid>", "quantity_planned": "3.00"},
              ...
            ]
          }

        Returns the created DeliveryDocument with items populated.
        """
        self._check_doc_type_permission(DeliveryDocument.DOC_TYPE_WZ)
        from apps.products.models import Product as ProductModel
        from apps.users.models import get_workflow_settings
        from apps.van_routes.services import get_van_route_for_document, validate_wz_van_route_link

        company_id = request.user.current_company_id
        wf = get_workflow_settings(request.user.current_company)
        van_route_id = request.data.get("van_route_id")
        # Van route WZ are exempt from orders_required — the route is the paper trail.
        if wf.orders_required and not van_route_id:
            return Response(
                {
                    "detail": (
                        "Firma wymaga powiązania WZ z zamówieniem. "
                        "Utwórz WZ z poziomu zamówienia lub wyłącz ustawienie "
                        "'orders_required' w konfiguracji przepływu dokumentów."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        to_customer_id = request.data.get("to_customer_id")
        from_warehouse_id = request.data.get("from_warehouse_id")
        issue_date_raw = request.data.get("issue_date")
        items_data = request.data.get("items", [])

        if not items_data:
            return Response({"error": "At least one item is required."}, status=status.HTTP_400_BAD_REQUEST)

        customer = None
        if to_customer_id:
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

        # Resolve from_warehouse — allow caller to pin a specific van warehouse.
        from_warehouse = default_from_warehouse_for_delivery(company_id)
        if from_warehouse_id:
            try:
                override_wh = Warehouse.objects.get(pk=from_warehouse_id, company_id=company_id)
                if override_wh.warehouse_type == Warehouse.WarehouseType.MOBILE and override_wh.is_active:
                    from_warehouse = override_wh
            except Warehouse.DoesNotExist:
                pass

        van_route = get_van_route_for_document(company_id, van_route_id)
        if van_route and not from_warehouse_id:
            from_warehouse = van_route.van_warehouse
        if van_route:
            validate_wz_van_route_link(
                van_route,
                issue_date=issue_date,
                from_warehouse=from_warehouse,
            )

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
                from_warehouse=from_warehouse,
                van_route=van_route,
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

    @action(detail=False, methods=["post"], url_path="create-pz")
    def create_pz(self, request):
        """POST /delivery/create-pz/ — create a draft PZ document with items in one call.

        Body:
          {
            "to_warehouse_id": "<uuid>",      # required — receiving warehouse
            "from_supplier_id": "<uuid>",     # optional
            "issue_date": "2026-05-29",       # optional, defaults to today
            "notes": "...",                   # optional
            "ksef_number": "...",             # optional — links PZ to source KSeF invoice
            "items": [
              {
                "product_id": "<uuid>",
                "quantity_planned": "10.00",
                "unit_cost": "5.50",
                "ksef_line_position": 0        # optional — which invoice line this came from
              },
              ...
            ]
          }
        """
        self._check_doc_type_permission(DeliveryDocument.DOC_TYPE_PZ)
        from apps.products.models import Product as ProductModel
        from apps.suppliers.models import Supplier
        from apps.ksef.models import ReceivedKSeFInvoice

        company_id = request.user.current_company_id

        to_warehouse_id = request.data.get("to_warehouse_id")
        from_supplier_id = request.data.get("from_supplier_id")
        issue_date_raw = request.data.get("issue_date")
        notes = request.data.get("notes", "")
        ksef_number = (request.data.get("ksef_number") or "").strip()
        items_data = request.data.get("items", [])

        if not to_warehouse_id:
            return Response(
                {"error": "to_warehouse_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not items_data:
            return Response(
                {"error": "At least one item is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            to_warehouse = Warehouse.objects.get(pk=to_warehouse_id, company_id=company_id)
        except Warehouse.DoesNotExist:
            return Response({"error": "Warehouse not found."}, status=status.HTTP_400_BAD_REQUEST)

        from_supplier = None
        if from_supplier_id:
            try:
                from_supplier = Supplier.objects.get(pk=from_supplier_id, company_id=company_id)
            except Supplier.DoesNotExist:
                return Response({"error": "Supplier not found."}, status=status.HTTP_400_BAD_REQUEST)

        ksef_invoice = None
        if ksef_number:
            ksef_invoice = ReceivedKSeFInvoice.objects.filter(
                company_id=company_id, ksef_number=ksef_number
            ).first()
            if ksef_invoice:
                existing_pz = DeliveryDocument.objects.filter(
                    company_id=company_id,
                    ksef_invoice=ksef_invoice,
                    document_type=DeliveryDocument.DOC_TYPE_PZ,
                ).exclude(status=DeliveryDocument.STATUS_CANCELLED).first()
                if existing_pz:
                    return Response(
                        {
                            "error": (
                                f"Dla tej faktury KSeF istnieje już dokument PZ "
                                f"({existing_pz.document_number}). "
                                "Anuluj poprzedni PZ przed utworzeniem nowego."
                            )
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

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
                document_type=DeliveryDocument.DOC_TYPE_PZ,
                issue_date=issue_date,
                to_warehouse=to_warehouse,
                from_supplier=from_supplier,
                notes=notes or "",
                status=DeliveryDocument.STATUS_DRAFT,
                ksef_invoice=ksef_invoice,
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
                unit_cost = None
                if row.get("unit_cost") is not None:
                    try:
                        unit_cost = Decimal(str(row["unit_cost"]))
                    except Exception:
                        pass
                ksef_line_pos = row.get("ksef_line_position")
                if ksef_line_pos is not None:
                    try:
                        ksef_line_pos = int(ksef_line_pos)
                    except (TypeError, ValueError):
                        ksef_line_pos = None
                expiry_date = None
                if row.get("expiry_date") is not None:
                    from django.utils.dateparse import parse_date as _parse_date
                    expiry_date = _parse_date(str(row["expiry_date"]))
                DeliveryItem.objects.create(
                    delivery_document=doc,
                    product=product,
                    quantity_planned=qty,
                    unit_cost=unit_cost,
                    ksef_invoice_line_position=ksef_line_pos,
                    expiry_date=expiry_date,
                )

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="create-rw")
    def create_rw(self, request):
        """POST /delivery/create-rw/ — create and immediately post a manual RW (write-off).

        Body:
          {
            "from_warehouse_id": "<uuid>",   # required — source warehouse
            "reason": "Strata",              # required — Strata|Próbka|Uszkodzenie|Inne
            "issue_date": "2026-06-16",      # optional, defaults to today
            "notes": "...",                  # optional
            "items": [
              {"product_id": "<uuid>", "quantity": "1.000"},
              ...
            ]
          }
        """
        from apps.products.models import Product as ProductModel

        company_id = request.user.current_company_id

        from_warehouse_id = request.data.get("from_warehouse_id")
        reason = (request.data.get("reason") or "").strip()
        issue_date_raw = request.data.get("issue_date")
        notes = request.data.get("notes", "")
        items_data = request.data.get("items", [])

        if not from_warehouse_id:
            return Response(
                {"error": "from_warehouse_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not reason:
            return Response(
                {"error": "reason is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not items_data:
            return Response(
                {"error": "At least one item is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from_warehouse = Warehouse.objects.get(pk=from_warehouse_id, company_id=company_id)
        except Warehouse.DoesNotExist:
            return Response({"error": "Warehouse not found."}, status=status.HTTP_400_BAD_REQUEST)

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
                document_type=DeliveryDocument.DOC_TYPE_RW,
                issue_date=issue_date,
                from_warehouse=from_warehouse,
                notes=f"[{reason}]{' — ' + notes if notes else ''}",
                status=DeliveryDocument.STATUS_DELIVERED,
            )

            for row in items_data:
                pid = str(row.get("product_id", ""))
                product = products_by_id.get(pid)
                if not product:
                    continue
                try:
                    qty = Decimal(str(row.get("quantity", "0")))
                except Exception:
                    qty = Decimal("0")
                if qty <= 0:
                    continue

                DeliveryItem.objects.create(
                    delivery_document=doc,
                    product=product,
                    quantity_planned=qty,
                    quantity_actual=qty,
                )

                # Deduct from stock (allow going negative — operator's responsibility)
                stock, _ = ProductStock.objects.select_for_update().get_or_create(
                    company_id=company_id,
                    product_id=product.id,
                    warehouse_id=from_warehouse.id,
                    defaults={
                        "quantity_available": Decimal("0"),
                        "quantity_reserved": Decimal("0"),
                    },
                )
                qty_before = stock.quantity_available
                stock.quantity_available -= qty
                stock.save(update_fields=["quantity_available"])

                _deduct_fifo_batches(company_id, product.id, from_warehouse.id, qty)

                StockMovement.objects.create(
                    company_id=company_id,
                    product_id=product.id,
                    warehouse_id=from_warehouse.id,
                    user=request.user,
                    movement_type=StockMovement.MovementType.DAMAGE,
                    quantity=-qty,
                    quantity_before=qty_before,
                    quantity_after=stock.quantity_available,
                    reference_type="rw_manual",
                    reference_id=doc.id,
                    notes=f"RW — {reason}",
                    created_by=request.user,
                )

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        """in_transit → delivered (WZ/MM); draft/saved/in_transit → delivered (PZ).

        For PZ documents: applies stock receipt via apply_pz_receipt().
        For WZ/MM: applies actual quantities, returns, and syncs order lines.
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

        # ── PZ branch ──────────────────────────────────────────────────────────
        if doc.document_type == DeliveryDocument.DOC_TYPE_PZ:
            _PZ_ALLOWED = (
                DeliveryDocument.STATUS_DRAFT,
                DeliveryDocument.STATUS_SAVED,
                DeliveryDocument.STATUS_IN_TRANSIT,
            )
            if doc.status not in _PZ_ALLOWED:
                return Response(
                    {"error": "PZ document is already delivered or cancelled."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Optional: caller may supply quantity_actual (and notes) per item
            ser = DeliveryCompleteSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            rows = ser.validated_data.get("items") or []
            payload_by_id = {str(row["id"]): row for row in rows}

            with transaction.atomic():
                doc = (
                    DeliveryDocument.objects.select_for_update()
                    .select_related("to_warehouse", "from_supplier", "company")
                    .prefetch_related("items__product")
                    .get(pk=doc.pk)
                )
                if doc.status not in _PZ_ALLOWED:
                    return Response(
                        {"error": "PZ document is already delivered or cancelled."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                for item in doc.items.all():
                    row = payload_by_id.get(str(item.id))
                    if not row:
                        continue
                    changed = []
                    actual = row.get("quantity_actual")
                    if actual is not None:
                        item.quantity_actual = actual
                        changed.append("quantity_actual")
                    item_notes = row.get("notes")
                    if item_notes is not None:
                        item.notes = item_notes
                        changed.append("notes")
                    if changed:
                        item.save(update_fields=changed)

                doc.status = DeliveryDocument.STATUS_DELIVERED
                doc.delivered_at = timezone.now()
                doc.user = request.user
                doc.save(update_fields=["status", "delivered_at", "user", "updated_at"])

                apply_pz_receipt(doc, request.user)

            doc.refresh_from_db()
            return Response(self.get_serializer(doc).data)
        # ── end PZ branch ──────────────────────────────────────────────────────

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
                net = actual - ret
                if oi is not None:
                    oi.refresh_from_db()
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

                if oi is not None:
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

                # Mobile warehouses (vans) have no reservation — stock was moved
                # in full by the MM loading document. Deduct quantity_available directly.
                # Standalone WZ (no linked order) from a main warehouse also uses
                # quantity_available — production PW and manual stock adjustments land
                # there; reservation only exists when an order was confirmed first.
                from_wh = doc.from_warehouse
                is_mobile = (
                    from_wh is not None
                    and from_wh.warehouse_type == Warehouse.WarehouseType.MOBILE
                )
                is_standalone = doc.order_id is None
                use_available = is_mobile or is_standalone

                shortfalls = []
                for pid, need in sorted(sale_by_product.items(), key=lambda x: str(x[0])):
                    st = stocks[pid]
                    available = st.quantity_available if use_available else st.quantity_reserved
                    field_label = "quantity_available" if use_available else "quantity_reserved"
                    if available < need:
                        line = next(i for i, _, _ in line_ops if i.product_id == pid)
                        shortfalls.append(
                            {
                                "product_id": str(pid),
                                "product_name": line.product.name,
                                field_label: str(available),
                                "quantity_to_consume": str(need),
                                "short_by": str(need - available),
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
                    if use_available:
                        stock.quantity_available -= actual
                        stock.save(update_fields=["quantity_available"])
                    else:
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
                    # Decrement FIFO batches on the source warehouse so that
                    # expiry-alert reports don't count stock already shipped.
                    # Skip for mobile (van) warehouses — batches live on MG,
                    # not on the van; they were not moved during MM loading.
                    if not is_mobile:
                        _deduct_fifo_batches(
                            company_id=doc.company_id,
                            product_id=item.product_id,
                            warehouse_id=doc.from_warehouse_id,
                            quantity=actual,
                        )

                # ── Release orphaned main-warehouse reservation (mobile WZ only) ──
                # When an order is confirmed, stock is reserved on the MAIN warehouse.
                # The MM loading physically moves stock to the van but leaves the reservation
                # intact (it deducts from available first). Now that the van has delivered,
                # release those reservations so they don't inflate quantity_total on main.
                if is_mobile and doc.order_id:
                    main_wh_for_release = (
                        Warehouse.objects.filter(
                            company_id=doc.company_id,
                            warehouse_type=Warehouse.WarehouseType.MAIN,
                            is_active=True,
                        )
                        .order_by("code")
                        .first()
                    )
                    if main_wh_for_release is not None:
                        main_release_stocks = {}
                        for pid in sale_by_product:
                            try:
                                main_st = ProductStock.objects.select_for_update().get(
                                    company_id=doc.company_id,
                                    product_id=pid,
                                    warehouse_id=main_wh_for_release.id,
                                )
                                if main_st.quantity_reserved > 0:
                                    main_release_stocks[pid] = main_st
                            except ProductStock.DoesNotExist:
                                pass

                        for item, actual, _ret in line_ops:
                            if actual <= 0:
                                continue
                            main_st = main_release_stocks.get(item.product_id)
                            if main_st is None:
                                continue
                            release = min(main_st.quantity_reserved, actual)
                            if release <= 0:
                                continue
                            qty_res_before = main_st.quantity_reserved
                            main_st.quantity_reserved -= release
                            # Stock is gone (delivered from van) — do NOT add to available.
                            main_st.save(update_fields=["quantity_reserved"])
                            StockMovement.objects.create(
                                company_id=doc.company_id,
                                product_id=item.product_id,
                                warehouse_id=main_wh_for_release.id,
                                user=movement_user,
                                movement_type=StockMovement.MovementType.SALE,
                                quantity=-release,
                                quantity_before=qty_res_before,
                                quantity_after=main_st.quantity_reserved,
                                reference_type="delivery",
                                reference_id=doc.id,
                                notes="Zwolnienie rezerwacji MG po wydaniu z vana",
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
                if lines and order.status not in (
                    Order.STATUS_DELIVERED,
                    Order.STATUS_INVOICED,
                    Order.STATUS_CANCELLED,
                ):
                    total_qty = sum(oi.quantity for oi in lines)
                    delivered_qty = sum(oi.quantity_delivered or Decimal("0") for oi in lines)
                    if delivered_qty >= total_qty:
                        order.update_status(Order.STATUS_DELIVERED)
                    elif delivered_qty > 0:
                        order.update_status(Order.STATUS_PARTIALLY_DELIVERED)

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

    @action(detail=True, methods=["post"], url_path="cancel-pz")
    def cancel_pz_action(self, request, pk=None):
        """POST /{id}/cancel-pz/ — cancel a PZ document and reverse its stock impact.

        Only PZ documents can be cancelled this way.
        - If status is 'delivered': reverses quantity_remaining of each FIFO batch
          (units already consumed by WZ/MM are not double-reversed), deletes batches,
          records reversal StockMovement(ADJUSTMENT) per line.
        - If status is 'draft' or 'saved': no stock was ever applied; just marks cancelled.
        - Status 'cancelled': returns 400.

        Returns the updated DeliveryDocument.
        """
        doc = self.get_object()

        if doc.document_type != DeliveryDocument.DOC_TYPE_PZ:
            return Response(
                {"error": "Anulowanie dotyczy tylko dokumentów PZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if doc.status == DeliveryDocument.STATUS_CANCELLED:
            return Response(
                {"error": "Dokument jest już anulowany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            cancel_pz(doc, request.user)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        doc.refresh_from_db()
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"], url_path="create-kor")
    def create_kor_action(self, request, pk=None):
        """POST /{id}/create-kor/ — create a PZ-KOR correction for a delivered PZ.

        Body: { items: [{ delivery_item_id, new_unit_cost?, new_quantity_actual? }], notes? }

        - Updates StockBatch.unit_cost for price corrections.
        - Adjusts ProductStock.quantity_available and StockBatch for quantity corrections.
        - Creates a new PZ-KOR document (immediately delivered) with one item per changed line.

        Returns the created PZ-KOR DeliveryDocument.
        """
        doc = self.get_object()

        if doc.document_type != DeliveryDocument.DOC_TYPE_PZ:
            return Response(
                {"error": "Korekta dotyczy tylko dokumentów PZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if doc.status != DeliveryDocument.STATUS_DELIVERED:
            return Response(
                {"error": "Korektę można utworzyć tylko dla zaksięgowanego PZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = PzKorSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        items = [
            {
                "delivery_item_id": str(it["delivery_item_id"]),
                "new_unit_cost": it.get("new_unit_cost"),
                "new_quantity_actual": it.get("new_quantity_actual"),
            }
            for it in ser.validated_data["items"]
        ]

        try:
            kor_doc = create_pz_kor(doc, items, request.user)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(self.get_serializer(kor_doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="create-wz-correction")
    def create_wz_correction_action(self, request, pk=None):
        """
        POST /api/delivery/{id}/create-wz-correction/
        Create a WZ-KOR (correction) for a delivered WZ document.

        Body:
          {
            "correction_reason": "Zwrot towaru",
            "issue_date": "2026-06-23",          // optional
            "items": [
              {
                "delivery_item_id": "<uuid>",
                "quantity_returned": "2.000",
                "return_reason": "Uszkodzone opakowanie"  // optional
              }
            ]
          }
        Returns the created WZ-KOR document.
        """
        doc = self.get_object()

        if doc.document_type != DeliveryDocument.DOC_TYPE_WZ:
            return Response(
                {"error": "Korekta dotyczy tylko dokumentów WZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if doc.status != DeliveryDocument.STATUS_DELIVERED:
            return Response(
                {"error": "Korektę można utworzyć tylko dla zatwierdzonego WZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = WzKorSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        items = [
            {
                "delivery_item_id": str(it["delivery_item_id"]),
                "quantity_returned": it["quantity_returned"],
                "return_reason": it.get("return_reason", ""),
            }
            for it in ser.validated_data["items"]
        ]

        try:
            wz_kor = create_wz_correction(
                original_wz=doc,
                correction_items=items,
                user=request.user,
                correction_reason=ser.validated_data.get("correction_reason", ""),
                issue_date=ser.validated_data.get("issue_date"),
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(self.get_serializer(wz_kor).data, status=status.HTTP_201_CREATED)

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
        """End-of-route van count: compare physical stock to book and write movements.

        Optional query param: route_id — if provided, resolves the VanRoute to get the
        main warehouse for MM-P creation, and closes the route after reconciliation.
        """
        from apps.van_routes.models import VanRoute
        from apps.van_routes.services import close_route

        ser = VanReconciliationSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        company_id = request.user.current_company_id
        van_wh = get_object_or_404(
            Warehouse.objects.filter(company_id=company_id),
            pk=van_warehouse_id,
        )

        # Resolve optional route
        route = None
        main_wh = None
        route_id = request.query_params.get("route_id")
        if route_id:
            route = get_object_or_404(
                VanRoute.objects.filter(company_id=company_id).select_related("main_warehouse"),
                pk=route_id,
            )
            main_wh = route.main_warehouse

        rows = ser.validated_data.get("items") or []
        items = [
            {
                "product_id": row["product_id"],
                "quantity_actual_remaining": row["quantity_actual_remaining"],
                "quantity_writeoff": row.get("quantity_writeoff", Decimal("0")),
            }
            for row in rows
        ]
        summary = apply_van_reconciliation(
            company_id=company_id,
            user=request.user,
            van_warehouse=van_wh,
            items=items,
            main_warehouse=main_wh,
            route=route,
        )

        # Save reconciliation summary to route, then close it
        if route:
            route.reconciliation_summary = {
                "reconciled_at": summary["reconciled_at"],
                "mm_return_number": summary.get("mm_return_number"),
                "rw_writeoff_number": summary.get("rw_writeoff_number"),
                "items": summary.get("summary_items", []),
            }
            route.save(update_fields=["reconciliation_summary", "updated_at"])
            if route.status != VanRoute.STATUS_CLOSED:
                close_route(route)

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
        van_route=None,
    ) -> DeliveryDocument:
        company_id = request.user.current_company_id
        from_warehouse = default_from_warehouse_for_delivery(company_id)
        if van_route is not None:
            from_warehouse = van_route.van_warehouse
        doc = DeliveryDocument.objects.create(
            company=order.company,
            order=order,
            user=request.user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=timezone.localdate(),
            to_customer=order.customer,
            from_warehouse=from_warehouse,
            van_route=van_route,
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
        """Create a draft WZ from a confirmed order (remaining quantities per line).

        Optional query params:
          ``van_warehouse_id`` — pin from_warehouse to a specific van.
          ``van_route_id`` — link WZ to a van route (order must be on that route).
        """
        from apps.van_routes.services import get_van_route_for_document, validate_wz_van_route_link

        company_id = request.user.current_company_id
        order = get_object_or_404(
            Order.objects.filter(company_id=company_id),
            pk=order_id,
        )
        if order.status not in (Order.STATUS_CONFIRMED, Order.STATUS_PARTIALLY_DELIVERED):
            return Response(
                {"error": "Order must be confirmed or partially delivered to generate a delivery document."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lines = self._wz_planned_lines(order)
        if not lines:
            return Response(
                {"error": "No remaining quantity to deliver for this order."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve from_warehouse — allow caller to pin a specific van.
        from_warehouse = default_from_warehouse_for_delivery(company_id)
        van_warehouse_id = request.query_params.get("van_warehouse_id")
        if van_warehouse_id:
            try:
                override_wh = Warehouse.objects.get(pk=van_warehouse_id, company_id=company_id)
                if override_wh.warehouse_type == Warehouse.WarehouseType.MOBILE and override_wh.is_active:
                    from_warehouse = override_wh
            except Warehouse.DoesNotExist:
                pass

        # Resolve issue_date: caller > order delivery_date > today
        issue_date = order.delivery_date or timezone.localdate()
        issue_date_raw = request.query_params.get("issue_date")
        if issue_date_raw:
            from django.utils.dateparse import parse_date
            parsed = parse_date(str(issue_date_raw))
            if parsed:
                issue_date = parsed

        van_route_id = request.query_params.get("van_route_id")
        van_route = get_van_route_for_document(company_id, van_route_id)
        if van_route:
            if not van_warehouse_id:
                from_warehouse = van_route.van_warehouse
            validate_wz_van_route_link(
                van_route,
                order=order,
                issue_date=issue_date,
                from_warehouse=from_warehouse,
            )
        elif not van_route_id:
            # Auto-detect: if the order is on exactly one active route, link the WZ to it.
            from apps.van_routes.models import VanRoute
            active_routes = list(
                order.van_routes.filter(status__in=VanRoute.ACTIVE_STATUSES)
                .select_related("van_warehouse")
            )
            if len(active_routes) == 1:
                van_route = active_routes[0]
                if not van_warehouse_id:
                    from_warehouse = van_route.van_warehouse

        with transaction.atomic():
            doc = DeliveryDocument.objects.create(
                company=order.company,
                order=order,
                user=request.user,
                document_type=DeliveryDocument.DOC_TYPE_WZ,
                issue_date=issue_date,
                to_customer=order.customer,
                from_warehouse=from_warehouse,
                van_route=van_route,
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

        # Pre-fetch active van routes for all orders in one query.
        from apps.van_routes.models import VanRoute
        route_by_order: dict[str, object] = {}
        for order in orders:
            active = list(
                order.van_routes.filter(status__in=VanRoute.ACTIVE_STATUSES)
                .select_related("van_warehouse")
            )
            if len(active) == 1:
                route_by_order[str(order.id)] = active[0]

        created: list[DeliveryDocument] = []
        with transaction.atomic():
            for oid in id_list:
                order = by_id[oid]
                doc = self._persist_wz_draft_from_order(
                    request,
                    order,
                    line_sets[oid],
                    van_route=route_by_order.get(str(order.id)),
                )
                created.append(doc)

        serializer = self.get_serializer(created, many=True)
        return Response(
            {"documents": serializer.data},
            status=status.HTTP_201_CREATED,
        )

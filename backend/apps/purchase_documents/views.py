import os

import django_filters
from django_filters.rest_framework import DjangoFilterBackend
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from django.http import FileResponse
from django.utils import timezone
from rest_framework import filters, pagination, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permissions import HasCompanyPermission, IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .models import InvoiceItemPzLink, PurchaseDocument, PurchaseDocumentItem, PurchaseDocumentPzLink
from .serializers import PurchaseDocumentSerializer

# ─── 3-way matching helpers ────────────────────────────────────────────────────

import re

FUZZY_THRESHOLD = 0.45


def _normalize_name(name: str) -> str:
    """Lowercase, strip quantity+unit patterns and standalone numbers."""
    name = name.lower().strip()
    name = re.sub(r'\b\d+[.,]?\d*\s*(kg|g|l|ml|szt|op|pcs|litr|liter|sztuk)\b', '', name)
    name = re.sub(r'\b\d+[.,]?\d*\b', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def _fuzzy_score(a: str, b: str) -> float:
    """Jaccard similarity on tokens of normalized names. Returns 0.0–1.0."""
    ta = set(_normalize_name(a).split())
    tb = set(_normalize_name(b).split())
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    union = ta | tb
    score = len(inter) / len(union)
    # Boost if the shorter token set is fully contained in the longer
    shorter, longer = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if shorter and shorter.issubset(longer):
        score = min(1.0, score + 0.15)
    return round(score, 4)


def _build_proposals(invoice_items, delivery_items):
    """
    Greedy best-match: pair each invoice item with the best-scoring delivery item.
    Returns (proposals, unmatched_invoice, unmatched_delivery).
    proposal tuple: (inv_item, del_item, quantity_matched, match_type, confidence)
    """
    from decimal import Decimal

    used_del_ids = set()
    proposals = []
    unmatched_inv = []

    for inv in invoice_items:
        qty_left = inv._qty_unmatched
        if qty_left <= 0:
            continue

        best_del = None
        best_score = 0.0
        best_type = "fuzzy"

        for del_item in delivery_items:
            if del_item.id in used_del_ids:
                continue
            if del_item._qty_available <= 0:
                continue

            if inv.product_id and inv.product_id == del_item.product_id:
                score = 1.0
                match_type = "exact"
            elif not inv.product_id:
                score = _fuzzy_score(inv.product_name, del_item.product.name)
                match_type = "fuzzy"
            else:
                # inv has a product FK but doesn't match this delivery item → skip
                continue

            if score > best_score and score >= FUZZY_THRESHOLD:
                best_score = score
                best_del = del_item
                best_type = match_type

        if best_del:
            qty = min(qty_left, best_del._qty_available)
            proposals.append((inv, best_del, qty, best_type, best_score))
            used_del_ids.add(best_del.id)
        else:
            unmatched_inv.append(inv)

    unmatched_del = [d for d in delivery_items if d.id not in used_del_ids]
    return proposals, unmatched_inv, unmatched_del


class PurchaseDocumentFilter(django_filters.FilterSet):
    issue_date__gte = django_filters.DateFilter(field_name="issue_date", lookup_expr="gte")
    issue_date__lte = django_filters.DateFilter(field_name="issue_date", lookup_expr="lte")

    class Meta:
        model = PurchaseDocument
        fields = ["doc_type", "status", "payment_method"]


class PurchaseDocPagination(pagination.PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200


class PurchaseDocumentViewSet(viewsets.ModelViewSet):
    """CRUD for purchase documents (FZ, PAR, PAR_VAT) registered outside KSeF."""

    lookup_field = "uuid"
    serializer_class = PurchaseDocumentSerializer
    required_permission = "can_manage_invoices"
    read_permission = None
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
    pagination_class = PurchaseDocPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter, filters.SearchFilter]
    filterset_class = PurchaseDocumentFilter
    search_fields = ["document_number", "supplier_name", "supplier_nip"]
    ordering_fields = ["issue_date", "due_date", "total_gross", "created_at"]
    ordering = ["-issue_date", "-created_at"]

    def get_queryset(self):
        qs = (
            PurchaseDocument.objects.all()
            .select_related("company", "created_by", "supplier")
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=PurchaseDocumentItem.objects.prefetch_related(
                        Prefetch(
                            "pz_line_links",
                            queryset=InvoiceItemPzLink.objects.select_related(
                                "delivery_item__delivery_document"
                            ),
                        )
                    ).select_related("product"),
                ),
                Prefetch(
                    "pz_links",
                    queryset=PurchaseDocumentPzLink.objects.select_related(
                        "delivery_document"
                    ),
                ),
            )
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def perform_create(self, serializer):
        from apps.users.tenant import get_request_company

        company = get_request_company(self.request.user)
        serializer.save(company=company, created_by=self.request.user)

    def perform_update(self, serializer):
        """Auto-set paid_at when is_paid changes to True."""
        instance = self.get_object()
        was_paid = instance.is_paid
        obj = serializer.save()
        if obj.is_paid and not was_paid:
            obj.paid_at = timezone.now()
            obj.save(update_fields=["paid_at"])
        elif not obj.is_paid and was_paid:
            obj.paid_at = None
            obj.save(update_fields=["paid_at"])

    # ------------------------------------------------------------------
    # Helper: get a fresh serialized instance (with correct prefetches)
    # ------------------------------------------------------------------

    def _serialized_instance(self, instance):
        """Re-fetch the instance with all required prefetches before serializing."""
        fresh = (
            PurchaseDocument.objects.filter(pk=instance.pk)
            .select_related("company", "created_by", "supplier")
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=PurchaseDocumentItem.objects.prefetch_related(
                        Prefetch(
                            "pz_line_links",
                            queryset=InvoiceItemPzLink.objects.select_related(
                                "delivery_item__delivery_document"
                            ),
                        )
                    ).select_related("product"),
                ),
                Prefetch(
                    "pz_links",
                    queryset=PurchaseDocumentPzLink.objects.select_related("delivery_document"),
                ),
            )
            .get()
        )
        return PurchaseDocumentSerializer(fresh, context=self.get_serializer_context()).data

    # ------------------------------------------------------------------
    # Standard actions
    # ------------------------------------------------------------------

    @action(detail=True, methods=["patch"], url_path="mark-paid")
    def mark_paid(self, request, uuid=None):
        """PATCH /purchase-documents/{uuid}/mark-paid/ — toggle is_paid."""
        instance = self.get_object()
        is_paid = request.data.get("is_paid")
        if is_paid is None:
            return Response({"detail": "Pole is_paid jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)
        instance.is_paid = bool(is_paid)
        instance.paid_at = timezone.now() if instance.is_paid else None
        instance.save(update_fields=["is_paid", "paid_at"])
        return Response(self._serialized_instance(instance))

    @action(detail=True, methods=["patch"], url_path="set-line-categories")
    def set_line_categories(self, request, uuid=None):
        """PATCH /purchase-documents/{uuid}/set-line-categories/ — persist per-line cost categories."""
        doc = self.get_object()
        cats = request.data.get("line_categories", {})
        doc.line_categories = cats
        doc.save(update_fields=["line_categories"])
        return Response({"line_categories": doc.line_categories})

    @action(detail=True, methods=["patch"], url_path="set-category")
    def set_category(self, request, uuid=None):
        """PATCH /purchase-documents/{uuid}/set-category/ — set opex_category."""
        instance = self.get_object()
        instance.opex_category = request.data.get("opex_category") or None
        instance.save(update_fields=["opex_category"])
        return Response(self._serialized_instance(instance))

    # ------------------------------------------------------------------
    # PZ linking actions (M:M)
    # ------------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="create-pz")
    def create_pz(self, request, uuid=None):
        """
        POST /purchase-documents/{uuid}/create-pz/

        Creates a draft PZ from this purchase document and links it via M:M.
        Multiple PZ can be created per document (e.g. partial deliveries).
        """
        from decimal import Decimal

        from apps.delivery.models import DeliveryDocument, DeliveryItem
        from apps.products.models import Warehouse

        instance = self.get_object()

        warehouse_id = request.data.get("to_warehouse_id")
        if not warehouse_id:
            return Response(
                {"detail": "Pole to_warehouse_id jest wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            warehouse = Warehouse.objects.get(uuid=warehouse_id, company=instance.company)
        except Warehouse.DoesNotExist:
            return Response({"detail": "Magazyn nie istnieje."}, status=status.HTTP_400_BAD_REQUEST)

        pz = DeliveryDocument.objects.create(
            company=instance.company,
            document_type="PZ",
            status="draft",
            issue_date=instance.issue_date,
            external_document_number=instance.document_number,
            from_supplier=instance.supplier,
            to_warehouse=warehouse,
            user=request.user,
        )

        for item in instance.items.select_related("product").all():
            if not item.product_id:
                continue
            vat_factor = Decimal("1") + (item.vat_rate / Decimal("100"))
            unit_cost_net = (item.unit_price_gross / vat_factor).quantize(Decimal("0.0001"))
            DeliveryItem.objects.create(
                delivery_document=pz,
                product=item.product,
                quantity_planned=item.quantity,
                unit_cost=unit_cost_net,
            )

        # Link via M:M (savepoint guards against race-condition edge case)
        try:
            with transaction.atomic():
                PurchaseDocumentPzLink.objects.create(
                    purchase_document=instance,
                    delivery_document=pz,
                )
        except IntegrityError:
            pass  # Already linked — shouldn't happen for a brand-new PZ, but safe

        instance.status = PurchaseDocument.STATUS_MATCHED
        instance.save(update_fields=["status"])

        return Response(self._serialized_instance(instance), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="link-pz")
    def link_pz(self, request, uuid=None):
        """
        POST /purchase-documents/{uuid}/link-pz/

        Links an existing PZ to this document (M:M — multiple PZ allowed).
        Idempotent: linking the same PZ twice returns 200 with no change.
        """
        from apps.delivery.models import DeliveryDocument

        instance = self.get_object()
        pz_id = request.data.get("pz_id")
        if not pz_id:
            return Response({"detail": "Pole pz_id jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pz = DeliveryDocument.objects.get(
                uuid=pz_id,
                company=instance.company,
                document_type="PZ",
            )
        except DeliveryDocument.DoesNotExist:
            return Response({"detail": "PZ nie istnieje."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                PurchaseDocumentPzLink.objects.create(
                    purchase_document=instance,
                    delivery_document=pz,
                )
        except IntegrityError:
            pass  # Already linked — idempotent, return success

        instance.status = PurchaseDocument.STATUS_MATCHED
        instance.save(update_fields=["status"])

        return Response(self._serialized_instance(instance))

    @action(detail=True, methods=["post"], url_path="unlink-pz")
    def unlink_pz(self, request, uuid=None):
        """
        POST /purchase-documents/{uuid}/unlink-pz/

        Removes the link between this document and a PZ.
        If no PZ links remain, sets status back to 'registered'.
        """
        instance = self.get_object()
        pz_id = request.data.get("pz_id")
        if not pz_id:
            return Response({"detail": "Pole pz_id jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)

        deleted, _ = PurchaseDocumentPzLink.objects.filter(
            purchase_document=instance,
            delivery_document__uuid=pz_id,
        ).delete()

        if not deleted:
            return Response(
                {"detail": "Link nie istnieje."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # If no PZ links remain, revert status to registered
        # Use a fresh DB query to avoid stale prefetch cache after delete
        if not PurchaseDocumentPzLink.objects.filter(purchase_document=instance).exists():
            instance.status = PurchaseDocument.STATUS_REGISTERED
            instance.save(update_fields=["status"])

        return Response(self._serialized_instance(instance))

    # ------------------------------------------------------------------
    # 3-way matching actions
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="match-proposals")
    def match_proposals(self, request, uuid=None):
        """
        GET /purchase-documents/{uuid}/match-proposals/?pz_id=<uuid>

        Returns auto-proposed line matches between this invoice and the given PZ.
        READ-ONLY — does not save anything.
        """
        from decimal import Decimal
        from apps.delivery.models import DeliveryDocument

        instance = self.get_object()
        pz_uuid = request.query_params.get("pz_id")
        if not pz_uuid:
            return Response({"detail": "Parametr pz_id jest wymagany."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pz = DeliveryDocument.objects.get(uuid=pz_uuid, company=instance.company, document_type="PZ")
        except DeliveryDocument.DoesNotExist:
            return Response({"detail": "PZ nie istnieje."}, status=status.HTTP_404_NOT_FOUND)

        # Fetch items directly (not via instance.items) to avoid conflict with
        # pz_line_links prefetch already set on get_queryset()
        invoice_items = list(
            PurchaseDocumentItem.objects
            .filter(document=instance)
            .select_related("product")
            .prefetch_related(
                Prefetch("pz_line_links", queryset=InvoiceItemPzLink.objects.all())
            )
        )
        delivery_items = list(
            pz.items
            .select_related("product")
            .prefetch_related(
                Prefetch("invoice_line_links", queryset=InvoiceItemPzLink.objects.all())
            )
        )

        for inv in invoice_items:
            already = sum(lnk.quantity_matched for lnk in inv.pz_line_links.all())
            inv._qty_already_matched = already
            inv._qty_unmatched = max(Decimal("0"), inv.quantity - already)

        for del_item in delivery_items:
            already = sum(lnk.quantity_matched for lnk in del_item.invoice_line_links.all())
            del_item._qty_already_matched = already
            del_item._qty_available = max(Decimal("0"), del_item.quantity_planned - already)

        proposals, unmatched_inv, unmatched_del = _build_proposals(invoice_items, delivery_items)

        def _inv_dict(item):
            return {
                "id": str(item.uuid),
                "product_name": item.product.name if item.product_id else item.product_name,
                "product_id": str(item.product.uuid) if item.product_id else None,
                "quantity": str(item.quantity),
                "quantity_already_matched": str(item._qty_already_matched),
                "quantity_unmatched": str(item._qty_unmatched),
                "unit": item.unit,
                "unit_price_gross": str(item.unit_price_gross),
            }

        def _del_dict(item):
            return {
                "id": str(item.uuid),
                "product_name": item.product.name,
                "product_id": str(item.product.uuid),
                "quantity_planned": str(item.quantity_planned),
                "quantity_already_matched": str(item._qty_already_matched),
                "quantity_available": str(item._qty_available),
                "unit_cost": str(item.unit_cost) if item.unit_cost else None,
            }

        return Response({
            "invoice_id": str(instance.uuid),
            "pz_id": str(pz.uuid),
            "proposals": [
                {
                    "invoice_item": _inv_dict(inv),
                    "delivery_item": _del_dict(del_i),
                    "quantity_matched": str(qty),
                    "match_type": mtype,
                    "confidence": conf,
                }
                for inv, del_i, qty, mtype, conf in proposals
            ],
            "unmatched_invoice_items": [_inv_dict(i) for i in unmatched_inv],
            "unmatched_delivery_items": [_del_dict(d) for d in unmatched_del],
        })

    @action(detail=True, methods=["post"], url_path="confirm-line-matches")
    def confirm_line_matches(self, request, uuid=None):
        """
        POST /purchase-documents/{uuid}/confirm-line-matches/

        Body: {
            "pz_id": "<uuid>",
            "matches": [
                {"invoice_item_id": "<uuid>", "delivery_item_id": "<uuid>", "quantity_matched": "5.0000"}
            ]
        }

        Upserts InvoiceItemPzLink records. Idempotent (update_or_create).
        Auto-creates the parent PurchaseDocumentPzLink if missing.
        """
        from decimal import Decimal, InvalidOperation
        from apps.delivery.models import DeliveryDocument, DeliveryItem

        instance = self.get_object()
        pz_uuid = request.data.get("pz_id")
        matches = request.data.get("matches", [])

        if not pz_uuid:
            return Response({"detail": "Pole pz_id jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(matches, list) or len(matches) == 0:
            return Response({"detail": "Pole matches musi być niepustą listą."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pz = DeliveryDocument.objects.get(uuid=pz_uuid, company=instance.company, document_type="PZ")
        except DeliveryDocument.DoesNotExist:
            return Response({"detail": "PZ nie istnieje."}, status=status.HTTP_400_BAD_REQUEST)

        errors = []
        validated = []
        for i, match in enumerate(matches):
            inv_uuid = match.get("invoice_item_id")
            del_uuid = match.get("delivery_item_id")
            qty_raw = match.get("quantity_matched")

            try:
                qty = Decimal(str(qty_raw))
                if qty <= 0:
                    raise ValueError
            except (InvalidOperation, ValueError, TypeError):
                errors.append(f"matches[{i}]: quantity_matched musi być dodatnią liczbą.")
                continue

            try:
                inv_item = instance.items.get(uuid=inv_uuid)
            except (PurchaseDocumentItem.DoesNotExist, Exception):
                errors.append(f"matches[{i}]: invoice_item_id '{inv_uuid}' nie istnieje na tej fakturze.")
                continue

            try:
                del_item = pz.items.get(uuid=del_uuid)
            except (DeliveryItem.DoesNotExist, Exception):
                errors.append(f"matches[{i}]: delivery_item_id '{del_uuid}' nie istnieje na tym PZ.")
                continue

            validated.append((inv_item, del_item, qty))

        if errors:
            return Response({"detail": errors}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # Ensure parent-level link exists
            PurchaseDocumentPzLink.objects.get_or_create(
                purchase_document=instance,
                delivery_document=pz,
            )

            for inv_item, del_item, qty in validated:
                InvoiceItemPzLink.objects.update_or_create(
                    invoice_item=inv_item,
                    delivery_item=del_item,
                    defaults={"quantity_matched": qty},
                )

            instance.status = PurchaseDocument.STATUS_MATCHED
            instance.save(update_fields=["status"])

        return Response(self._serialized_instance(instance))

    # ------------------------------------------------------------------
    # File serving
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="file")
    def file_serve(self, request, uuid=None):
        """GET /purchase-documents/{uuid}/file/ — download the scanned source document."""
        instance = self.get_object()
        if not instance.ocr_raw_filename:
            return Response({"detail": "Brak pliku dla tego dokumentu."}, status=status.HTTP_404_NOT_FOUND)

        abs_path = os.path.join(settings.MEDIA_ROOT, instance.ocr_raw_filename)
        if not os.path.isfile(abs_path):
            return Response({"detail": "Plik nie istnieje na serwerze."}, status=status.HTTP_404_NOT_FOUND)

        filename = os.path.basename(abs_path)
        response = FileResponse(open(abs_path, "rb"), as_attachment=False)
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response

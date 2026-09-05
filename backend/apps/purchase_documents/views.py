import os

import django_filters
from django_filters.rest_framework import DjangoFilterBackend
from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework import filters, pagination, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permissions import HasCompanyPermission, IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .models import PurchaseDocument
from .serializers import PurchaseDocumentSerializer


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
            .select_related("company", "created_by", "supplier", "delivery_document")
            .prefetch_related("items")
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
        return Response(PurchaseDocumentSerializer(instance).data)

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
        return Response(PurchaseDocumentSerializer(instance).data)

    @action(detail=True, methods=["post"], url_path="create-pz")
    def create_pz(self, request, uuid=None):
        """POST /purchase-documents/{uuid}/create-pz/ — create a draft PZ and link it."""
        from decimal import Decimal

        from apps.delivery.models import DeliveryDocument, DeliveryItem
        from apps.products.models import Warehouse

        instance = self.get_object()

        if instance.delivery_document_id:
            return Response(
                {"detail": "Dokument ma już przypisane PZ."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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

        instance.delivery_document = pz
        instance.status = PurchaseDocument.STATUS_MATCHED
        instance.save(update_fields=["delivery_document", "status"])

        return Response(PurchaseDocumentSerializer(instance).data, status=status.HTTP_201_CREATED)

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

    @action(detail=True, methods=["post"], url_path="link-pz")
    def link_pz(self, request, uuid=None):
        """POST /purchase-documents/{uuid}/link-pz/ — link an existing PZ."""
        from apps.delivery.models import DeliveryDocument

        instance = self.get_object()
        pz_id = request.data.get("pz_id")
        if not pz_id:
            return Response({"detail": "Pole pz_id jest wymagane."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pz = DeliveryDocument.objects.get(uuid=pz_id, company=instance.company, document_type="PZ")
        except DeliveryDocument.DoesNotExist:
            return Response({"detail": "PZ nie istnieje."}, status=status.HTTP_400_BAD_REQUEST)

        instance.delivery_document = pz
        instance.status = PurchaseDocument.STATUS_MATCHED
        instance.save(update_fields=["delivery_document", "status"])

        return Response(PurchaseDocumentSerializer(instance).data)

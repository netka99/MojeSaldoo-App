from datetime import datetime

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.delivery.models import DeliveryDocument
from apps.orders.models import Order
from apps.users.permissions import IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .filters import InvoiceFilter
from .models import Invoice
from .serializers import InvoiceSerializer
from .services import build_invoice_preview_data, generate_invoice_from_order


def _optional_iso_date(data, key: str):
    raw = data.get(key)
    if raw in (None, ""):
        return None
    s = str(raw).strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise ValidationError({key: "Use ISO date YYYY-MM-DD."})


class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated, IsCompanyMember]
    filter_backends = [DjangoFilterBackend]
    filterset_class = InvoiceFilter

    def get_queryset(self) -> QuerySet:
        qs = (
            Invoice.objects.all()
            .select_related(
                "company",
                "customer",
                "order",
                "order__customer",
                "user",
                "delivery_document",
            )
            .prefetch_related("items", "items__product", "items__order_item")
            .order_by("-created_at")
        )
        return filter_queryset_for_current_company(qs, self.request.user)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def perform_create(self, serializer):
        order = serializer.validated_data.get("order")
        customer = serializer.validated_data.get("customer")
        if order and not customer:
            customer = order.customer
        serializer.save(
            company=self.request.user.current_company,
            user=self.request.user,
            customer=customer,
        )

    def perform_update(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        if instance.status != Invoice.STATUS_DRAFT:
            raise ValidationError({"detail": "Only draft invoices can be deleted."})
        super().perform_destroy(instance)

    @action(
        detail=False,
        methods=["post"],
        url_path=r"generate-from-order/(?P<order_id>[^/.]+)",
    )
    def generate_from_order(self, request, order_id=None):
        company = request.user.current_company
        order = get_object_or_404(Order, pk=order_id, company_id=company.id)
        doc = None
        raw_doc = request.data.get("delivery_document_id")
        if raw_doc:
            doc = get_object_or_404(
                DeliveryDocument, pk=raw_doc, company_id=company.id
            )
        issue_date = _optional_iso_date(request.data, "issue_date")
        sale_date = _optional_iso_date(request.data, "sale_date")
        due_date = _optional_iso_date(request.data, "due_date")
        pm_raw = request.data.get("payment_method")
        payment_method = None if pm_raw in (None, "") else pm_raw
        invoice = generate_invoice_from_order(
            order=order,
            company=company,
            user=request.user,
            delivery_document=doc,
            issue_date=issue_date,
            sale_date=sale_date,
            due_date=due_date,
            payment_method=payment_method,
        )
        out = InvoiceSerializer(invoice, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="issue")
    def issue(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status != Invoice.STATUS_DRAFT:
            raise ValidationError({"detail": "Only draft invoices can be issued."})
        invoice.status = Invoice.STATUS_ISSUED
        invoice.user = request.user
        invoice.save(update_fields=["status", "user", "updated_at"])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status not in (Invoice.STATUS_ISSUED, Invoice.STATUS_SENT):
            raise ValidationError(
                {"detail": "Only issued or sent invoices can be marked as paid."}
            )
        invoice.status = Invoice.STATUS_PAID
        invoice.paid_at = timezone.now()
        invoice.user = request.user
        invoice.save(
            update_fields=["status", "paid_at", "user", "updated_at"],
        )
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request, pk=None):
        invoice = self.get_object()
        return Response(build_invoice_preview_data(invoice))

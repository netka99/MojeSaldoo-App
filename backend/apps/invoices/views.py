import logging
from datetime import datetime
from decimal import Decimal

from django.db.models import QuerySet, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from django.http import HttpResponse
from rest_framework.response import Response

from apps.delivery.models import DeliveryDocument
from apps.ksef import ssapi_client
from apps.users.web_push_service import send_ksef_status_push
from apps.ksef.models import KSeFSession
from apps.ksef.xml_generator import generate_fa3_xml, generate_fa3_xml_base64
from apps.orders.models import Order
from apps.users.permissions import HasCompanyPermission, IsCompanyMember
from apps.users.tenant import filter_queryset_for_current_company

from .filters import InvoiceFilter
from .models import Invoice
from .serializers import InvoiceSerializer
from .services import build_invoice_preview_data, create_invoice_correction, generate_invoice_from_order

logger = logging.getLogger(__name__)


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
    required_permission = 'can_manage_invoices'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]
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
        from apps.users.models import get_workflow_settings

        invoice = self.get_object()
        if invoice.status != Invoice.STATUS_DRAFT:
            raise ValidationError({"detail": "Only draft invoices can be issued."})

        if invoice.order_id:
            wf = get_workflow_settings(request.user.current_company)
            if wf.wz_required_before_invoice:
                has_delivered_wz = invoice.order.delivery_documents.filter(
                    document_type="WZ",
                    status="delivered",
                ).exists()
                if not has_delivered_wz:
                    return Response(
                        {
                            "detail": (
                                f"Nie można wystawić faktury dla zamówienia "
                                f"{invoice.order.order_number}. "
                                f"Brak zatwierdzonego dokumentu WZ (wydania towaru). "
                                f"Zakończ dostawę przed wystawieniem faktury lub zmień "
                                f"ustawienie 'wz_required_before_invoice' w konfiguracji "
                                f"przepływu dokumentów."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Level 2 guard: per-line check — can't invoice more than was delivered
                # minus what's already been invoiced on other active invoices.
                from .models import InvoiceItem as _InvoiceItem
                for inv_item in invoice.items.select_related("order_item").all():
                    oi = inv_item.order_item
                    if oi is None:
                        continue
                    qty_delivered = oi.quantity_delivered or Decimal("0")
                    already_invoiced = (
                        _InvoiceItem.objects.filter(
                            order_item=oi,
                            invoice__status__in=["issued", "sent", "paid"],
                        )
                        .exclude(invoice=invoice)
                        .aggregate(total=Sum("quantity"))["total"]
                        or Decimal("0")
                    )
                    invoiceable = qty_delivered - already_invoiced
                    if inv_item.quantity > invoiceable + Decimal("0.001"):
                        return Response(
                            {
                                "detail": (
                                    f"Nie można wystawić faktury: ilość do zafakturowania "
                                    f"({inv_item.quantity} szt.) dla produktu "
                                    f"'{inv_item.product_name}' przekracza dostarczoną "
                                    f"ilość pozostałą do fakturowania ({invoiceable} szt.)."
                                )
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

        invoice.status = Invoice.STATUS_ISSUED
        invoice.user = request.user
        invoice.save(update_fields=["status", "user", "updated_at"])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        invoice = self.get_object()
        payable_statuses = (
            Invoice.STATUS_ISSUED,
            Invoice.STATUS_SENT,
            Invoice.STATUS_OVERDUE,
        )
        if invoice.status not in payable_statuses:
            raise ValidationError(
                {"detail": "Only issued, sent, or overdue invoices can be marked as paid."}
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

    @action(detail=True, methods=["get"], url_path="xml")
    def xml(self, request, pk=None):
        """Download FA-3 KSeF XML for this invoice."""
        invoice = self.get_object()
        try:
            xml_str = generate_fa3_xml(invoice)
        except Exception as exc:
            return Response(
                {"detail": f"Błąd generowania XML: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        filename = f"faktura-{invoice.invoice_number or invoice.pk}.xml".replace("/", "-")
        return HttpResponse(
            xml_str,
            content_type="application/xml; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @action(detail=True, methods=["post"], url_path="send-to-ksef")
    def send_to_ksef(self, request, pk=None):
        """
        Submit an issued invoice to KSeF via SSAPI.
        Requires active KSeF session for the company (authenticate via POST /api/ksef/session/).
        Returns updated invoice with ksef_reference_number and ksef_status='pending'.
        """
        invoice = self.get_object()

        if invoice.status != Invoice.STATUS_ISSUED:
            return Response(
                {"detail": "Tylko wystawione faktury mogą być wysłane do KSeF."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if invoice.ksef_status in ("pending", "sent", "accepted"):
            return Response(
                {"detail": f"Faktura jest już w KSeF (status: {invoice.ksef_status})."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        company = request.user.current_company

        # Validate required company/customer fields for FA-3 XML
        if not company.nip:
            return Response(
                {"detail": "Uzupełnij NIP firmy przed wysłaniem faktury do KSeF."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not invoice.customer.nip:
            return Response(
                {"detail": "Nabywca nie ma uzupełnionego NIP. Uzupełnij dane klienta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check active SSAPI session
        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            return Response(
                {"detail": "Brak sesji KSeF. Zaloguj się do KSeF przed wysłaniem faktury."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not ksef_sess.is_active():
            return Response(
                {"detail": "Sesja KSeF wygasła. Zaloguj się ponownie do KSeF."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Generate FA-3 XML and encode as Base64
        try:
            invoice_b64 = generate_fa3_xml_base64(invoice)
        except Exception as exc:
            logger.error("FA-3 XML generation failed for invoice %s: %s", invoice.pk, exc)
            return Response(
                {"detail": f"Błąd generowania XML faktury: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        total_gross_cents = int(invoice.total_gross * 100)
        shop_name = invoice.customer.company_name or invoice.customer.name

        try:
            result = ssapi_client.send_invoice(
                invoice_base64=invoice_b64,
                nip=company.nip,
                shop=shop_name,
                total_gross_cents=total_gross_cents,
                company_id=str(company.id),
            )
        except Exception as exc:
            logger.error("SSAPI send_invoice failed for invoice %s: %s", invoice.pk, exc)
            invoice.ksef_status = "rejected"
            invoice.ksef_error_message = str(exc)
            invoice.save(update_fields=["ksef_status", "ksef_error_message", "updated_at"])
            return Response(
                {"detail": f"Błąd wysyłki do SSAPI: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # ssapi wraps the KSeF response as {"outcome": {...}}
        outcome = result.get("outcome", result)
        if isinstance(outcome, dict):
            reference_number = outcome.get("referenceNumber", "")
        else:
            reference_number = result.get("referenceNumber", "")
        invoice.ksef_reference_number = reference_number
        invoice.ksef_status = "pending"
        invoice.ksef_sent_at = timezone.now()
        invoice.ksef_error_message = ""
        invoice.status = Invoice.STATUS_SENT
        invoice.save(update_fields=[
            "ksef_reference_number", "ksef_status", "ksef_sent_at",
            "ksef_error_message", "status", "updated_at",
        ])
        send_ksef_status_push(request.user, invoice_number=invoice.invoice_number or str(invoice.pk), new_status="sent")

        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["get"], url_path="ksef-status")
    def ksef_status(self, request, pk=None):
        """
        Poll SSAPI for KSeF processing status and update invoice fields.
        Returns updated invoice.
        """
        invoice = self.get_object()

        if not invoice.ksef_reference_number:
            return Response(
                {"detail": "Faktura nie ma numeru referencyjnego KSeF. Najpierw wyślij fakturę."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        company = request.user.current_company
        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            return Response(
                {"detail": "Brak sesji KSeF."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            http_code, data = ssapi_client.get_invoice_status(
                invoice.ksef_reference_number,
                str(company.id),
            )
        except Exception as exc:
            logger.error("SSAPI get_invoice_status failed for invoice %s: %s", invoice.pk, exc)
            return Response(
                {"detail": f"Błąd sprawdzania statusu w SSAPI: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # SSAPI returns 202 while KSeF is still processing
        if http_code == 202:
            return Response(
                {**self.get_serializer(invoice).data, "_ssapi_processing": True},
                status=status.HTTP_202_ACCEPTED,
            )

        # SSAPI returns 200 with status.code == 200 when accepted
        ksef_number = data.get("ksefNumber") or data.get("ksef_number", "")
        status_block = data.get("status", {})
        status_code = status_block.get("code") if status_block else None

        if http_code == 200 and status_code == 200 and ksef_number:
            invoice.ksef_number = ksef_number
            invoice.ksef_status = "accepted"
            invoice.upo_received = bool(data.get("upo"))
            invoice.invoice_hash = data.get("invoiceHash", "") or data.get("invoice_hash", "")
            invoice.save(update_fields=[
                "ksef_number", "ksef_status", "upo_received", "invoice_hash", "updated_at",
            ])
            send_ksef_status_push(request.user, invoice_number=invoice.invoice_number or str(invoice.pk), new_status="accepted")
        elif http_code == 200 and status_code and status_code >= 400:
            invoice.ksef_status = "rejected"
            invoice.ksef_error_message = status_block.get("description", "KSeF rejected the invoice.")
            invoice.save(update_fields=["ksef_status", "ksef_error_message", "updated_at"])
            send_ksef_status_push(request.user, invoice_number=invoice.invoice_number or str(invoice.pk), new_status="rejected")

        return Response({**self.get_serializer(invoice).data, "_ssapi_raw": data})

    @action(detail=True, methods=["post"], url_path="create-correction")
    def create_correction(self, request, pk=None):
        """
        POST /api/invoices/{id}/create-correction/
        Create a draft FV-KOR correction invoice for an issued or paid invoice.

        Body:
          {
            "correction_reason": "Błędna ilość",
            "issue_date": "2026-06-23",      // optional
            "due_date": "2026-07-10",         // optional — overrides default
            "payment_method": "transfer",     // optional — overrides original
            "items": [                        // optional — omit to copy original
              {"item_id": "<uuid>", "quantity": "5.00", "unit_price_net": "10.00", "vat_rate": "23"},
              {"item_id": "<uuid>", "remove": true},
              {"product_name": "Nowy produkt", "quantity": "1", "unit_price_net": "10.00", "vat_rate": "23", "product_unit": "szt"}
            ]
          }
        """
        invoice = self.get_object()
        correction_reason = request.data.get("correction_reason", "")
        items_data = request.data.get("items", [])
        issue_date = _optional_iso_date(request.data, "issue_date")
        due_date = _optional_iso_date(request.data, "due_date")
        payment_method = request.data.get("payment_method") or None

        correction = create_invoice_correction(
            original_invoice=invoice,
            company=request.user.current_company,
            user=request.user,
            correction_reason=correction_reason,
            items_data=items_data,
            issue_date=issue_date,
            due_date=due_date,
            payment_method=payment_method,
        )
        return Response(
            self.get_serializer(correction).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="upo")
    def upo(self, request, pk=None):
        """
        GET /api/invoices/{id}/upo/
        Download the UPO (Urzędowe Potwierdzenie Odbioru) XML for an accepted invoice.
        The UPO is stored on the first successful ksef-status poll and served from DB —
        no active KSeF session required.
        """
        from apps.ksef.models import KSeFSentInvoice

        invoice = self.get_object()

        if not invoice.upo_received:
            return Response(
                {"detail": "UPO nie jest jeszcze dostępne dla tej faktury."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not invoice.ksef_reference_number:
            return Response(
                {"detail": "Brak numeru referencyjnego KSeF."},
                status=status.HTTP_404_NOT_FOUND,
            )

        company = request.user.current_company
        sent_inv = KSeFSentInvoice.objects.filter(
            company=company,
            reference_number=invoice.ksef_reference_number,
        ).first()

        if not sent_inv or not sent_inv.upo_xml:
            return Response(
                {
                    "detail": (
                        "UPO nie zostało jeszcze pobrane. "
                        "Kliknij 'Odśwież status KSeF' aby pobrać UPO."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        filename = f"UPO-{invoice.ksef_number or invoice.ksef_reference_number}.xml"
        response = HttpResponse(sent_inv.upo_xml, content_type="application/xml; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

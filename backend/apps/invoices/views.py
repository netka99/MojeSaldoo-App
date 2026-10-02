import logging
from datetime import datetime
from decimal import Decimal

from django.db.models import QuerySet, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.filters import OrderingFilter
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
from apps.ksef.validators import validate_invoice_for_ksef
from apps.orders.models import Order
from apps.users.permissions import HasCompanyPermission, IsCompanyMember, ModuleRequired
from apps.users.tenant import filter_queryset_for_current_company
from apps.activity.log import log_activity, log_error, log_success
from apps.activity.format import flatten_error_value
from apps.activity.models import ActivityLog

from .filters import InvoiceFilter
from .models import Invoice
from .serializers import InvoiceSerializer
from .services import (
    build_invoice_preview_data,
    create_invoice_correction,
    create_manual_invoice,
    generate_invoice_from_order,
    generate_invoice_from_orders,
    get_period_preview_from_orders,
    get_period_preview_from_wz,
)

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
    lookup_field = "uuid"
    serializer_class = InvoiceSerializer
    module_required = "invoicing"
    required_permission = 'can_manage_invoices'
    read_permission = None  # any company member may list/read invoices
    permission_classes = [IsAuthenticated, IsCompanyMember, ModuleRequired, HasCompanyPermission]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_class = InvoiceFilter
    ordering_fields = ['issue_date', 'due_date', 'total_gross']

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
            .prefetch_related("items", "items__product", "items__order_item", "corrections", "invoice_orders")
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
        invoice = serializer.instance
        log_success(
            user=self.request.user, action="invoice.create",
            object_type="invoice",
            object_id=invoice.invoice_number or str(invoice.uuid),
        )

    def perform_update(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        if instance.status != Invoice.STATUS_DRAFT:
            raise ValidationError({"detail": "Tylko faktury w statusie 'szkic' mogą być usunięte."})
        super().perform_destroy(instance)

    def destroy(self, request, *args, **kwargs):
        invoice = self.get_object()
        if invoice.invoice_number:
            raise ValidationError({'detail': 'Nie można usunąć faktury z nadanym numerem. Użyj anulowania.'})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['patch'], url_path='set-number')
    def set_number(self, request, uuid=None):
        """Set or clear invoice_number on a draft invoice."""
        invoice = self.get_object()
        if invoice.status != Invoice.STATUS_DRAFT:
            raise ValidationError({'detail': 'Numer można zmienić tylko na szkicu.'})
        number = request.data.get('invoice_number', '').strip() or None
        if number and Invoice.objects.filter(company=invoice.company, invoice_number=number).exclude(pk=invoice.pk).exists():
            raise ValidationError({'invoice_number': f"Numer '{number}' jest już zajęty."})
        invoice.invoice_number = number
        invoice.save(update_fields=['invoice_number', 'updated_at'])
        return Response(self.get_serializer(invoice).data)

    @action(detail=False, methods=['get'], url_path='next-number')
    def next_number(self, request):
        from datetime import date as _date
        company = request.user.current_company
        issue_date_str = request.query_params.get('issue_date', '')
        is_correction = request.query_params.get('is_correction', 'false').lower() == 'true'
        try:
            issue_date = _date.fromisoformat(issue_date_str) if issue_date_str else _date.today()
        except ValueError:
            issue_date = _date.today()
        number = Invoice._next_invoice_number(company.pk, issue_date, is_correction=is_correction)
        return Response({'next_number': number})


    @action(
        detail=False,
        methods=["post"],
        url_path=r"generate-from-order/(?P<order_id>[^/.]+)",
    )
    def generate_from_order(self, request, order_id=None):
        company = request.user.current_company
        order = get_object_or_404(Order, uuid=order_id, company_id=company.id)
        doc = None
        raw_doc = request.data.get("delivery_document_id")
        if raw_doc:
            doc = get_object_or_404(
                DeliveryDocument, uuid=raw_doc, company_id=company.id
            )
        issue_date = _optional_iso_date(request.data, "issue_date")
        sale_date = _optional_iso_date(request.data, "sale_date")
        due_date = _optional_iso_date(request.data, "due_date")
        pm_raw = request.data.get("payment_method")
        payment_method = None if pm_raw in (None, "") else pm_raw
        try:
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
        except ValidationError as exc:
            log_error(
                user=request.user, action="invoice.create",
                error_detail=flatten_error_value(exc.detail),
                object_type="order", object_id=str(order.uuid), request=request,
            )
            raise
        log_success(
            user=request.user, action="invoice.create",
            object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
        )
        out = InvoiceSerializer(invoice, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="generate-from-orders")
    def generate_from_orders_action(self, request):
        """Create one draft invoice from multiple orders (same customer)."""
        company = request.user.current_company
        order_ids = request.data.get("order_ids") or []
        if not isinstance(order_ids, list):
            raise ValidationError({"order_ids": "Must be a list of UUIDs."})
        order_item_ids = request.data.get("order_item_ids", None)
        if order_item_ids is not None and not isinstance(order_item_ids, list):
            raise ValidationError({"order_item_ids": "Must be a list of UUIDs or null."})
        issue_date = _optional_iso_date(request.data, "issue_date")
        sale_date = _optional_iso_date(request.data, "sale_date")
        sale_date_to = _optional_iso_date(request.data, "sale_date_to")
        sale_date_type = request.data.get("sale_date_type", "single") or "single"
        due_date = _optional_iso_date(request.data, "due_date")
        pm_raw = request.data.get("payment_method")
        payment_method = None if pm_raw in (None, "") else pm_raw
        show_wz_raw = request.data.get("show_wz_numbers", True)
        show_wz_numbers = bool(show_wz_raw) if not isinstance(show_wz_raw, bool) else show_wz_raw
        try:
            invoice = generate_invoice_from_orders(
                order_ids=order_ids,
                order_item_ids=order_item_ids,
                company=company,
                user=request.user,
                issue_date=issue_date,
                sale_date=sale_date,
                sale_date_to=sale_date_to,
                sale_date_type=sale_date_type,
                due_date=due_date,
                payment_method=payment_method,
                show_wz_numbers=show_wz_numbers,
            )
        except ValidationError as exc:
            log_error(
                user=request.user, action="invoice.create",
                error_detail=flatten_error_value(exc.detail),
                object_type="invoice", object_id="multi-order", request=request,
            )
            raise
        log_success(
            user=request.user, action="invoice.create",
            object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
        )
        out = InvoiceSerializer(invoice, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="period-preview/orders")
    def period_preview_orders(self, request):
        """
        GET /api/invoices/period-preview/orders/?customer_id=&date_from=&date_to=
        Aggregate OrderItems per product for a customer over a date range.
        Returns items ready for use in a manual invoice.
        """
        from apps.customers.models import Customer as CustomerModel

        company = request.user.current_company
        customer_uuid = request.query_params.get("customer_id")
        if not customer_uuid:
            raise ValidationError({"customer_id": "This field is required."})
        customer = get_object_or_404(CustomerModel, uuid=customer_uuid, company=company)

        date_from = _optional_iso_date(request.query_params, "date_from")
        date_to = _optional_iso_date(request.query_params, "date_to")
        if not date_from or not date_to:
            raise ValidationError({"detail": "date_from and date_to are required."})

        items = get_period_preview_from_orders(
            customer=customer, company=company, date_from=date_from, date_to=date_to
        )
        return Response(items)

    @action(detail=False, methods=["get"], url_path="period-preview/wz")
    def period_preview_wz(self, request):
        """
        GET /api/invoices/period-preview/wz/?customer_id=&date_from=&date_to=
        Aggregate DeliveryItems (quantity_actual - quantity_returned) per product
        across WZ documents for a customer over a date range.
        Returns items ready for use in a manual invoice.
        """
        from apps.customers.models import Customer as CustomerModel

        company = request.user.current_company
        customer_uuid = request.query_params.get("customer_id")
        if not customer_uuid:
            raise ValidationError({"customer_id": "This field is required."})
        customer = get_object_or_404(CustomerModel, uuid=customer_uuid, company=company)

        date_from = _optional_iso_date(request.query_params, "date_from")
        date_to = _optional_iso_date(request.query_params, "date_to")
        if not date_from or not date_to:
            raise ValidationError({"detail": "date_from and date_to are required."})

        items = get_period_preview_from_wz(
            customer=customer, company=company, date_from=date_from, date_to=date_to
        )
        return Response(items)

    @action(detail=False, methods=["post"], url_path="create-manual")
    def create_manual(self, request):
        """Create a manual draft invoice without any order (items provided directly)."""
        company = request.user.current_company
        from apps.customers.models import Customer as CustomerModel
        customer_uuid = request.data.get("customer_id")
        if not customer_uuid:
            raise ValidationError({"customer_id": "This field is required."})
        customer = get_object_or_404(CustomerModel, uuid=customer_uuid, company=company)
        raw_items = request.data.get("items") or []
        if not isinstance(raw_items, list):
            raise ValidationError({"items": "Must be a list."})
        from .serializers import InvoiceItemWriteSerializer
        items_ser = InvoiceItemWriteSerializer(data=raw_items, many=True)
        if not items_ser.is_valid():
            raise ValidationError({"items": items_ser.errors})
        items_data = items_ser.validated_data
        issue_date = _optional_iso_date(request.data, "issue_date")
        sale_date = _optional_iso_date(request.data, "sale_date")
        sale_date_to = _optional_iso_date(request.data, "sale_date_to")
        sale_date_type = request.data.get("sale_date_type", "single") or "single"
        due_date = _optional_iso_date(request.data, "due_date")
        pm_raw = request.data.get("payment_method")
        payment_method = None if pm_raw in (None, "") else pm_raw
        custom_number = request.data.get("invoice_number", "").strip() or None
        place_of_issue = request.data.get("place_of_issue", "").strip() or None
        ksef_invoice_type = request.data.get("ksef_invoice_type", "VAT") or "VAT"
        advance_invoice_ids = request.data.get("advance_invoice_ids") or []
        if not isinstance(advance_invoice_ids, list):
            raise ValidationError({"advance_invoice_ids": "Must be a list of UUIDs."})
        payment_received_at = _optional_iso_date(request.data, "payment_received_at")
        other_payment_description = request.data.get("other_payment_description", "").strip() or None
        due_date_description = request.data.get("due_date_description", "").strip() or None
        contracts_raw = request.data.get("contracts") or []
        if not isinstance(contracts_raw, list):
            raise ValidationError({"contracts": "Must be a list."})
        purchase_orders_raw = request.data.get("purchase_orders") or []
        if not isinstance(purchase_orders_raw, list):
            raise ValidationError({"purchase_orders": "Must be a list."})
        try:
            invoice = create_manual_invoice(
                customer=customer,
                company=company,
                user=request.user,
                items_data=items_data,
                issue_date=issue_date,
                sale_date=sale_date,
                sale_date_to=sale_date_to,
                sale_date_type=sale_date_type,
                due_date=due_date,
                payment_method=payment_method,
                invoice_number=custom_number,
                place_of_issue=place_of_issue,
                ksef_invoice_type=ksef_invoice_type,
                advance_invoice_ids=advance_invoice_ids or None,
                payment_received_at=payment_received_at,
                other_payment_description=other_payment_description,
                due_date_description=due_date_description,
                contracts=contracts_raw or None,
                purchase_orders=purchase_orders_raw or None,
            )
        except ValidationError as exc:
            log_error(
                user=request.user, action="invoice.create",
                error_detail=flatten_error_value(exc.detail),
                object_type="invoice", object_id="manual", request=request,
            )
            raise
        log_success(
            user=request.user, action="invoice.create",
            object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
        )
        out = InvoiceSerializer(invoice, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="available-zal")
    def available_zal(self, request):
        """
        GET /api/invoices/available-zal/?customer_id=<uuid>
        Returns issued/sent/paid ZAL invoices for the customer that are not yet
        fully settled by a ROZ invoice.
        """
        from apps.customers.models import Customer as CustomerModel
        from apps.invoices.models import InvoiceAdvance

        company = request.user.current_company
        customer_uuid = request.query_params.get("customer_id")
        if not customer_uuid:
            raise ValidationError({"customer_id": "This field is required."})
        customer = get_object_or_404(CustomerModel, uuid=customer_uuid, company=company)

        zal_invoices = Invoice.objects.filter(
            company=company,
            customer=customer,
            ksef_invoice_type=Invoice.KSEF_TYPE_ZAL,
            status__in=[Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_PAID],
        ).order_by("issue_date")

        # Exclude ZAL invoices already fully settled
        settled_zal_ids = set(
            InvoiceAdvance.objects.filter(
                zal_invoice__in=zal_invoices,
            ).values_list("zal_invoice_id", flat=True)
        )
        available = [z for z in zal_invoices if z.id not in settled_zal_ids]

        return Response([
            {
                "id": str(z.uuid),
                "invoice_number": z.invoice_number,
                "issue_date": z.issue_date.isoformat(),
                "total_gross": str(z.total_gross),
            }
            for z in available
        ])

    @action(detail=True, methods=["post"], url_path="issue")
    def issue(self, request, uuid=None):
        from apps.users.models import get_workflow_settings

        invoice = self.get_object()
        inv_ref = invoice.invoice_number or str(invoice.uuid)

        if invoice.status != Invoice.STATUS_DRAFT:
            log_activity(
                user=request.user, action="invoice.issue",
                status=ActivityLog.STATUS_ERROR, error_code="INVOICE_NOT_DRAFT",
                object_type="invoice", object_id=inv_ref, request=request,
            )
            raise ValidationError({"detail": "Tylko faktury w statusie 'szkic' mogą być wystawione."})

        if invoice.order_id:
            wf = get_workflow_settings(request.user.current_company)
            if wf.wz_required_before_invoice:
                has_delivered_wz = invoice.order.delivery_documents.filter(
                    document_type="WZ",
                    status="delivered",
                ).exists()
                if not has_delivered_wz:
                    log_activity(
                        user=request.user, action="invoice.issue",
                        status=ActivityLog.STATUS_ERROR, error_code="INVOICE_WZ_REQUIRED",
                        object_type="invoice", object_id=inv_ref,
                        error_detail=f"Zamówienie: {invoice.order.order_number}",
                        request=request,
                    )
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
                        log_activity(
                            user=request.user, action="invoice.issue",
                            status=ActivityLog.STATUS_ERROR, error_code="INVOICE_QTY_EXCEEDED",
                            object_type="invoice", object_id=inv_ref,
                            error_detail=f"Produkt: {inv_item.product_name}, zamówiono: {inv_item.quantity}, do fakturowania: {invoiceable}",
                            request=request,
                        )
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

        # Assign invoice number if this is an unnumbered draft
        if not invoice.invoice_number:
            from datetime import date as _date
            from django.db import transaction as _transaction
            with _transaction.atomic():
                from apps.users.models import Company as _Company
                _Company.objects.select_for_update().get(pk=invoice.company_id)
                issue_date = invoice.issue_date or _date.today()
                invoice.invoice_number = Invoice._next_invoice_number(
                    invoice.company_id, issue_date, is_correction=invoice.is_correction
                )
                invoice.status = Invoice.STATUS_ISSUED
                invoice.user = request.user
                invoice.save(update_fields=["invoice_number", "status", "user", "updated_at"])
        else:
            invoice.status = Invoice.STATUS_ISSUED
            invoice.user = request.user
            invoice.save(update_fields=["status", "user", "updated_at"])
        log_activity(
            user=request.user, action="invoice.issue",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
        )
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, uuid=None):
        invoice = self.get_object()
        payable_statuses = (
            Invoice.STATUS_ISSUED,
            Invoice.STATUS_SENT,
            Invoice.STATUS_OVERDUE,
        )
        if invoice.status not in payable_statuses:
            raise ValidationError(
                {"detail": "Tylko wystawione, wysłane lub przeterminowane faktury mogą być oznaczone jako zapłacone."}
            )
        invoice.status = Invoice.STATUS_PAID
        invoice.paid_at = timezone.now()
        invoice.user = request.user
        invoice.save(
            update_fields=["status", "paid_at", "user", "updated_at"],
        )
        log_activity(
            user=request.user, action="invoice.mark_paid",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
        )
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark-unpaid")
    def mark_unpaid(self, request, uuid=None):
        invoice = self.get_object()
        if invoice.status != Invoice.STATUS_PAID:
            raise ValidationError(
                {"detail": "Tylko opłacone faktury mogą być cofnięte do statusu nieopłaconej."}
            )
        invoice.status = Invoice.STATUS_ISSUED
        invoice.paid_at = None
        invoice.user = request.user
        invoice.save(
            update_fields=["status", "paid_at", "user", "updated_at"],
        )
        log_activity(
            user=request.user, action="invoice.mark_unpaid",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
        )
        return Response(self.get_serializer(invoice).data)

    @action(detail=False, methods=["get"], url_path="summary", permission_classes=[IsAuthenticated, IsCompanyMember])
    def summary(self, request):
        from django.db.models import Count, Sum, Q

        qs = self.get_queryset().filter(is_correction=False)
        first_of_month = timezone.now().date().replace(day=1)

        agg = qs.aggregate(
            unpaid_count=Count('id', filter=Q(status__in=['issued', 'sent'])),
            unpaid_total=Sum('total_gross', filter=Q(status__in=['issued', 'sent'])),
            overdue_count=Count('id', filter=Q(status='overdue')),
            overdue_total=Sum('total_gross', filter=Q(status='overdue')),
            paid_this_month_count=Count('id', filter=Q(status='paid', paid_at__date__gte=first_of_month)),
            paid_this_month_total=Sum('total_gross', filter=Q(status='paid', paid_at__date__gte=first_of_month)),
        )

        return Response({
            'unpaid_count': agg['unpaid_count'] or 0,
            'unpaid_total': str(agg['unpaid_total'] or 0),
            'overdue_count': agg['overdue_count'] or 0,
            'overdue_total': str(agg['overdue_total'] or 0),
            'paid_this_month_count': agg['paid_this_month_count'] or 0,
            'paid_this_month_total': str(agg['paid_this_month_total'] or 0),
        })

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request, uuid=None):
        invoice = self.get_object()
        return Response(build_invoice_preview_data(invoice))

    @action(detail=True, methods=["get"], url_path="xml")
    def xml(self, request, uuid=None):
        """Download FA-3 KSeF XML for this invoice."""
        invoice = self.get_object()
        try:
            xml_str = generate_fa3_xml(invoice)
        except Exception as exc:
            log_error(
                user=request.user, action="invoice.download", error_code="KSEF_XML_FAILED",
                error_detail=str(exc),
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
                request=request,
            )
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
    def send_to_ksef(self, request, uuid=None):
        """
        Submit an issued invoice to KSeF via SSAPI.
        Requires active KSeF session for the company (authenticate via POST /api/ksef/session/).
        Returns updated invoice with ksef_reference_number and ksef_status='pending'.
        """
        invoice = self.get_object()

        if invoice.status != Invoice.STATUS_ISSUED:
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="INVOICE_NOT_ISSUED",
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.pk),
                request=request,
            )
            return Response(
                {"detail": "Tylko wystawione faktury mogą być wysłane do KSeF."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if invoice.ksef_status in ("pending", "sent", "accepted"):
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_WARNING, error_code="INVOICE_ALREADY_IN_KSEF",
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.pk),
                request=request,
            )
            return Response(
                {"detail": f"Faktura jest już w KSeF (status: {invoice.ksef_status})."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        company = request.user.current_company

        # Validate required company/customer fields for FA-3 XML
        inv_ref = invoice.invoice_number or str(invoice.pk)
        if not company.nip:
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_NO_NIP_COMPANY",
                object_type="invoice", object_id=inv_ref, request=request,
            )
            return Response(
                {"detail": "Uzupełnij NIP firmy przed wysłaniem faktury do KSeF."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not invoice.customer.nip:
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_NO_NIP_CUSTOMER",
                object_type="invoice", object_id=inv_ref, request=request,
            )
            return Response(
                {"detail": "Nabywca nie ma uzupełnionego NIP. Uzupełnij dane klienta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check active SSAPI session
        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_NO_SESSION",
                object_type="invoice", object_id=inv_ref, request=request,
            )
            return Response(
                {"detail": "Brak sesji KSeF. Zaloguj się do KSeF przed wysłaniem faktury."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not ksef_sess.is_active():
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_SESSION_EXPIRED",
                object_type="invoice", object_id=inv_ref, request=request,
            )
            return Response(
                {"detail": "Sesja KSeF wygasła. Zaloguj się ponownie do KSeF."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Validate all FA-3 fields before generating XML
        ksef_errors, ksef_warnings = validate_invoice_for_ksef(invoice)
        if ksef_errors:
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_VALIDATION_FAILED",
                object_type="invoice", object_id=inv_ref,
                error_detail="; ".join(ksef_errors), request=request,
            )
            return Response(
                {"detail": "Faktura nie spełnia wymagań FA-3 KSeF.", "errors": ksef_errors, "warnings": ksef_warnings},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate FA-3 XML and encode as Base64
        try:
            invoice_b64 = generate_fa3_xml_base64(invoice)
        except Exception as exc:
            logger.error("FA-3 XML generation failed for invoice %s: %s", invoice.pk, exc)
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_XML_FAILED",
                object_type="invoice", object_id=inv_ref, error_detail=str(exc), request=request,
            )
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
            log_activity(
                user=request.user, action="ksef.send",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_SEND_FAILED",
                object_type="invoice", object_id=inv_ref, error_detail=str(exc), request=request,
            )
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
        log_activity(
            user=request.user, action="ksef.send",
            status=ActivityLog.STATUS_SUCCESS,
            object_type="invoice", object_id=inv_ref,
        )
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["get"], url_path="ksef-status")
    def ksef_status(self, request, uuid=None):
        """
        Poll SSAPI for KSeF processing status and update invoice fields.
        Returns updated invoice.
        """
        invoice = self.get_object()

        if not invoice.ksef_reference_number:
            log_error(
                user=request.user, action="ksef.status", error_code="INVOICE_NOT_ISSUED",
                error_detail="Faktura nie ma numeru referencyjnego KSeF.",
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
                request=request,
            )
            return Response(
                {"detail": "Faktura nie ma numeru referencyjnego KSeF. Najpierw wyślij fakturę."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        company = request.user.current_company
        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            log_error(
                user=request.user, action="ksef.status", error_code="KSEF_NO_SESSION",
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
                request=request,
            )
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
            log_error(
                user=request.user, action="ksef.status", error_code="KSEF_SEND_FAILED",
                error_detail=str(exc),
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
                request=request,
            )
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
            log_activity(
                user=request.user, action="ksef.status",
                status=ActivityLog.STATUS_SUCCESS,
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.pk),
            )
        elif http_code == 200 and status_code and status_code >= 400:
            invoice.ksef_status = "rejected"
            invoice.ksef_error_message = status_block.get("description", "KSeF rejected the invoice.")
            invoice.save(update_fields=["ksef_status", "ksef_error_message", "updated_at"])
            send_ksef_status_push(request.user, invoice_number=invoice.invoice_number or str(invoice.pk), new_status="rejected")
            log_activity(
                user=request.user, action="ksef.status",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_REJECTED",
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.pk),
                error_detail=invoice.ksef_error_message, request=request,
            )

        return Response({**self.get_serializer(invoice).data, "_ssapi_raw": data})

    @action(detail=True, methods=["post"], url_path="create-correction")
    def create_correction(self, request, uuid=None):
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

        try:
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
        except ValidationError as exc:
            log_error(
                user=request.user, action="invoice.correction",
                error_detail=flatten_error_value(exc.detail),
                object_type="invoice",
                object_id=invoice.invoice_number or str(invoice.uuid),
                request=request,
            )
            raise
        log_success(
            user=request.user, action="invoice.correction",
            object_type="invoice",
            object_id=correction.invoice_number or str(correction.uuid),
        )
        return Response(
            self.get_serializer(correction).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="upo")
    def upo(self, request, uuid=None):
        """
        GET /api/invoices/{id}/upo/
        Download the UPO (Urzędowe Potwierdzenie Odbioru) XML for an accepted invoice.
        The UPO is stored on the first successful ksef-status poll and served from DB —
        no active KSeF session required.
        """
        from apps.ksef.models import KSeFSentInvoice

        invoice = self.get_object()

        if not invoice.upo_received:
            log_error(
                user=request.user, action="invoice.download",
                error_detail="UPO nie jest jeszcze dostępne.",
                object_type="invoice", object_id=invoice.invoice_number or str(invoice.uuid),
                request=request,
            )
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

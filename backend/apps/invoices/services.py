"""Invoice generation, totals, and preview payload for HTML rendering."""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.delivery.models import DeliveryDocument
from apps.orders.models import Order, OrderItem

from .models import Invoice, InvoiceItem

_ORDER_STATUSES_INVOICEABLE = frozenset(
    {
        Order.STATUS_CONFIRMED,
        Order.STATUS_DELIVERED,
        Order.STATUS_INVOICED,
    }
)


def billable_quantity(order_item: OrderItem) -> Decimal:
    """Prefer delivered quantity; otherwise fall back to ordered quantity."""
    qd = order_item.quantity_delivered or Decimal("0")
    if qd > 0:
        return qd
    return order_item.quantity


def _resolve_delivery_document(
    *,
    order: Order,
    company_id,
    explicit: DeliveryDocument | None,
) -> DeliveryDocument | None:
    if explicit is not None:
        if str(explicit.company_id) != str(company_id) or str(explicit.order_id) != str(
            order.id
        ):
            raise ValidationError(
                "Delivery document does not match this order or company."
            )
        return explicit
    return (
        DeliveryDocument.objects.filter(
            company_id=company_id,
            order_id=order.id,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            status=DeliveryDocument.STATUS_DELIVERED,
        )
        .order_by("-created_at")
        .first()
    )


def recalculate_invoice_totals(invoice: Invoice) -> None:
    """Set header amounts from line sums (no save)."""
    agg = invoice.items.aggregate(
        net=Sum("line_net"),
        vat=Sum("line_vat"),
        gross=Sum("line_gross"),
    )
    invoice.subtotal_net = agg["net"] or Decimal("0.00")
    invoice.vat_amount = agg["vat"] or Decimal("0.00")
    invoice.total_gross = agg["gross"] or Decimal("0.00")
    invoice.subtotal_gross = invoice.total_gross


@transaction.atomic
def generate_invoice_from_order(
    *,
    order: Order,
    company,
    user,
    delivery_document: DeliveryDocument | None = None,
    issue_date: date | None = None,
    sale_date: date | None = None,
    due_date: date | None = None,
    payment_method: str | None = None,
) -> Invoice:
    """
    Create a draft invoice and lines from an order in ``confirmed``, ``delivered``, or
    ``invoiced`` status (``confirmed`` = accepted order ready to bill without WZ closure).
    Line text and units are snapshotted from each ``OrderItem`` (not live ``Product`` names).
    Uses ``quantity_delivered`` when set, otherwise ordered quantity.
    Totals are summed from line net / VAT / gross.

    Dates / ``payment_method`` default from business rules; pass explicit values to override
    (e.g. invoice creation form).
    """
    if order.company_id != company.id:
        raise ValidationError("Order does not belong to the current company.")
    if order.status not in _ORDER_STATUSES_INVOICEABLE:
        raise ValidationError(
            "Order must be confirmed, delivered, or invoiced before generating an invoice."
        )

    doc = _resolve_delivery_document(
        order=order,
        company_id=company.id,
        explicit=delivery_document,
    )

    resolved_issue = issue_date or timezone.localdate()
    resolved_sale = sale_date or order.delivery_date or resolved_issue
    if due_date is not None:
        resolved_due = due_date
    else:
        pay_days = getattr(order.customer, "payment_terms", None)
        if pay_days is None:
            pay_days = 14
        resolved_due = resolved_issue + timedelta(days=int(pay_days))

    pm = payment_method if payment_method not in (None, "") else "transfer"
    if pm not in dict(Invoice.PAYMENT_METHOD_CHOICES):
        raise ValidationError({"payment_method": "Invalid payment method."})

    lines: list[tuple[OrderItem, Decimal]] = []
    for oi in order.items.all().select_related("product"):
        qty = billable_quantity(oi)
        if qty <= 0:
            continue
        lines.append((oi, qty))

    if not lines:
        raise ValidationError(
            "No billable lines on this order (all quantities are zero)."
        )

    invoice = Invoice(
        company=company,
        user=user,
        order=order,
        customer=order.customer,
        delivery_document=doc,
        issue_date=resolved_issue,
        sale_date=resolved_sale,
        due_date=resolved_due,
        payment_method=pm,
        status=Invoice.STATUS_DRAFT,
    )
    invoice.save()

    for oi, qty in lines:
        product_name = (oi.product_name or "").strip()
        product_unit = (oi.product_unit or "").strip()
        if oi.product_id:
            if not product_name:
                product_name = oi.product.name
            if not product_unit:
                product_unit = oi.product.unit or ""

        InvoiceItem.objects.create(
            invoice=invoice,
            order_item=oi,
            product=oi.product,
            product_name=product_name,
            product_unit=product_unit,
            pkwiu=(oi.product.pkwiu or "").strip() if oi.product_id else "",
            quantity=qty,
            unit_price_net=oi.unit_price_net,
            vat_rate=oi.vat_rate,
        )

    recalculate_invoice_totals(invoice)
    invoice.save(
        update_fields=[
            "subtotal_net",
            "subtotal_gross",
            "vat_amount",
            "total_gross",
            "updated_at",
        ]
    )
    return invoice


def _fmt_money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01')):.2f}"


def _fk_uuid(value) -> str | None:
    return str(value) if value is not None else None


def _serialize_invoice_full(invoice: Invoice) -> dict:
    """All `Invoice` DB fields as JSON-friendly scalars (amounts as formatted strings)."""
    return {
        "id": str(invoice.id),
        "company": str(invoice.company_id),
        "user": _fk_uuid(invoice.user_id),
        "order": str(invoice.order_id),
        "customer": str(invoice.customer_id),
        "delivery_document": _fk_uuid(invoice.delivery_document_id),
        "invoice_number": invoice.invoice_number or "",
        "issue_date": invoice.issue_date.isoformat(),
        "sale_date": invoice.sale_date.isoformat(),
        "due_date": invoice.due_date.isoformat(),
        "payment_method": invoice.payment_method,
        "subtotal_net": _fmt_money(invoice.subtotal_net),
        "subtotal_gross": _fmt_money(invoice.subtotal_gross),
        "vat_amount": _fmt_money(invoice.vat_amount),
        "total_gross": _fmt_money(invoice.total_gross),
        "ksef_reference_number": invoice.ksef_reference_number or "",
        "ksef_number": invoice.ksef_number or "",
        "ksef_status": invoice.ksef_status,
        "ksef_sent_at": (
            invoice.ksef_sent_at.isoformat() if invoice.ksef_sent_at else None
        ),
        "ksef_error_message": invoice.ksef_error_message or "",
        "invoice_hash": invoice.invoice_hash or "",
        "upo_received": invoice.upo_received,
        "status": invoice.status,
        "paid_at": invoice.paid_at.isoformat() if invoice.paid_at else None,
        "notes": invoice.notes or "",
        "created_at": invoice.created_at.isoformat(),
        "updated_at": invoice.updated_at.isoformat(),
    }


def build_invoice_preview_data(invoice: Invoice) -> dict:
    """Structured payload for an HTML invoice preview (A4-style layout)."""
    company = invoice.company
    customer = invoice.customer

    company_lines = [
        part
        for part in (
            company.name,
            company.address.strip() if company.address else "",
            " ".join(
                p
                for p in (company.postal_code or "", company.city or "")
                if p
            ).strip(),
            f"NIP: {company.nip}" if company.nip else "",
        )
        if part
    ]

    buyer_name = customer.company_name or customer.name
    customer_lines = [
        part
        for part in (
            buyer_name,
            customer.street or "",
            " ".join(
                p
                for p in (customer.postal_code or "", customer.city or "")
                if p
            ).strip(),
            f"NIP: {customer.nip}" if customer.nip else "",
        )
        if part
    ]

    items = list(invoice.items.order_by("created_at"))
    line_rows = []
    for idx, it in enumerate(items, start=1):
        line_rows.append(
            {
                "position": idx,
                "product_name": it.product_name,
                "product_unit": it.product_unit,
                "pkwiu": it.pkwiu or "",
                "quantity": str(it.quantity),
                "quantity_display": _fmt_money(it.quantity),
                "unit_price_net": _fmt_money(it.unit_price_net),
                "vat_rate": str(it.vat_rate),
                "vat_rate_display": _fmt_money(it.vat_rate),
                "line_net": _fmt_money(it.line_net),
                "line_vat": _fmt_money(it.line_vat),
                "line_gross": _fmt_money(it.line_gross),
            }
        )

    by_rate: dict[Decimal, dict[str, Decimal]] = defaultdict(
        lambda: {
            "net": Decimal("0.00"),
            "vat": Decimal("0.00"),
            "gross": Decimal("0.00"),
        }
    )
    for it in items:
        rate = it.vat_rate.quantize(Decimal("0.01"))
        by_rate[rate]["net"] += it.line_net
        by_rate[rate]["vat"] += it.line_vat
        by_rate[rate]["gross"] += it.line_gross
    by_vat_rate = [
        {
            "vat_rate": _fmt_money(rate),
            "net": _fmt_money(totals["net"]),
            "vat": _fmt_money(totals["vat"]),
            "gross": _fmt_money(totals["gross"]),
        }
        for rate, totals in sorted(by_rate.items(), key=lambda x: x[0])
    ]

    preview_items = [
        {
            "product_name": it.product_name,
            "pkwiu": it.pkwiu or "",
            "quantity": _fmt_money(it.quantity),
            "unit": it.product_unit or "",
            "unit_price_net": _fmt_money(it.unit_price_net),
            "vat_rate": _fmt_money(it.vat_rate),
            "line_net": _fmt_money(it.line_net),
            "line_vat": _fmt_money(it.line_vat),
            "line_gross": _fmt_money(it.line_gross),
        }
        for it in items
    ]

    invoice_block = {
        **_serialize_invoice_full(invoice),
        "order_number": invoice.order.order_number or "",
        "payment_method_label": dict(Invoice.PAYMENT_METHOD_CHOICES).get(
            invoice.payment_method,
            invoice.payment_method,
        ),
        "delivery_document_number": (
            invoice.delivery_document.document_number
            if invoice.delivery_document_id
            and invoice.delivery_document.document_number
            else ""
        ),
    }

    return {
        "meta": {
            "title": f"Invoice {invoice.invoice_number or ''}".strip(),
            "currency": "PLN",
            "locale": "pl-PL",
        },
        "seller": {
            "name": company.name,
            "nip": company.nip or "",
            "address_lines": company_lines,
        },
        "buyer": {
            "name": buyer_name,
            "nip": customer.nip or "",
            "address_lines": customer_lines,
        },
        "company": {
            "name": company.name,
            "nip": company.nip or "",
            "address": (company.address or "").strip(),
            "city": company.city or "",
            "postal_code": company.postal_code or "",
            "phone": company.phone or "",
            "email": company.email or "",
        },
        "customer": {
            "name": buyer_name,
            "nip": customer.nip or "",
            "address": (customer.street or "") or "",
            "city": customer.city or "",
            "postal_code": customer.postal_code or "",
        },
        "invoice": invoice_block,
        "totals": {
            "subtotal_net": _fmt_money(invoice.subtotal_net),
            "vat_amount": _fmt_money(invoice.vat_amount),
            "subtotal_gross": _fmt_money(invoice.subtotal_gross),
            "total_gross": _fmt_money(invoice.total_gross),
            "byVatRate": by_vat_rate,
        },
        "items": preview_items,
        "lines": line_rows,
    }

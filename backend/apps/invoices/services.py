"""Invoice generation, totals, and preview payload for HTML rendering."""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.delivery.models import DeliveryDocument
from apps.delivery.services import _deduct_fifo_batches, active_main_warehouse_for_company
from apps.orders.models import Order, OrderItem
from apps.products.models import ProductStock, StockMovement, Warehouse

from .models import Invoice, InvoiceItem, InvoiceOrder

_ORDER_STATUSES_INVOICEABLE = frozenset(
    {
        Order.STATUS_CONFIRMED,
        Order.STATUS_DELIVERED,
        Order.STATUS_INVOICED,
    }
)


def billable_quantity(order_item: OrderItem, returns_mode: str = "fv_kor") -> Decimal:
    """
    Prefer delivered quantity; otherwise fall back to ordered quantity.
    When returns_mode='net_qty', subtracts quantity_returned from delivered quantity.
    """
    qd = order_item.quantity_delivered or Decimal("0")
    if qd > 0:
        if returns_mode == "net_qty":
            qr = order_item.quantity_returned or Decimal("0")
            return max(qd - qr, Decimal("0"))
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

    existing = Invoice.objects.filter(
        company_id=company.id,
        order_id=order.id,
        status__in=["draft", "issued", "sent", "paid", "overdue"],
    ).first()
    if existing:
        raise ValidationError(
            f"Zamówienie {order.order_number} ma już aktywną fakturę "
            f"{existing.invoice_number or existing.id} (status: {existing.status}). "
            f"Anuluj istniejącą fakturę przed wygenerowaniem nowej."
        )

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
        # Pre-fill bank details from company defaults so the user doesn't
        # have to re-enter them on every invoice (can be overridden per invoice).
        bank_account_iban=company.bank_account_iban or "",
        bank_swift=company.bank_swift or "",
        bank_name=company.bank_name or "",
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


@transaction.atomic
def generate_invoice_from_orders(
    *,
    order_ids: list,
    company,
    user,
    order_item_ids: list | None = None,
    issue_date: date | None = None,
    sale_date: date | None = None,
    sale_date_to: date | None = None,
    sale_date_type: str = "single",
    due_date: date | None = None,
    payment_method: str | None = None,
    show_wz_numbers: bool = True,
) -> Invoice:
    """
    Create a draft invoice from one or more orders belonging to the same customer.

    All orders must:
    - belong to the current company
    - belong to the same customer
    - be in invoiceable status (confirmed / delivered / invoiced)
    - not already have an active non-correction invoice

    Lines from all orders are merged: one InvoiceItem per order line (no deduplication
    across orders — keeps audit trail clear).
    """
    if not order_ids:
        raise ValidationError("Wybierz co najmniej jedno zamówienie.")

    orders = list(
        Order.objects.filter(uuid__in=order_ids, company=company)
        .select_related("customer")
        .prefetch_related("items__product")
    )
    if len(orders) != len(order_ids):
        raise ValidationError("Nie wszystkie zamówienia należą do tej firmy.")

    # Same customer check
    customer_ids = {o.customer_id for o in orders}
    if len(customer_ids) != 1:
        raise ValidationError(
            "Wszystkie zamówienia muszą należeć do tego samego klienta."
        )
    customer = orders[0].customer

    # Status check
    bad_status = [o.order_number for o in orders if o.status not in _ORDER_STATUSES_INVOICEABLE]
    if bad_status:
        raise ValidationError(
            f"Zamówienia {', '.join(str(n) for n in bad_status)} muszą być "
            "potwierdzone, dostarczone lub zafakturowane."
        )

    # Duplicate invoice check — query per order via InvoiceOrder (multi) OR legacy order FK
    for order in orders:
        via_legacy = Invoice.objects.filter(
            company=company,
            order=order,
            status__in=["draft", "issued", "sent", "paid", "overdue"],
            is_correction=False,
        ).first()
        via_multi = Invoice.objects.filter(
            company=company,
            invoice_orders__order=order,
            status__in=["draft", "issued", "sent", "paid", "overdue"],
            is_correction=False,
        ).first()
        existing = via_legacy or via_multi
        if existing:
            raise ValidationError(
                f"Zamówienie {order.order_number} ma już aktywną fakturę "
                f"{existing.invoice_number or existing.id} (status: {existing.status}). "
                "Anuluj istniejącą fakturę przed wygenerowaniem nowej."
            )

    # Collect lines from all orders
    returns_mode = getattr(company, "invoice_returns_mode", "fv_kor")
    item_ids_set = {str(uid) for uid in order_item_ids} if order_item_ids is not None else None
    all_lines: list[tuple[OrderItem, Decimal]] = []
    for order in orders:
        for oi in order.items.all().select_related("product"):
            if item_ids_set is not None and str(oi.uuid) not in item_ids_set:
                continue
            qty = billable_quantity(oi, returns_mode=returns_mode)
            if qty > 0:
                all_lines.append((oi, qty))

    if not all_lines:
        raise ValidationError(
            "Żadne z wybranych zamówień nie ma pozycji do fakturowania."
        )

    # Dates
    resolved_issue = issue_date or timezone.localdate()
    # sale_date = latest delivery date across orders (or issue_date)
    if sale_date is not None:
        resolved_sale = sale_date
    else:
        delivery_dates = [o.delivery_date for o in orders if o.delivery_date]
        resolved_sale = max(delivery_dates) if delivery_dates else resolved_issue
    if due_date is not None:
        resolved_due = due_date
    else:
        pay_days = getattr(customer, "payment_terms", None) or 14
        resolved_due = resolved_issue + timedelta(days=int(pay_days))

    pm = payment_method if payment_method not in (None, "") else "transfer"
    if pm not in dict(Invoice.PAYMENT_METHOD_CHOICES):
        raise ValidationError({"payment_method": "Invalid payment method."})

    invoice = Invoice(
        company=company,
        user=user,
        order=None,  # multi-order: no single FK
        customer=customer,
        issue_date=resolved_issue,
        sale_date=resolved_sale,
        sale_date_to=sale_date_to,
        sale_date_type=sale_date_type,
        due_date=resolved_due,
        payment_method=pm,
        status=Invoice.STATUS_DRAFT,
        bank_account_iban=company.bank_account_iban or "",
        bank_swift=company.bank_swift or "",
        bank_name=company.bank_name or "",
        show_wz_numbers=show_wz_numbers,
    )
    invoice.save()

    # Link orders via M2M junction
    for order in orders:
        InvoiceOrder.objects.create(invoice=invoice, order=order)

    # Create line items
    for oi, qty in all_lines:
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
            product=oi.product if oi.product_id else None,
            product_name=product_name,
            product_unit=product_unit,
            pkwiu=(oi.product.pkwiu or "").strip() if oi.product_id else "",
            quantity=qty,
            unit_price_net=oi.unit_price_net,
            vat_rate=oi.vat_rate,
        )

    recalculate_invoice_totals(invoice)
    invoice.save(update_fields=["subtotal_net", "subtotal_gross", "vat_amount", "total_gross", "updated_at"])
    return invoice


def _deduct_stock_for_invoice_items(*, invoice: "Invoice", items: list, company, user) -> None:
    """
    Deduct stock for each invoice line that has a linked product.
    Uses the company's main warehouse (or the first active warehouse of any type).
    Called inside create_manual_invoice after all InvoiceItems are saved.
    """
    warehouse = active_main_warehouse_for_company(company.id)
    if warehouse is None:
        # Fall back to any active warehouse
        warehouse = (
            Warehouse.objects.filter(company_id=company.id, is_active=True)
            .order_by("code")
            .first()
        )
    if warehouse is None:
        return  # no warehouse configured — skip silently

    for item in items:
        product = item.product
        if product is None:
            continue  # free-text line, no stock to deduct
        qty = item.quantity
        if qty <= Decimal("0"):
            continue

        stock = ProductStock.get_or_create_for(product=product, warehouse=warehouse)
        stock = ProductStock.objects.select_for_update().get(pk=stock.pk)
        qty_before = stock.quantity_available
        stock.quantity_available = max(stock.quantity_available - qty, Decimal("0"))
        stock.save(update_fields=["quantity_available", "quantity_total"])

        StockMovement.objects.create(
            company_id=company.id,
            product=product,
            warehouse=warehouse,
            user=user,
            movement_type=StockMovement.MovementType.SALE,
            quantity=-qty,
            quantity_before=qty_before,
            quantity_after=stock.quantity_available,
            reference_type="invoice",
            reference_id=invoice.uuid,
            created_by=user,
        )

        _deduct_fifo_batches(
            company_id=company.id,
            product_id=product.id,
            warehouse_id=warehouse.id,
            quantity=qty,
        )


@transaction.atomic
def create_manual_invoice(
    *,
    customer,
    company,
    user,
    items_data: list[dict],
    issue_date: date | None = None,
    sale_date: date | None = None,
    sale_date_to: date | None = None,
    sale_date_type: str = "single",
    due_date: date | None = None,
    payment_method: str | None = None,
    invoice_number: str | None = None,
    place_of_issue: str | None = None,
    ksef_invoice_type: str = "VAT",
    advance_invoice_ids: list | None = None,
    payment_received_at: date | None = None,
    other_payment_description: str | None = None,
    due_date_description: str | None = None,
    contracts: list | None = None,
    purchase_orders: list | None = None,
) -> Invoice:
    """
    Create a draft invoice manually (no order required).
    items_data: [{"product_name": str, "product_unit": str, "quantity": str,
                   "unit_price_net": str, "vat_rate": str, "product": uuid_str|None}]
    For ROZ invoices: advance_invoice_ids must be a non-empty list of ZAL invoice UUIDs.
    """
    if not items_data:
        raise ValidationError("Faktura musi zawierać co najmniej jedną pozycję.")

    # Validate ksef_invoice_type
    valid_types = [Invoice.KSEF_TYPE_VAT, Invoice.KSEF_TYPE_ZAL, Invoice.KSEF_TYPE_ROZ]
    if ksef_invoice_type not in valid_types:
        raise ValidationError({"ksef_invoice_type": f"Nieprawidłowy typ faktury: {ksef_invoice_type}."})

    # ROZ requires at least one ZAL invoice
    if ksef_invoice_type == Invoice.KSEF_TYPE_ROZ and not advance_invoice_ids:
        raise ValidationError({
            "advance_invoice_ids": (
                "Faktura rozliczeniowa (ROZ) musi wskazywać co najmniej jedną fakturę zaliczkową (ZAL)."
            )
        })

    resolved_issue = issue_date or timezone.localdate()
    resolved_sale = sale_date or resolved_issue
    if due_date is not None:
        resolved_due = due_date
    else:
        pay_days = getattr(customer, "payment_terms", None) or 14
        resolved_due = resolved_issue + timedelta(days=int(pay_days))

    pm = payment_method if payment_method not in (None, "") else "transfer"
    if pm not in dict(Invoice.PAYMENT_METHOD_CHOICES):
        raise ValidationError({"payment_method": "Invalid payment method."})

    # Validate custom invoice number uniqueness within the company
    resolved_number = invoice_number or None
    if resolved_number:
        if Invoice.objects.filter(company=company, invoice_number=resolved_number).exists():
            raise ValidationError({"invoice_number": f"Numer faktury '{resolved_number}' jest już zajęty."})

    invoice = Invoice(
        company=company,
        user=user,
        order=None,
        customer=customer,
        issue_date=resolved_issue,
        sale_date=resolved_sale,
        sale_date_to=sale_date_to,
        sale_date_type=sale_date_type,
        due_date=resolved_due,
        payment_method=pm,
        status=Invoice.STATUS_DRAFT,
        invoice_number=resolved_number,
        bank_account_iban=company.bank_account_iban or "",
        bank_swift=company.bank_swift or "",
        bank_name=company.bank_name or "",
        place_of_issue=place_of_issue or "",
        ksef_invoice_type=ksef_invoice_type,
        payment_received_at=payment_received_at,
        other_payment_description=other_payment_description or "",
        due_date_description=due_date_description or "",
        contracts=contracts or [],
        purchase_orders=purchase_orders or [],
    )
    invoice.save()

    from apps.products.models import Product as ProductModel
    invoice_items = []
    for item in items_data:
        qty = Decimal(str(item.get("quantity", "1")))
        # unit_price_net is guaranteed present after InvoiceItemWriteSerializer.validate()
        # (converts unit_price_gross → unit_price_net when gross mode is used)
        price = Decimal(str(item.get("unit_price_net") or "0"))
        vat = Decimal(str(item.get("vat_rate", "23")))
        product_uuid = item.get("product")
        product_obj = None
        product_name = str(item.get("product_name", "")).strip()
        product_unit = str(item.get("product_unit", "")).strip()
        if product_uuid:
            try:
                product_obj = ProductModel.objects.get(uuid=product_uuid, company=company)
                if not product_name:
                    product_name = product_obj.name
                if not product_unit:
                    product_unit = product_obj.unit or ""
            except ProductModel.DoesNotExist:
                pass
        if not product_name:
            raise ValidationError({"items": "Każda pozycja musi mieć nazwę produktu."})
        invoice_item = InvoiceItem.objects.create(
            invoice=invoice,
            order_item=None,
            product=product_obj,
            product_name=product_name,
            product_unit=product_unit,
            pkwiu=(product_obj.pkwiu or "").strip() if product_obj else "",
            quantity=qty,
            unit_price_net=price,
            vat_rate=vat,
        )
        invoice_items.append(invoice_item)

    recalculate_invoice_totals(invoice)
    invoice.save(update_fields=["subtotal_net", "subtotal_gross", "vat_amount", "total_gross", "updated_at"])

    # Link ZAL invoices for ROZ
    if ksef_invoice_type == Invoice.KSEF_TYPE_ROZ and advance_invoice_ids:
        from apps.invoices.models import InvoiceAdvance
        zal_invoices = list(Invoice.objects.filter(
            uuid__in=advance_invoice_ids,
            company=company,
            ksef_invoice_type=Invoice.KSEF_TYPE_ZAL,
            customer=customer,
        ))
        found_ids = {str(z.uuid) for z in zal_invoices}
        missing = [uid for uid in advance_invoice_ids if uid not in found_ids]
        if missing:
            raise ValidationError({
                "advance_invoice_ids": (
                    "Nie znaleziono faktur zaliczkowych lub nie należą do tego klienta: "
                    + ", ".join(missing)
                )
            })
        total_zal = sum(z.total_gross for z in zal_invoices)
        if invoice.total_gross > total_zal + Decimal("0.01"):
            raise ValidationError({
                "advance_invoice_ids": (
                    f"Kwota faktury rozliczeniowej ({invoice.total_gross} zł) "
                    f"przekracza łączną wartość faktur zaliczkowych ({total_zal} zł)."
                )
            })
        for zal in zal_invoices:
            InvoiceAdvance.objects.create(
                roz_invoice=invoice,
                zal_invoice=zal,
                deduction_amount=zal.total_gross,
            )

    _deduct_stock_for_invoice_items(
        invoice=invoice,
        items=invoice_items,
        company=company,
        user=user,
    )

    return invoice


@transaction.atomic
def create_invoice_correction(
    *,
    original_invoice: Invoice,
    company,
    user,
    correction_reason: str,
    items_data: list[dict],
    issue_date: date | None = None,
    due_date: date | None = None,
    payment_method: str | None = None,
) -> Invoice:
    """
    Create a draft FV-KOR (correction invoice) linked to ``original_invoice``.

    ``items_data`` is a list of dicts with one of these shapes:
      - Modified line:  {"item_id": "<uuid>", "quantity": ..., "unit_price_net": ..., "vat_rate": ...}
      - Removed line:   {"item_id": "<uuid>", "remove": True}
      - Added line:     {"product_name": ..., "quantity": ..., "unit_price_net": ..., "vat_rate": ...,
                         "product_unit": ""}
    Any original item not referenced in items_data is copied unchanged.
    ``due_date`` and ``payment_method`` override the correction header when provided.
    """
    if original_invoice.status not in (Invoice.STATUS_ISSUED, Invoice.STATUS_SENT, Invoice.STATUS_PAID):
        raise ValidationError(
            {"detail": "Korektę można wystawić tylko do faktury wystawionej, wysłanej lub opłaconej."}
        )

    if not correction_reason or not correction_reason.strip():
        raise ValidationError({"correction_reason": "Powód korekty jest wymagany."})

    resolved_issue = issue_date or timezone.localdate()
    pay_days = getattr(original_invoice.customer, "payment_terms", None) or 14

    resolved_due = due_date if due_date is not None else (resolved_issue + timedelta(days=int(pay_days)))

    resolved_pm = payment_method if payment_method not in (None, "") else original_invoice.payment_method
    if resolved_pm not in dict(Invoice.PAYMENT_METHOD_CHOICES):
        raise ValidationError({"payment_method": "Invalid payment method."})

    correction = Invoice(
        company=company,
        user=user,
        order=original_invoice.order if original_invoice.order_id else None,
        customer=original_invoice.customer,
        delivery_document=original_invoice.delivery_document,
        issue_date=resolved_issue,
        sale_date=original_invoice.sale_date,
        due_date=resolved_due,
        payment_method=resolved_pm,
        status=Invoice.STATUS_DRAFT,
        is_correction=True,
        corrects_invoice=original_invoice,
        correction_reason=correction_reason.strip(),
    )
    correction.save()

    # Assign FV-KOR number now (corrections always get a number on creation)
    from apps.users.models import Company as _Company
    _Company.objects.select_for_update().get(pk=company.pk)
    correction.invoice_number = Invoice._next_invoice_number(
        company.pk, resolved_issue, is_correction=True
    )
    correction.save(update_fields=['invoice_number'])

    # Build lookup by item_id: item_id -> override dict (or {"remove": True})
    override_map: dict[str, dict] = {}
    new_lines: list[dict] = []  # entries without item_id → added lines
    for d in items_data:
        if "item_id" in d:
            override_map[str(d["item_id"])] = d
        else:
            new_lines.append(d)

    # Copy / modify / remove original lines
    for orig_item in original_invoice.items.all().select_related("product"):
        override = override_map.get(str(orig_item.id), {})
        is_removed = bool(override.get("remove", False))

        qty = Decimal(str(orig_item.quantity))
        price = Decimal(str(orig_item.unit_price_net))
        vat = orig_item.vat_rate

        if not is_removed:
            if "quantity" in override and override["quantity"] not in (None, ""):
                qty = Decimal(str(override["quantity"]))
            if "unit_price_net" in override and override["unit_price_net"] not in (None, ""):
                price = Decimal(str(override["unit_price_net"]))
            if "vat_rate" in override and override["vat_rate"] not in (None, ""):
                vat = Decimal(str(override["vat_rate"]))

        InvoiceItem.objects.create(
            invoice=correction,
            order_item=orig_item.order_item,
            product=orig_item.product,
            product_name=orig_item.product_name,
            product_unit=orig_item.product_unit,
            pkwiu=orig_item.pkwiu,
            quantity=qty,
            unit_price_net=price,
            vat_rate=vat,
            is_removed=is_removed,
        )

    # Append added lines (no link to original items)
    for new_line in new_lines:
        qty = Decimal(str(new_line.get("quantity", "1")))
        price = Decimal(str(new_line.get("unit_price_net", "0")))
        vat = Decimal(str(new_line.get("vat_rate", "23")))
        InvoiceItem.objects.create(
            invoice=correction,
            order_item=None,
            product=None,
            product_name=str(new_line.get("product_name", "")).strip(),
            product_unit=str(new_line.get("product_unit", "")).strip(),
            pkwiu="",
            quantity=qty,
            unit_price_net=price,
            vat_rate=vat,
            is_removed=False,
        )

    recalculate_invoice_totals(correction)
    correction.save(
        update_fields=["subtotal_net", "subtotal_gross", "vat_amount", "total_gross", "updated_at"]
    )
    return correction


def get_period_preview_from_orders(
    *, customer, company, date_from: date, date_to: date
) -> list[dict]:
    """
    Aggregate OrderItems per product for a customer in [date_from, date_to].
    Returns a list of dicts suitable for use as manual invoice items.
    """
    orders = Order.objects.filter(
        company=company,
        customer=customer,
        delivery_date__range=[date_from, date_to],
        status__in=list(_ORDER_STATUSES_INVOICEABLE),
    ).prefetch_related("items__product")

    returns_mode = getattr(company, "invoice_returns_mode", "fv_kor")
    product_map: dict[str, dict] = {}
    for order in orders:
        for oi in order.items.all():
            qty = billable_quantity(oi, returns_mode=returns_mode)
            if qty <= 0:
                continue
            key = str(oi.product_id) if oi.product_id else (oi.product_name or "")
            if key in product_map:
                product_map[key]["qty"] += qty
            else:
                product_name = oi.product_name or ""
                product_unit = oi.product_unit or ""
                if oi.product_id:
                    product_name = product_name or oi.product.name
                    product_unit = product_unit or (oi.product.unit or "")
                product_map[key] = {
                    "product_id": str(oi.product_id) if oi.product_id else None,
                    "product_name": product_name,
                    "product_unit": product_unit,
                    "qty": qty,
                    "unit_price_net": oi.unit_price_net,
                    "vat_rate": oi.vat_rate,
                }

    result = []
    for entry in product_map.values():
        result.append({
            **entry,
            "qty": str(entry["qty"]),
            "unit_price_net": str(entry["unit_price_net"]),
            "vat_rate": str(entry["vat_rate"]),
        })
    return result


def get_period_preview_from_wz(
    *, customer, company, date_from: date, date_to: date
) -> list[dict]:
    """
    Aggregate DeliveryItem.quantity_actual - quantity_returned per product
    across WZ documents for a customer in [date_from, date_to].
    Returns a list of dicts suitable for use as manual invoice items.
    """
    wz_docs = DeliveryDocument.objects.filter(
        company=company,
        to_customer=customer,
        document_type=DeliveryDocument.DOC_TYPE_WZ,
        status=DeliveryDocument.STATUS_DELIVERED,
        issue_date__range=[date_from, date_to],
    ).prefetch_related("items__product")

    product_map: dict[str, dict] = {}
    for wz in wz_docs:
        for item in wz.items.all():
            qty_actual = item.quantity_actual or Decimal("0")
            qty_returned = item.quantity_returned or Decimal("0")
            qty = max(qty_actual - qty_returned, Decimal("0"))
            if qty <= 0:
                continue
            # DeliveryItem.product is always required (non-nullable FK)
            key = str(item.product_id)
            if key in product_map:
                product_map[key]["qty"] += qty
            else:
                product_map[key] = {
                    "product_id": str(item.product_id),
                    "product_name": item.product.name,
                    "product_unit": item.product.unit or "",
                    "qty": qty,
                    "unit_price_net": item.unit_cost or Decimal("0"),
                    "vat_rate": item.product.vat_rate if item.product.vat_rate is not None else Decimal("23"),
                }

    result = []
    for entry in product_map.values():
        result.append({
            **entry,
            "qty": str(entry["qty"]),
            "unit_price_net": str(entry["unit_price_net"]),
            "vat_rate": str(entry["vat_rate"]),
        })
    return result


def _fmt_money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01')):.2f}"


def _fk_uuid(obj) -> str | None:
    return str(obj.uuid) if obj is not None else None


def _serialize_invoice_full(invoice: Invoice) -> dict:
    """All `Invoice` DB fields as JSON-friendly scalars (amounts as formatted strings)."""
    return {
        "id": str(invoice.uuid),
        "company": str(invoice.company.uuid),
        "user": _fk_uuid(invoice.user if invoice.user_id else None),
        "order": str(invoice.order.uuid) if invoice.order_id else None,
        "customer": str(invoice.customer.uuid),
        "delivery_document": _fk_uuid(invoice.delivery_document if invoice.delivery_document_id else None),
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
        unit_price_gross = (it.unit_price_net * (1 + it.vat_rate / 100)).quantize(
            Decimal("0.01")
        )
        line_rows.append(
            {
                "position": idx,
                "product_name": it.product_name,
                "product_unit": it.product_unit,
                "pkwiu": it.pkwiu or "",
                "quantity": str(it.quantity),
                "quantity_display": _fmt_money(it.quantity),
                "unit_price_net": _fmt_money(it.unit_price_net),
                "unit_price_gross": _fmt_money(unit_price_gross),
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
            "unit_price_gross": _fmt_money(
                (it.unit_price_net * (1 + it.vat_rate / 100)).quantize(Decimal("0.01"))
            ),
            "vat_rate": _fmt_money(it.vat_rate),
            "line_net": _fmt_money(it.line_net),
            "line_vat": _fmt_money(it.line_vat),
            "line_gross": _fmt_money(it.line_gross),
        }
        for it in items
    ]

    # Collect WZ document numbers linked via InvoiceOrder M2M
    wz_nums: list[str] = []
    if invoice.show_wz_numbers:
        from apps.delivery.models import DeliveryDocument
        order_ids = list(invoice.invoice_orders.values_list("order_id", flat=True))
        if order_ids:
            wz_qs = DeliveryDocument.objects.filter(
                order_id__in=order_ids,
                document_type=DeliveryDocument.DOC_TYPE_WZ,
            ).values_list("document_number", flat=True).order_by("issue_date")
            wz_nums = [n for n in wz_qs if n]

    invoice_block = {
        **_serialize_invoice_full(invoice),
        "order_number": invoice.order.order_number if invoice.order_id else "",
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
        "wz_numbers": wz_nums,
        "show_wz_numbers": invoice.show_wz_numbers,
    }

    return {
        "meta": {
            "title": f"Invoice {invoice.invoice_number or ''}".strip(),
            "currency": "PLN",
            "locale": "pl-PL",
            "prices_include_vat": invoice.prices_include_vat,
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

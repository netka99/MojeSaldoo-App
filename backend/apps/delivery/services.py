"""Business logic for delivery documents (decoupled from HTTP layer)."""

import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.orders.models import Order, OrderItem
from apps.products.models import Product, ProductStock, StockMovement, Warehouse

from .models import DeliveryDocument, DeliveryItem


def active_main_warehouse_for_company(company_id):
    """First active main warehouse for the company (by code), or ``None``."""
    return (
        Warehouse.objects.filter(
            company_id=company_id,
            warehouse_type=Warehouse.WarehouseType.MAIN,
            is_active=True,
        )
        .order_by("code")
        .first()
    )


def active_mobile_warehouse_for_company(company_id):
    """First active mobile (van) warehouse for the company (by code), or ``None``."""
    return (
        Warehouse.objects.filter(
            company_id=company_id,
            warehouse_type=Warehouse.WarehouseType.MOBILE,
            is_active=True,
        )
        .order_by("code")
        .first()
    )


def default_from_warehouse_for_delivery(company_id):
    """Prefer active van/mobile warehouse so WZ completion deducts from the van after loading; else main MG."""
    return active_mobile_warehouse_for_company(
        company_id
    ) or active_main_warehouse_for_company(company_id)


def generate_delivery_from_order(order: Order, user=None) -> DeliveryDocument:
    """
    Build a draft WZ for a **confirmed** order: one ``DeliveryItem`` per ``OrderItem``,
    with ``quantity_planned`` equal to the order line's ordered ``quantity``.

    :param order: Must have ``status == confirmed``.
    :param user: Optional creator/audit user for the document.
    :raises ValueError: if the order is not confirmed.
    """
    if order.status != Order.STATUS_CONFIRMED:
        raise ValueError("Order must be confirmed to generate a delivery document.")

    with transaction.atomic():
        doc = DeliveryDocument.objects.create(
            company=order.company,
            order=order,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=timezone.localdate(),
            to_customer=order.customer,
            from_warehouse=default_from_warehouse_for_delivery(order.company_id),
            status=DeliveryDocument.STATUS_DRAFT,
        )
        for oi in order.items.select_related("product"):
            DeliveryItem.objects.create(
                delivery_document=doc,
                order_item=oi,
                product=oi.product,
                quantity_planned=oi.quantity,
            )

    doc.refresh_from_db()
    return doc


def _deduct_from_main_for_van_loading(
    st: ProductStock,
    qty: Decimal,
    *,
    allow_negative_stock: bool,
) -> tuple[Decimal, Decimal]:
    """
    Remove ``qty`` from main MG stock: decrement ``quantity_available`` first,
    then ``quantity_reserved``. Legacy behavior: if negative stock allowed and still short,
    the remainder is taken from available (possibly below zero).
    Returns ``(quantity_total before, quantity_total after)``.
    """
    total_before = st.quantity_available + st.quantity_reserved
    remainder = qty
    take_a = min(st.quantity_available, remainder)
    st.quantity_available -= take_a
    remainder -= take_a
    take_r = min(st.quantity_reserved, remainder)
    st.quantity_reserved -= take_r
    remainder -= take_r
    if remainder > 0:
        if allow_negative_stock:
            st.quantity_available -= remainder
        else:
            raise AssertionError("van loading: insufficient stock after availability check")
    st.save(update_fields=["quantity_available", "quantity_reserved"])
    total_after = st.quantity_available + st.quantity_reserved
    return total_before, total_after


def create_van_loading_mm(
    *,
    company_id,
    user,
    from_warehouse: Warehouse,
    to_warehouse: Warehouse,
    items: list[dict],
    issue_date=None,
    driver_name: str = "",
    notes: str = "",
) -> DeliveryDocument:
    """
    Create an MM document (main → mobile), lines without ``order_item``, and move stock:
    MG total (available + reserved) decreases; mobile ``quantity_available`` increases.
    """
    if from_warehouse.company_id != company_id or to_warehouse.company_id != company_id:
        raise ValidationError("Warehouses must belong to your company.")
    if from_warehouse.warehouse_type != Warehouse.WarehouseType.MAIN:
        raise ValidationError(
            {"from_warehouse_id": "Source warehouse must be a main warehouse (MG)."}
        )
    if to_warehouse.warehouse_type != Warehouse.WarehouseType.MOBILE:
        raise ValidationError(
            {"to_warehouse_id": "Destination warehouse must be a mobile warehouse (van)."}
        )
    if from_warehouse.id == to_warehouse.id:
        raise ValidationError("Source and destination warehouses must differ.")

    if not items:
        raise ValidationError({"items": "At least one line is required."})

    product_ids = [row["product_id"] for row in items]
    if len(product_ids) != len(set(product_ids)):
        raise ValidationError({"items": "Duplicate product_id in items is not allowed."})

    allow_negative = bool(from_warehouse.allow_negative_stock)

    with transaction.atomic():
        products = {
            str(p.id): p
            for p in Product.objects.filter(company_id=company_id, id__in=product_ids)
        }
        missing = [str(pid) for pid in product_ids if str(pid) not in products]
        if missing:
            raise ValidationError({"items": f"Unknown or invalid product_id(s): {missing}."})

        qty_by_product = {str(row["product_id"]): Decimal(row["quantity"]) for row in items}

        stocks_from = {}
        for pid in product_ids:
            st, _ = (
                ProductStock.objects.select_for_update()
                .get_or_create(
                    company_id=company_id,
                    product_id=pid,
                    warehouse_id=from_warehouse.id,
                    defaults={
                        "quantity_available": Decimal("0"),
                        "quantity_reserved": Decimal("0"),
                        "quantity_total": Decimal("0"),
                    },
                )
            )
            stocks_from[str(pid)] = st

        stocks_to = {}
        for pid in product_ids:
            st, _ = (
                ProductStock.objects.select_for_update()
                .get_or_create(
                    company_id=company_id,
                    product_id=pid,
                    warehouse_id=to_warehouse.id,
                    defaults={
                        "quantity_available": Decimal("0"),
                        "quantity_reserved": Decimal("0"),
                        "quantity_total": Decimal("0"),
                    },
                )
            )
            stocks_to[str(pid)] = st

        shortfalls = []
        for pid, need in qty_by_product.items():
            st = stocks_from[pid]
            total_at = st.quantity_available + st.quantity_reserved
            if not allow_negative and total_at < need:
                shortfalls.append(
                    {
                        "product_id": pid,
                        "product_name": products[pid].name,
                        "quantity_available": str(st.quantity_available),
                        "quantity_reserved": str(st.quantity_reserved),
                        "quantity_requested": str(need),
                    }
                )
        if shortfalls:
            raise ValidationError({"stock": shortfalls})

        doc = DeliveryDocument.objects.create(
            company_id=company_id,
            order=None,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_MM,
            issue_date=issue_date or timezone.localdate(),
            from_warehouse=from_warehouse,
            to_warehouse=to_warehouse,
            to_customer=None,
            status=DeliveryDocument.STATUS_SAVED,
            driver_name=driver_name or "",
            notes=notes or "",
        )

        for pid, qty in qty_by_product.items():
            product = products[pid]
            DeliveryItem.objects.create(
                delivery_document=doc,
                order_item=None,
                product=product,
                quantity_planned=qty,
            )

            st_out = stocks_from[pid]
            qty_before_total, qty_after_total = _deduct_from_main_for_van_loading(
                st_out,
                qty,
                allow_negative_stock=allow_negative,
            )
            StockMovement.objects.create(
                company_id=company_id,
                product_id=product.id,
                warehouse_id=from_warehouse.id,
                user=user,
                movement_type=StockMovement.MovementType.TRANSFER,
                quantity=-qty,
                quantity_before=qty_before_total,
                quantity_after=qty_after_total,
                reference_type="delivery",
                reference_id=doc.id,
                notes="Van loading (MM out)",
                created_by=user,
            )

            st_in = stocks_to[pid]
            qty_before_in = st_in.quantity_available
            st_in.quantity_available += qty
            st_in.save(update_fields=["quantity_available"])
            StockMovement.objects.create(
                company_id=company_id,
                product_id=product.id,
                warehouse_id=to_warehouse.id,
                user=user,
                movement_type=StockMovement.MovementType.TRANSFER,
                quantity=qty,
                quantity_before=qty_before_in,
                quantity_after=st_in.quantity_available,
                reference_type="delivery",
                reference_id=doc.id,
                notes="Van loading (MM in)",
                created_by=user,
            )

    doc.refresh_from_db()
    return doc


def apply_van_reconciliation(
    *,
    company_id,
    user,
    van_warehouse: Warehouse,
    items: list[dict],
) -> dict:
    """
    End-of-day van count: compare physical ``quantity_actual_remaining`` to system total
    on the mobile warehouse (``quantity_available`` + ``quantity_reserved``). Writes
    movements: ``damage`` when actual < expected, ``adjustment`` when actual > expected.
    """
    if van_warehouse.company_id != company_id:
        raise ValidationError("Warehouse must belong to your company.")
    if van_warehouse.warehouse_type != Warehouse.WarehouseType.MOBILE:
        raise ValidationError(
            {"van_warehouse_id": "Warehouse must be a mobile (van) warehouse."}
        )

    if not items:
        return {
            "van_warehouse_id": str(van_warehouse.id),
            "reconciliation_id": None,
            "reconciled_at": timezone.now().isoformat(),
            "discrepancies": [],
            "items_processed": 0,
        }

    product_ids = [row["product_id"] for row in items]
    if len(product_ids) != len(set(product_ids)):
        raise ValidationError(
            {"items": "Duplicate product_id in items is not allowed."}
        )

    run_id = uuid.uuid4()
    reconciled_at = timezone.now()
    discrepancies: list[dict] = []

    with transaction.atomic():
        products = {
            str(p.id): p
            for p in Product.objects.filter(
                company_id=company_id,
                id__in=product_ids,
            )
        }
        missing = [str(pid) for pid in product_ids if str(pid) not in products]
        if missing:
            raise ValidationError(
                {"items": f"Unknown or invalid product_id(s): {missing}."}
            )

        sorted_rows = sorted(items, key=lambda r: str(r["product_id"]))

        for row in sorted_rows:
            product = products[str(row["product_id"])]
            P = row["quantity_actual_remaining"]

            st, _ = ProductStock.objects.select_for_update().get_or_create(
                company_id=company_id,
                product_id=product.id,
                warehouse_id=van_warehouse.id,
                defaults={
                    "quantity_available": Decimal("0"),
                    "quantity_reserved": Decimal("0"),
                    "quantity_total": Decimal("0"),
                },
            )

            A = st.quantity_available
            R = st.quantity_reserved
            T = A + R

            if P == T:
                continue

            R_new = min(R, P)
            A_new = P - R_new
            st.quantity_reserved = R_new
            st.quantity_available = A_new
            st.save(update_fields=["quantity_reserved", "quantity_available"])

            delta_total = P - T
            if delta_total < 0:
                mtype = StockMovement.MovementType.DAMAGE
                disc_type = "damage"
            else:
                mtype = StockMovement.MovementType.ADJUSTMENT
                disc_type = "adjustment"

            StockMovement.objects.create(
                company_id=company_id,
                product_id=product.id,
                warehouse_id=van_warehouse.id,
                user=user,
                movement_type=mtype,
                quantity=delta_total,
                quantity_before=T,
                quantity_after=P,
                reference_type="van_reconciliation",
                reference_id=run_id,
                notes="Van reconciliation",
                created_by=user,
            )

            discrepancies.append(
                {
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "quantity_expected": str(T),
                    "quantity_actual": str(P),
                    "quantity_delta": str(delta_total),
                    "discrepancy_type": disc_type,
                }
            )

    return {
        "van_warehouse_id": str(van_warehouse.id),
        "reconciliation_id": str(run_id),
        "reconciled_at": reconciled_at.isoformat(),
        "discrepancies": discrepancies,
        "items_processed": len(items),
    }


def _fk_uuid(value) -> str | None:
    return str(value) if value is not None else None


def _fmt_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01')):.2f}"


def _serialize_delivery_document_full(doc: DeliveryDocument) -> dict:
    """All `DeliveryDocument` DB fields as JSON-friendly scalars."""
    return {
        "id": str(doc.id),
        "company": str(doc.company_id),
        "order": _fk_uuid(doc.order_id),
        "user": _fk_uuid(doc.user_id),
        "document_type": doc.document_type,
        "document_number": doc.document_number or "",
        "issue_date": doc.issue_date.isoformat(),
        "from_warehouse": _fk_uuid(doc.from_warehouse_id),
        "to_warehouse": _fk_uuid(doc.to_warehouse_id),
        "to_customer": _fk_uuid(doc.to_customer_id),
        "status": doc.status,
        "has_returns": doc.has_returns,
        "returns_notes": doc.returns_notes or "",
        "driver_name": doc.driver_name or "",
        "receiver_name": doc.receiver_name or "",
        "delivered_at": (
            doc.delivered_at.isoformat() if doc.delivered_at else None
        ),
        "notes": doc.notes or "",
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }


def _preview_customer_party(doc: DeliveryDocument) -> dict:
    """Recipient for print: `to_customer`, else order's customer."""
    cust = doc.to_customer
    if cust is None and doc.order_id:
        order = doc.order
        if order is not None:
            cust = order.customer
    if cust is None:
        return {"name": "", "nip": "", "address": ""}
    name = (cust.company_name or cust.name or "").strip()
    return {
        "name": name,
        "nip": cust.nip or "",
        "address": (cust.street or "") or "",
    }


def build_delivery_document_preview_data(doc: DeliveryDocument) -> dict:
    """Structured payload for WZ / delivery document print or PDF."""
    company = doc.company
    document_block = _serialize_delivery_document_full(doc)
    company_block = {
        "name": company.name,
        "nip": company.nip or "",
        "address": (company.address or "").strip(),
    }
    customer_block = _preview_customer_party(doc)

    from_wh = doc.from_warehouse
    from_warehouse = None
    if from_wh is not None:
        from_warehouse = {"name": from_wh.name, "code": from_wh.code}

    items_out = []
    for it in doc.items.all().order_by("created_at"):
        product = it.product
        items_out.append(
            {
                "product_name": product.name,
                "quantity_planned": _fmt_decimal(it.quantity_planned),
                "quantity_actual": (
                    None
                    if it.quantity_actual is None
                    else _fmt_decimal(it.quantity_actual)
                ),
                "quantity_returned": _fmt_decimal(it.quantity_returned),
                "unit": product.unit or "",
            }
        )

    return {
        "document": document_block,
        "company": company_block,
        "customer": customer_block,
        "from_warehouse": from_warehouse,
        "items": items_out,
    }


def _delivery_effective_actual(item: DeliveryItem) -> Decimal:
    """Same interpretation as completion: fallback to planned when actual unset."""
    if item.quantity_actual is not None:
        return item.quantity_actual
    return item.quantity_planned


def _apply_sale_return_deltas_to_stock(
    *,
    company_id,
    warehouse_id,
    product_id,
    product_name: str,
    delta_sale: Decimal,
    delta_return: Decimal,
    movement_user,
    created_by,
    doc_id,
) -> None:
    """
    Apply increments to reserved (sale) and available (returns) like ``complete()``,
    and emit matching ``StockMovement`` rows. ``delta_sale`` is (new_actual - old_actual)
    (positive = ship more from reserved); ``delta_return`` is (new_return - old_return).
    """
    if delta_sale == Decimal("0") and delta_return == Decimal("0"):
        return

    try:
        st = ProductStock.objects.select_for_update().get(
            company_id=company_id,
            product_id=product_id,
            warehouse_id=warehouse_id,
        )
    except ProductStock.DoesNotExist:
        raise ValidationError(
            {
                "stock": [
                    {
                        "product_id": str(product_id),
                        "product_name": product_name,
                        "detail": (
                            "No ProductStock for this product at from_warehouse "
                            "(cannot reconcile)."
                        ),
                    }
                ]
            }
        )

    if delta_sale != Decimal("0"):
        qty_before_avail = st.quantity_available
        st.quantity_reserved -= delta_sale
        if st.quantity_reserved < 0:
            raise ValidationError(
                {
                    "stock": (
                        "Insufficient quantity_reserved for this correction "
                        f"(product {product_name})."
                    ),
                },
            )
        st.save(update_fields=["quantity_reserved"])
        StockMovement.objects.create(
            company_id=company_id,
            product_id=product_id,
            warehouse_id=warehouse_id,
            user=movement_user,
            movement_type=StockMovement.MovementType.SALE,
            quantity=-delta_sale,
            quantity_before=qty_before_avail,
            quantity_after=st.quantity_available,
            reference_type="delivery_correction",
            reference_id=doc_id,
            created_by=created_by,
        )

    if delta_return != Decimal("0"):
        qty_before_avail_ret = st.quantity_available
        st.quantity_available += delta_return
        st.save(update_fields=["quantity_available"])
        StockMovement.objects.create(
            company_id=company_id,
            product_id=product_id,
            warehouse_id=warehouse_id,
            user=movement_user,
            movement_type=StockMovement.MovementType.RETURN,
            quantity=delta_return,
            quantity_before=qty_before_avail_ret,
            quantity_after=st.quantity_available,
            reference_type="delivery_correction",
            reference_id=doc_id,
            created_by=created_by,
        )


@transaction.atomic
def apply_delivery_document_line_updates(
    *,
    doc: DeliveryDocument,
    items_payload: list[dict],
    user,
) -> DeliveryDocument:
    """
    Update delivery line quantities and notes. Before delivery this only updates rows.
    After delivery (`status == delivered`), adjusts ``OrderItem`` and stock for deltas.
    """
    if doc.is_locked_by_invoice():
        raise ValidationError(
            {"detail": "Delivery document is linked to an invoice and cannot be changed."}
        )
    if doc.status == DeliveryDocument.STATUS_CANCELLED:
        raise ValidationError({"detail": "Cancelled documents cannot be changed."})

    doc = (
        DeliveryDocument.objects.select_for_update()
        .select_related("company", "order", "from_warehouse", "user")
        .prefetch_related("items__order_item", "items__product")
        .get(pk=doc.pk)
    )

    if doc.is_locked_by_invoice():
        raise ValidationError(
            {"detail": "Delivery document is linked to an invoice and cannot be changed."}
        )

    payload_by_id = {str(row["id"]): row for row in items_payload}

    movement_user = doc.user if doc.user_id else user

    items_now = list(doc.items.select_related("order_item", "product"))

    valid_ids = {str(i.id) for i in items_now}
    extra = set(payload_by_id) - valid_ids
    if extra:
        raise ValidationError(
            {"items": f"Unknown delivery item id(s): {', '.join(sorted(extra))}."}
        )

    for item in items_now:
        row = payload_by_id.get(str(item.id))
        if not row:
            continue

        old_act_eff = _delivery_effective_actual(item)
        old_ret = item.quantity_returned or Decimal("0")

        if "quantity_planned" in row and row["quantity_planned"] is not None:
            item.quantity_planned = row["quantity_planned"]
        if "quantity_actual" in row:
            item.quantity_actual = row["quantity_actual"]
        if "quantity_returned" in row:
            rw = row["quantity_returned"]
            item.quantity_returned = Decimal("0") if rw is None else rw
        if "return_reason" in row:
            item.return_reason = (row.get("return_reason") or "").strip()
        if "is_damaged" in row:
            item.is_damaged = bool(row["is_damaged"])
        if "notes" in row:
            item.notes = (row.get("notes") or "").strip()

        new_act_eff = _delivery_effective_actual(item)
        new_ret = item.quantity_returned or Decimal("0")

        if new_ret < 0 or new_act_eff < 0:
            raise ValidationError({"items": "Quantities cannot be negative."})
        if new_ret > new_act_eff:
            raise ValidationError(
                {"items": f"quantity_returned cannot exceed quantity for item {item.id}."}
            )

        if doc.status != DeliveryDocument.STATUS_DELIVERED:
            item.save()
            continue

        delta_sale = new_act_eff - old_act_eff
        delta_return = new_ret - old_ret

        if delta_sale == Decimal("0") and delta_return == Decimal("0"):
            item.save()
            continue

        if doc.from_warehouse_id is None:
            raise ValidationError(
                {
                    "from_warehouse": (
                        "Delivery document has no source warehouse; "
                        "cannot reconcile stock lines."
                    )
                },
            )

        sold_old = old_act_eff - old_ret
        sold_new = new_act_eff - new_ret

        if item.order_item_id:
            oi = OrderItem.objects.select_for_update().get(pk=item.order_item_id)
            tentative_delivered = (
                (oi.quantity_delivered or Decimal("0")) - sold_old + sold_new
            )
            tentative_returned_line = (
                (oi.quantity_returned or Decimal("0")) - old_ret + new_ret
            )
            if tentative_delivered < 0:
                raise ValidationError(
                    {
                        "items": (
                            "Order line update would drive delivered quantity negative "
                            f"({oi.id})."
                        ),
                    },
                )
            if tentative_delivered > oi.quantity:
                raise ValidationError(
                    {
                        "items": (
                            f"Order line {oi.id} would exceed ordered quantity "
                            f"({tentative_delivered} > {oi.quantity})."
                        ),
                    },
                )

            oi.quantity_delivered = tentative_delivered
            oi.quantity_returned = tentative_returned_line
            oi.save(update_fields=["quantity_delivered", "quantity_returned"])

        _apply_sale_return_deltas_to_stock(
            company_id=doc.company_id,
            warehouse_id=doc.from_warehouse_id,
            product_id=item.product_id,
            product_name=item.product.name if item.product_id else "",
            delta_sale=delta_sale,
            delta_return=delta_return,
            movement_user=movement_user,
            created_by=user,
            doc_id=doc.id,
        )

        item.save()

    doc.user = user
    doc.save(update_fields=["user", "updated_at"])
    doc.refresh_from_db()

    if doc.order_id and doc.status == DeliveryDocument.STATUS_DELIVERED:
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

    return doc


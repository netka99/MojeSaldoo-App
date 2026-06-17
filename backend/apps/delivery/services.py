"""Business logic for delivery documents (decoupled from HTTP layer)."""

import uuid
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.orders.models import Order, OrderItem
from apps.products.models import Product, ProductStock, StockBatch, StockMovement, Warehouse


def _recalculate_product_avg_cost(product: Product, new_unit_cost, new_qty: Decimal) -> None:
    """
    Update product.avg_cost using a running weighted average after a PZ receipt.

    Formula: new_avg = (old_avg * old_total_stock + new_cost * new_qty) / (old_total_stock + new_qty)
    Falls back to new_unit_cost when there is no prior cost data.
    """
    if new_unit_cost is None or new_qty <= Decimal("0"):
        return

    total_stock = (
        ProductStock.objects.filter(company_id=product.company_id, product=product)
        .aggregate(total=Sum("quantity_available"))["total"]
        or Decimal("0")
    )
    # total_stock already includes the newly added qty (stock was updated before this call)
    prior_stock = total_stock - new_qty

    if prior_stock > Decimal("0") and product.avg_cost is not None:
        new_avg = (
            product.avg_cost * prior_stock + new_unit_cost * new_qty
        ) / total_stock
    else:
        new_avg = new_unit_cost

    product.avg_cost = new_avg.quantize(Decimal("0.0001"))
    product.avg_cost_source = Product.COST_SOURCE_PZ
    product.last_cost = new_unit_cost.quantize(Decimal("0.0001"))
    product.avg_cost_updated_at = timezone.now()
    product.save(update_fields=["avg_cost", "avg_cost_source", "last_cost", "avg_cost_updated_at"])

from .models import DeliveryDocument, DeliveryItem


def _deduct_fifo_batches(
    company_id,
    product_id,
    warehouse_id,
    quantity: Decimal,
) -> None:
    """
    Walk StockBatch FIFO (oldest received_date first) and decrement
    quantity_remaining to reflect a stock outflow from a WZ or MM document.

    Called after ProductStock has already been updated and stock availability
    has been validated — so we do not raise if batches don't fully cover the
    quantity (e.g. products with track_batches=False have no batches at all).
    """
    if quantity <= Decimal("0"):
        return
    remaining = quantity
    batches = list(
        StockBatch.objects.select_for_update()
        .filter(
            company_id=company_id,
            product_id=product_id,
            warehouse_id=warehouse_id,
            quantity_remaining__gt=0,
        )
        .order_by("received_date", "id")
    )
    for batch in batches:
        if remaining <= Decimal("0"):
            break
        take = min(batch.quantity_remaining, remaining)
        batch.quantity_remaining -= take
        batch.save(update_fields=["quantity_remaining"])
        remaining -= take


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


def apply_pz_receipt(pz_document: "DeliveryDocument", user) -> None:
    """
    Finalize a PZ (Przyjęcie Zewnętrzne) document: increase stock, create FIFO batches,
    record StockMovement(PURCHASE) for every line with quantity_actual > 0.

    Must be called inside or after the status transition to STATUS_DELIVERED.
    Runs in its own atomic block — caller should NOT wrap in a separate atomic
    unless they want to share the same transaction (both are safe).

    Rules:
    - to_warehouse  = warehouse receiving the goods (required).
    - quantity_actual per line = quantity actually received (falls back to
      quantity_planned when quantity_actual is NULL — e.g. draft PZ closed as-is).
    - unit_cost per line = purchase price net/unit; stored on StockBatch.
    - If product.track_batches is True, a StockBatch is created per line.
    - StockMovement(PURCHASE) is always created (even for products without batches).
    - Lines with effective quantity == 0 are silently skipped.
    """
    if pz_document.document_type != DeliveryDocument.DOC_TYPE_PZ:
        raise ValueError(
            f"apply_pz_receipt() called on document type '{pz_document.document_type}'; "
            "expected 'PZ'."
        )
    if pz_document.status != DeliveryDocument.STATUS_DELIVERED:
        raise ValueError(
            f"apply_pz_receipt() called on status '{pz_document.status}'; "
            "expected 'delivered'."
        )

    warehouse = pz_document.to_warehouse
    if warehouse is None:
        raise ValidationError(
            {"to_warehouse": f"PZ {pz_document.document_number} has no destination warehouse."}
        )

    company_id = pz_document.company_id
    issue_date = pz_document.issue_date or timezone.localdate()
    supplier_label = (
        pz_document.from_supplier.name
        if pz_document.from_supplier_id
        else ""
    )
    doc_label = pz_document.document_number or str(pz_document.id)

    with transaction.atomic():
        items = list(
            pz_document.items.select_related("product").select_for_update()
        )

        for idx, item in enumerate(items, start=1):
            # Effective received quantity: use actual if set, else planned
            received_qty = (
                item.quantity_actual
                if item.quantity_actual is not None
                else item.quantity_planned
            )
            if received_qty <= Decimal("0"):
                continue

            product = item.product

            # ── 1. Update ProductStock ────────────────────────────────────────
            stock, _ = ProductStock.objects.select_for_update().get_or_create(
                company_id=company_id,
                product=product,
                warehouse=warehouse,
                defaults={
                    "quantity_available": Decimal("0"),
                    "quantity_reserved": Decimal("0"),
                    "quantity_total": Decimal("0"),
                },
            )
            qty_before = stock.quantity_available
            stock.quantity_available += received_qty
            stock.save(update_fields=["quantity_available"])

            # ── 2. Create StockBatch (FIFO) if product tracks batches ─────────
            if product.track_batches:
                batch_number = f"{doc_label}/{idx:02d}"
                StockBatch.objects.create(
                    company_id=company_id,
                    product=product,
                    warehouse=warehouse,
                    batch_number=batch_number,
                    received_date=issue_date,
                    expiry_date=item.expiry_date,
                    quantity_initial=received_qty,
                    quantity_remaining=received_qty,
                    unit_cost=(
                        item.unit_cost.quantize(Decimal("0.01"))
                        if item.unit_cost is not None
                        else None
                    ),
                )

            # ── 3. Record StockMovement(PURCHASE) ────────────────────────────
            notes_parts = [f"Przyjęcie PZ {doc_label}"]
            if supplier_label:
                notes_parts.append(f"od {supplier_label}")
            StockMovement.objects.create(
                company_id=company_id,
                product=product,
                warehouse=warehouse,
                user=user,
                movement_type=StockMovement.MovementType.PURCHASE,
                quantity=received_qty,
                quantity_before=qty_before,
                quantity_after=stock.quantity_available,
                reference_type="delivery_document",
                reference_id=pz_document.id,
                notes=", ".join(notes_parts),
                created_by=user,
            )

            # ── 4. Update Product.avg_cost / last_cost ────────────────────────
            _recalculate_product_avg_cost(product, item.unit_cost, received_qty)


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
        # For order-based WZ, default to the main warehouse — stock was reserved there
        # when the order was confirmed. Van users load via MM first and the WZ
        # from_warehouse gets updated at that point.
        from_wh = active_main_warehouse_for_company(order.company_id)
        doc = DeliveryDocument.objects.create(
            company=order.company,
            order=order,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            issue_date=timezone.localdate(),
            to_customer=order.customer,
            from_warehouse=from_wh,
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
    van_route=None,
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
            van_route=van_route,
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
                notes="Załadunek MM — wydanie z magazynu",
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
                notes="Załadunek MM — przyjęcie na van",
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
    main_warehouse: Warehouse | None = None,
    route=None,
) -> dict:
    """
    Route closure reconciliation — proper document trail per Polish accounting rules:

    1. MM-P  (van → MG): created for every product with ``quantity_actual_remaining > 0``.
               Moves physical returns back to the main warehouse.
    2. DAMAGE movement: for each product where physical count < system remaining
               (shortage — loss, damage, theft).
    3. ADJUSTMENT movement: for each product where physical count > system remaining
               (overage — should be rare).
    4. Van stock zeroed out.

    ``main_warehouse``: MG that receives the return MM-P. Falls back to the first active
    main warehouse for the company if not supplied.
    ``route``: optional VanRoute — linked to the MM-P document's notes for traceability.
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
            "mm_return_number": None,
            "reconciled_at": timezone.now().isoformat(),
            "discrepancies": [],
            "items_processed": 0,
        }

    # Resolve main warehouse for MM-P (only needed when there are items to process)
    if main_warehouse is None:
        main_warehouse = active_main_warehouse_for_company(company_id)
    if main_warehouse is None:
        raise ValidationError(
            {"main_warehouse": "No active main warehouse found. Cannot create MM-P return document."}
        )

    product_ids = [row["product_id"] for row in items]
    if len(product_ids) != len(set(product_ids)):
        raise ValidationError({"items": "Duplicate product_id in items is not allowed."})

    run_id = uuid.uuid4()
    reconciled_at = timezone.now()
    discrepancies: list[dict] = []
    summary_items: list[dict] = []
    mm_return_doc = None

    with transaction.atomic():
        products = {
            str(p.id): p
            for p in Product.objects.filter(company_id=company_id, id__in=product_ids)
        }
        missing = [str(pid) for pid in product_ids if str(pid) not in products]
        if missing:
            raise ValidationError({"items": f"Unknown or invalid product_id(s): {missing}."})

        sorted_rows = sorted(items, key=lambda r: str(r["product_id"]))

        # Collect van stock and compute per-product plan
        van_stocks: dict[str, ProductStock] = {}
        for row in sorted_rows:
            pid = str(row["product_id"])
            st, _ = ProductStock.objects.select_for_update().get_or_create(
                company_id=company_id,
                product_id=row["product_id"],
                warehouse_id=van_warehouse.id,
                defaults={
                    "quantity_available": Decimal("0"),
                    "quantity_reserved": Decimal("0"),
                    "quantity_total": Decimal("0"),
                },
            )
            van_stocks[pid] = st

        # ── 1. Create MM-P document (van → MG) for physical returns ──────────
        return_lines = [
            row for row in sorted_rows
            if row["quantity_actual_remaining"] > Decimal("0")
        ]

        route_note = f" (trasa {route.id})" if route else ""
        mm_return_doc = DeliveryDocument.objects.create(
            company_id=company_id,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_MM,
            issue_date=timezone.localdate(),
            from_warehouse=van_warehouse,
            to_warehouse=main_warehouse,
            driver_name=route.driver_name if route else "",
            notes=f"MM-P — zwrot towaru z vana do magazynu{route_note}",
            status=DeliveryDocument.STATUS_DELIVERED,
            van_route=route,
        )

        for row in return_lines:
            pid = str(row["product_id"])
            DeliveryItem.objects.create(
                delivery_document=mm_return_doc,
                product_id=row["product_id"],
                quantity_planned=row["quantity_actual_remaining"],
                quantity_actual=row["quantity_actual_remaining"],
            )

        # ── 1b. Create RW document for write-offs (damage) ───────────────────
        writeoff_lines = [
            row for row in sorted_rows
            if row.get("quantity_writeoff") is not None and row["quantity_writeoff"] > Decimal("0")
        ]

        rw_doc = None
        if writeoff_lines:
            rw_doc = DeliveryDocument.objects.create(
                company_id=company_id,
                user=user,
                document_type=DeliveryDocument.DOC_TYPE_RW,
                issue_date=timezone.localdate(),
                from_warehouse=van_warehouse,
                to_warehouse=None,
                notes=f"RW — odpisanie towaru z vana{route_note}",
                status=DeliveryDocument.STATUS_DELIVERED,
                van_route=route,
            )
            for row in writeoff_lines:
                DeliveryItem.objects.create(
                    delivery_document=rw_doc,
                    product_id=row["product_id"],
                    quantity_planned=row["quantity_writeoff"],
                    quantity_actual=row["quantity_writeoff"],
                )

        # ── 2. Process each product — discrepancies + stock movements ─────────
        for row in sorted_rows:
            pid = str(row["product_id"])
            product = products[pid]
            P = row["quantity_actual_remaining"]   # quantity returned to MG
            W_raw = row.get("quantity_writeoff")   # None = legacy mode
            explicit_mode = W_raw is not None      # True = caller specified exact split
            W = W_raw if W_raw is not None else Decimal("0")
            st = van_stocks[pid]
            A = st.quantity_available
            T = A + st.quantity_reserved            # total system stock on van (before changes)

            # Build per-product summary (returned / kept / written_off)
            kept = max(Decimal("0"), T - P - W)
            if P > Decimal("0"):
                summary_items.append({
                    "action": "returned",
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "quantity": str(P),
                    "unit": product.unit,
                })
            if W > Decimal("0"):
                summary_items.append({
                    "action": "written_off",
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "quantity": str(W),
                    "unit": product.unit,
                })
            if kept > Decimal("0"):
                summary_items.append({
                    "action": "kept",
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "quantity": str(kept),
                    "unit": product.unit,
                })

            # ── a. MM-P return: move P units van → MG ────────────────────────
            if P > Decimal("0"):
                qty_before_van = st.quantity_available
                st.quantity_available = max(Decimal("0"), st.quantity_available - P)
                st.save(update_fields=["quantity_available"])
                StockMovement.objects.create(
                    company_id=company_id,
                    product_id=product.id,
                    warehouse_id=van_warehouse.id,
                    user=user,
                    movement_type=StockMovement.MovementType.TRANSFER,
                    quantity=-P,
                    quantity_before=qty_before_van,
                    quantity_after=st.quantity_available,
                    reference_type="mm_return",
                    reference_id=mm_return_doc.id,
                    notes="MM-P — zwrot z vana do magazynu",
                    created_by=user,
                )
                # Add to MG
                st_main, _ = ProductStock.objects.select_for_update().get_or_create(
                    company_id=company_id,
                    product_id=product.id,
                    warehouse_id=main_warehouse.id,
                    defaults={
                        "quantity_available": Decimal("0"),
                        "quantity_reserved": Decimal("0"),
                        "quantity_total": Decimal("0"),
                    },
                )
                qty_before_main = st_main.quantity_available
                st_main.quantity_available += P
                st_main.save(update_fields=["quantity_available"])
                StockMovement.objects.create(
                    company_id=company_id,
                    product_id=product.id,
                    warehouse_id=main_warehouse.id,
                    user=user,
                    movement_type=StockMovement.MovementType.TRANSFER,
                    quantity=P,
                    quantity_before=qty_before_main,
                    quantity_after=st_main.quantity_available,
                    reference_type="mm_return",
                    reference_id=mm_return_doc.id,
                    notes="MM-P — zwrot z vana do magazynu",
                    created_by=user,
                )

            if explicit_mode:
                # ── b. Explicit split mode: DAMAGE exactly W, keep T-P-W in van ─
                if W > Decimal("0"):
                    qty_before_van = st.quantity_available
                    st.quantity_available = max(Decimal("0"), st.quantity_available - W)
                    st.quantity_reserved = Decimal("0")
                    st.save(update_fields=["quantity_available", "quantity_reserved"])
                    StockMovement.objects.create(
                        company_id=company_id,
                        product_id=product.id,
                        warehouse_id=van_warehouse.id,
                        user=user,
                        movement_type=StockMovement.MovementType.DAMAGE,
                        quantity=-W,
                        quantity_before=qty_before_van,
                        quantity_after=st.quantity_available,
                        reference_type="rw_writeoff",
                        reference_id=rw_doc.id if rw_doc else run_id,
                        notes=f"Odpisanie towaru z vana{route_note}",
                        created_by=user,
                    )
                # Remainder (T - P - W) stays in van — no further action needed.
                # Record as discrepancy only if caller over-reported (P + W > T).
                total_removed = P + W
                if total_removed > T:
                    over = total_removed - T
                    discrepancies.append(
                        {
                            "product_id": str(product.id),
                            "product_name": product.name,
                            "quantity_expected": _fmt_decimal(T),
                            "quantity_actual": _fmt_decimal(T - over),
                            "quantity_delta": _fmt_decimal(-over),
                            "discrepancy_type": "damage",
                        }
                    )
            else:
                # ── c. Legacy mode: delta-based discrepancy, zero out van ────────
                delta = P - T  # positive = surplus, negative = shortage
                if delta != Decimal("0"):
                    if st.quantity_available != Decimal("0") or st.quantity_reserved != Decimal("0"):
                        st.quantity_available = Decimal("0")
                        st.quantity_reserved = Decimal("0")
                        st.save(update_fields=["quantity_available", "quantity_reserved"])
                    mtype = StockMovement.MovementType.DAMAGE if delta < 0 else StockMovement.MovementType.ADJUSTMENT
                    disc_type = "damage" if delta < 0 else "adjustment"
                    StockMovement.objects.create(
                        company_id=company_id,
                        product_id=product.id,
                        warehouse_id=van_warehouse.id,
                        user=user,
                        movement_type=mtype,
                        quantity=delta,
                        quantity_before=T,
                        quantity_after=P,
                        reference_type="van_reconciliation",
                        reference_id=run_id,
                        notes=f"Różnica przy rozliczeniu trasy{route_note}",
                        created_by=user,
                    )
                    discrepancies.append(
                        {
                            "product_id": str(product.id),
                            "product_name": product.name,
                            "quantity_expected": _fmt_decimal(T),
                            "quantity_actual": _fmt_decimal(P),
                            "quantity_delta": _fmt_decimal(delta),
                            "discrepancy_type": disc_type,
                        }
                    )
                elif P == Decimal("0"):
                    # Zero out van stock entirely (nothing returned, nothing expected)
                    if st.quantity_available != Decimal("0") or st.quantity_reserved != Decimal("0"):
                        st.quantity_available = Decimal("0")
                        st.quantity_reserved = Decimal("0")
                        st.save(update_fields=["quantity_available", "quantity_reserved"])

    return {
        "van_warehouse_id": str(van_warehouse.id),
        "reconciliation_id": str(run_id),
        "mm_return_number": mm_return_doc.document_number if mm_return_doc else None,
        "rw_writeoff_number": rw_doc.document_number if rw_doc else None,
        "reconciled_at": reconciled_at.isoformat(),
        "discrepancies": discrepancies,
        "items_processed": len(items),
        "summary_items": summary_items,
    }


def cancel_pz(pz_document: "DeliveryDocument", user) -> dict:
    """
    Cancel a PZ document, leaving a full audit trail.

    - If the PZ was already delivered (stock applied), reverses only the
      ``quantity_remaining`` still in the batch — units already consumed by
      subsequent WZ/MM documents are not double-counted.
    - Deletes the FIFO batches created by this PZ.
    - Records a reversal StockMovement(ADJUSTMENT) per line so the ledger
      remains coherent.
    - If the PZ was not yet delivered (draft/saved), no stock was ever
      applied so only the status is changed.

    Returns a summary dict with reversal details.
    """
    if pz_document.document_type != DeliveryDocument.DOC_TYPE_PZ:
        raise ValueError(
            f"cancel_pz() called on document type '{pz_document.document_type}'; "
            "expected 'PZ'."
        )
    if pz_document.status == DeliveryDocument.STATUS_CANCELLED:
        raise ValidationError({"detail": "Dokument jest już anulowany."})

    reversed_lines = []

    with transaction.atomic():
        if pz_document.status == DeliveryDocument.STATUS_DELIVERED:
            warehouse = pz_document.to_warehouse
            if warehouse is None:
                raise ValidationError({"detail": "Brak magazynu docelowego — nie można odwrócić stanu."})

            company_id = pz_document.company_id
            doc_label = pz_document.document_number or str(pz_document.id)
            items = list(
                pz_document.items.select_related("product").select_for_update()
            )

            for idx, item in enumerate(items, start=1):
                batch_number = f"{doc_label}/{idx:02d}"
                batches = list(
                    StockBatch.objects.filter(
                        company_id=company_id,
                        product=item.product,
                        warehouse=warehouse,
                        batch_number=batch_number,
                    ).select_for_update()
                )

                if not batches:
                    # Batch was never created (product.track_batches=False) —
                    # reverse the effective received quantity from stock directly.
                    effective_qty = (
                        item.quantity_actual
                        if item.quantity_actual is not None
                        else item.quantity_planned
                    )
                    if effective_qty > Decimal("0"):
                        try:
                            stock = ProductStock.objects.select_for_update().get(
                                company_id=company_id,
                                product=item.product,
                                warehouse=warehouse,
                            )
                            qty_before = stock.quantity_available
                            stock.quantity_available -= effective_qty
                            stock.save(update_fields=["quantity_available"])
                            StockMovement.objects.create(
                                company_id=company_id,
                                product=item.product,
                                warehouse=warehouse,
                                user=user,
                                movement_type=StockMovement.MovementType.ADJUSTMENT,
                                quantity=-effective_qty,
                                quantity_before=qty_before,
                                quantity_after=stock.quantity_available,
                                reference_type="pz_cancellation",
                                reference_id=pz_document.id,
                                notes=f"Anulowanie PZ {doc_label}",
                                created_by=user,
                            )
                            reversed_lines.append(
                                {"product": item.product.name, "quantity_reversed": str(effective_qty), "note": "no_batch"}
                            )
                        except ProductStock.DoesNotExist:
                            pass  # stock record gone — nothing to reverse
                    continue

                for batch in batches:
                    qty_to_reverse = batch.quantity_remaining
                    already_used = batch.quantity_initial - qty_to_reverse

                    try:
                        stock = ProductStock.objects.select_for_update().get(
                            company_id=company_id,
                            product=item.product,
                            warehouse=warehouse,
                        )
                    except ProductStock.DoesNotExist:
                        batch.delete()
                        continue

                    if qty_to_reverse > Decimal("0"):
                        qty_before = stock.quantity_available
                        stock.quantity_available -= qty_to_reverse
                        stock.save(update_fields=["quantity_available"])
                        StockMovement.objects.create(
                            company_id=company_id,
                            product=item.product,
                            warehouse=warehouse,
                            user=user,
                            movement_type=StockMovement.MovementType.ADJUSTMENT,
                            quantity=-qty_to_reverse,
                            quantity_before=qty_before,
                            quantity_after=stock.quantity_available,
                            reference_type="pz_cancellation",
                            reference_id=pz_document.id,
                            notes=f"Anulowanie PZ {doc_label}"
                            + (f" (partia {batch_number}, {already_used} szt. już zużyte)" if already_used > 0 else ""),
                            created_by=user,
                        )

                    reversed_lines.append({
                        "product": item.product.name,
                        "quantity_reversed": str(qty_to_reverse),
                        "quantity_already_used": str(already_used),
                    })
                    batch.delete()

        pz_document.status = DeliveryDocument.STATUS_CANCELLED
        pz_document.user = user
        pz_document.save(update_fields=["status", "user", "updated_at"])

    return {"reversed_lines": reversed_lines}


def create_pz_kor(original_pz: "DeliveryDocument", correction_items: list, user) -> "DeliveryDocument":
    """
    Create a PZ-KOR (Korekta Przyjęcia Zewnętrznego) for a delivered PZ.

    correction_items: list of dicts:
        {
            'delivery_item_id': str UUID,
            'new_unit_cost': Decimal | None,      # None = no price change
            'new_quantity_actual': Decimal | None, # None = no quantity change
        }

    For each item where a value actually changed:
    - Price correction: updates StockBatch.unit_cost, records ADJUSTMENT movement.
    - Quantity correction: adjusts ProductStock.quantity_available and StockBatch by delta.

    The PZ-KOR document is created immediately as STATUS_DELIVERED (corrections are applied instantly).
    Returns the created PZ-KOR document.
    """
    if original_pz.document_type != DeliveryDocument.DOC_TYPE_PZ:
        raise ValidationError({"detail": "Korektę można utworzyć tylko dla dokumentu PZ."})
    if original_pz.status != DeliveryDocument.STATUS_DELIVERED:
        raise ValidationError({"detail": "Korektę można utworzyć tylko dla zaksięgowanego PZ."})
    if not correction_items:
        raise ValidationError({"detail": "Brak pozycji do korekty."})

    warehouse = original_pz.to_warehouse
    if warehouse is None:
        raise ValidationError({"detail": "PZ nie ma przypisanego magazynu docelowego."})

    company_id = original_pz.company_id
    doc_label = original_pz.document_number or str(original_pz.id)

    with transaction.atomic():
        # Pre-fetch original items ordered as they were created (idx matches batch_number)
        orig_items = list(
            original_pz.items.select_related("product").order_by("created_at")
        )
        orig_item_map = {str(it.id): (idx + 1, it) for idx, it in enumerate(orig_items)}

        # Build list of actual changes before creating any DB records
        changes = []
        for corr in correction_items:
            item_id = str(corr.get("delivery_item_id", ""))
            if item_id not in orig_item_map:
                continue
            idx, item = orig_item_map[item_id]

            original_qty = item.quantity_actual if item.quantity_actual is not None else item.quantity_planned
            original_cost = item.unit_cost

            new_qty = corr.get("new_quantity_actual")
            new_cost = corr.get("new_unit_cost")

            qty_changed = new_qty is not None and abs(new_qty - original_qty) > Decimal("0.0001")
            cost_changed = (
                new_cost is not None
                and (original_cost is None or abs(new_cost - original_cost) > Decimal("0.0001"))
            )

            if not qty_changed and not cost_changed:
                continue

            changes.append({
                "idx": idx,
                "item": item,
                "original_qty": original_qty,
                "original_cost": original_cost,
                "new_qty": new_qty if qty_changed else None,
                "new_cost": new_cost if cost_changed else None,
                "qty_changed": qty_changed,
                "cost_changed": cost_changed,
            })

        if not changes:
            raise ValidationError({"detail": "Żadna wartość nie uległa zmianie — korekta nie jest potrzebna."})

        # Create the PZ-KOR document (document_number auto-assigned by model.save())
        kor_doc = DeliveryDocument.objects.create(
            company_id=company_id,
            document_type=DeliveryDocument.DOC_TYPE_PZ_KOR,
            corrects_pz=original_pz,
            from_supplier=original_pz.from_supplier,
            to_warehouse=warehouse,
            ksef_invoice=original_pz.ksef_invoice,
            issue_date=timezone.localdate(),
            status=DeliveryDocument.STATUS_DELIVERED,
            delivered_at=timezone.now(),
            user=user,
            notes=f"Korekta {doc_label}",
        )
        kor_label = kor_doc.document_number or str(kor_doc.id)

        for ch in changes:
            item = ch["item"]
            idx = ch["idx"]
            batch_number = f"{doc_label}/{idx:02d}"

            effective_qty = ch["new_qty"] if ch["qty_changed"] else ch["original_qty"]
            effective_cost = ch["new_cost"] if ch["cost_changed"] else ch["original_cost"]

            # Create correction line on PZ-KOR document
            DeliveryItem.objects.create(
                delivery_document=kor_doc,
                product=item.product,
                quantity_planned=effective_qty,
                quantity_actual=ch["new_qty"] if ch["qty_changed"] else item.quantity_actual,
                unit_cost=effective_cost,
                notes=(
                    f"Korekta ceny: {ch['original_cost']} → {effective_cost}"
                    if ch["cost_changed"] and not ch["qty_changed"]
                    else f"Korekta ilości: {ch['original_qty']} → {ch['new_qty']}"
                    if ch["qty_changed"] and not ch["cost_changed"]
                    else f"Korekta ilości: {ch['original_qty']} → {ch['new_qty']}, ceny: {ch['original_cost']} → {effective_cost}"
                ),
            )

            # ── Price correction ────────────────────────────────────────────
            if ch["cost_changed"] and item.product.track_batches:
                try:
                    batch = StockBatch.objects.select_for_update().get(
                        company_id=company_id,
                        product=item.product,
                        warehouse=warehouse,
                        batch_number=batch_number,
                    )
                    batch.unit_cost = ch["new_cost"]
                    batch.save(update_fields=["unit_cost"])
                except StockBatch.DoesNotExist:
                    pass  # batch already consumed/deleted — cost correction is informational only

            # Always record the cost correction as a movement (informational, qty=0)
            if ch["cost_changed"]:
                try:
                    stock = ProductStock.objects.get(
                        company_id=company_id, product=item.product, warehouse=warehouse
                    )
                    StockMovement.objects.create(
                        company_id=company_id,
                        product=item.product,
                        warehouse=warehouse,
                        user=user,
                        movement_type=StockMovement.MovementType.ADJUSTMENT,
                        quantity=Decimal("0"),
                        quantity_before=stock.quantity_available,
                        quantity_after=stock.quantity_available,
                        reference_type="pz_correction",
                        reference_id=kor_doc.id,
                        notes=f"Korekta ceny {doc_label}: {ch['original_cost']} → {ch['new_cost']} zł/jm ({item.product.name})",
                        created_by=user,
                    )
                except ProductStock.DoesNotExist:
                    pass

            # ── Quantity correction ─────────────────────────────────────────
            if ch["qty_changed"]:
                qty_delta = ch["new_qty"] - ch["original_qty"]

                try:
                    stock = ProductStock.objects.select_for_update().get(
                        company_id=company_id, product=item.product, warehouse=warehouse
                    )
                    qty_before = stock.quantity_available
                    stock.quantity_available += qty_delta
                    stock.save(update_fields=["quantity_available"])

                    StockMovement.objects.create(
                        company_id=company_id,
                        product=item.product,
                        warehouse=warehouse,
                        user=user,
                        movement_type=StockMovement.MovementType.ADJUSTMENT,
                        quantity=qty_delta,
                        quantity_before=qty_before,
                        quantity_after=stock.quantity_available,
                        reference_type="pz_correction",
                        reference_id=kor_doc.id,
                        notes=f"Korekta ilości {doc_label}: {ch['original_qty']} → {ch['new_qty']} ({item.product.name})",
                        created_by=user,
                    )
                except ProductStock.DoesNotExist:
                    pass

                if item.product.track_batches:
                    try:
                        batch = StockBatch.objects.select_for_update().get(
                            company_id=company_id,
                            product=item.product,
                            warehouse=warehouse,
                            batch_number=batch_number,
                        )
                        batch.quantity_remaining = max(Decimal("0"), batch.quantity_remaining + qty_delta)
                        batch.quantity_initial += qty_delta
                        batch.save(update_fields=["quantity_remaining", "quantity_initial"])
                    except StockBatch.DoesNotExist:
                        pass

    kor_doc.refresh_from_db()
    return kor_doc


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

    to_wh = doc.to_warehouse
    to_warehouse = None
    if to_wh is not None:
        to_warehouse = {"name": to_wh.name, "code": to_wh.code}

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

    return_documents_out = []
    for zw in doc.return_documents.all().order_by("created_at"):
        zw_items = []
        for it in zw.items.all().order_by("created_at"):
            product = it.product
            zw_items.append(
                {
                    "product_name": product.name,
                    "quantity_planned": _fmt_decimal(it.quantity_planned),
                    "return_reason": it.return_reason or "",
                    "unit": product.unit or "",
                }
            )
        return_documents_out.append(
            {
                "id": str(zw.id),
                "document_number": zw.document_number or "",
                "issue_date": str(zw.issue_date),
                "items": zw_items,
            }
        )

    return {
        "document": document_block,
        "company": company_block,
        "customer": customer_block,
        "from_warehouse": from_warehouse,
        "to_warehouse": to_warehouse,
        "items": items_out,
        "return_documents": return_documents_out,
    }


def create_zw_from_pending_returns(
    *,
    wz_doc: DeliveryDocument,
    return_items: list[dict],
    user,
) -> DeliveryDocument:
    """
    Create a ZW (Zwrot Zewnętrzny) document from pending return lines collected during
    a WZ delivery, and add returned stock back to the van/source warehouse.

    :param wz_doc: The WZ document being saved; its ``from_warehouse`` receives the stock.
    :param return_items: List of ``{product_id, quantity, return_reason}`` dicts.
    :param user: Authenticated user (for audit).
    :returns: The created (``saved``) ZW document.
    """
    if not return_items:
        raise ValueError("return_items must not be empty.")

    company_id = wz_doc.company_id
    van_warehouse = wz_doc.from_warehouse  # stock goes back here

    product_ids = [str(row["product_id"]) for row in return_items]
    if len(product_ids) != len(set(product_ids)):
        raise ValidationError({"return_items": "Duplicate product_id in return items."})

    with transaction.atomic():
        products = {
            str(p.id): p
            for p in Product.objects.filter(company_id=company_id, id__in=product_ids)
        }
        missing = [pid for pid in product_ids if pid not in products]
        if missing:
            raise ValidationError(
                {"return_items": f"Unknown product_id(s): {missing}."}
            )

        # Build lookup of source WZ items so we can: (a) copy order_item FK onto each
        # ZW line, (b) enforce Level 3 guard — can't return more than was deliverable.
        wz_items_by_product = {
            str(item.product_id): item
            for item in wz_doc.items.select_related("order_item").all()
        }

        # Sum quantities already returned via existing ZW documents linked to this WZ.
        existing_zw_by_product: dict[str, Decimal] = {}
        for row in (
            DeliveryItem.objects.filter(
                delivery_document__linked_wz=wz_doc,
                delivery_document__document_type=DeliveryDocument.DOC_TYPE_ZW,
            )
            .values("product_id")
            .annotate(total=Sum("quantity_actual"))
        ):
            existing_zw_by_product[str(row["product_id"])] = row["total"] or Decimal("0")

        # Level 3 guard: validate all quantities before creating anything.
        for row in return_items:
            pid = str(row["product_id"])
            qty = Decimal(str(row["quantity"]))
            wz_item = wz_items_by_product.get(pid)
            if wz_item is not None:
                max_deliverable = wz_item.quantity_actual or wz_item.quantity_planned
                already_returned = existing_zw_by_product.get(pid, Decimal("0"))
                returnable = max_deliverable - already_returned
                if qty > returnable + Decimal("0.001"):
                    raise ValidationError({
                        "return_items": (
                            f"Nie można zwrócić {qty} szt. produktu "
                            f"'{products[pid].name}' — maksymalny zwrot wynosi {returnable} szt."
                        )
                    })

        zw_doc = DeliveryDocument.objects.create(
            company_id=company_id,
            order=None,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_ZW,
            issue_date=timezone.localdate(),
            from_warehouse=None,      # coming from external customer
            to_warehouse=van_warehouse,
            to_customer=wz_doc.to_customer,
            linked_wz=wz_doc,
            van_route=wz_doc.van_route,
            status=DeliveryDocument.STATUS_SAVED,
            driver_name=wz_doc.driver_name or "",
            notes=f"Zwrot do WZ {wz_doc.document_number or wz_doc.id}",
        )

        for row in return_items:
            pid = str(row["product_id"])
            qty = Decimal(str(row["quantity"]))
            reason = (row.get("return_reason") or "").strip()
            wz_item = wz_items_by_product.get(pid)

            DeliveryItem.objects.create(
                delivery_document=zw_doc,
                order_item=wz_item.order_item if wz_item else None,
                product=products[pid],
                quantity_planned=qty,
                quantity_actual=qty,
                quantity_returned=Decimal("0"),
                return_reason=reason,
            )

            # Add stock back to van/source warehouse (if set)
            if van_warehouse is not None:
                st, _ = ProductStock.objects.select_for_update().get_or_create(
                    company_id=company_id,
                    product_id=pid,
                    warehouse_id=van_warehouse.id,
                    defaults={
                        "quantity_available": Decimal("0"),
                        "quantity_reserved": Decimal("0"),
                        "quantity_total": Decimal("0"),
                    },
                )
                qty_before = st.quantity_available
                st.quantity_available += qty
                st.save(update_fields=["quantity_available"])
                StockMovement.objects.create(
                    company_id=company_id,
                    product_id=pid,
                    warehouse_id=van_warehouse.id,
                    user=user,
                    movement_type=StockMovement.MovementType.RETURN,
                    quantity=qty,
                    quantity_before=qty_before,
                    quantity_after=st.quantity_available,
                    reference_type="delivery_return",
                    reference_id=zw_doc.id,
                    notes=f"Zwrot od klienta (ZW do WZ {wz_doc.document_number or wz_doc.id})",
                    created_by=user,
                )

    zw_doc.refresh_from_db()
    return zw_doc


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
        if "expiry_date" in row:
            item.expiry_date = row["expiry_date"]  # None clears it

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

    return doc


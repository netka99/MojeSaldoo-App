"""Business logic for delivery documents (decoupled from HTTP layer)."""

import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.orders.models import Order
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
            from_warehouse=active_main_warehouse_for_company(order.company_id),
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
    ``quantity_available`` decreases at the main warehouse and increases at the mobile one.
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
            avail = st.quantity_available
            if avail < need and not from_warehouse.allow_negative_stock:
                shortfalls.append(
                    {
                        "product_id": pid,
                        "product_name": products[pid].name,
                        "quantity_available": str(avail),
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
            qty_before_out = st_out.quantity_available
            st_out.quantity_available -= qty
            st_out.save(update_fields=["quantity_available"])
            StockMovement.objects.create(
                company_id=company_id,
                product_id=product.id,
                warehouse_id=from_warehouse.id,
                user=user,
                movement_type=StockMovement.MovementType.TRANSFER,
                quantity=-qty,
                quantity_before=qty_before_out,
                quantity_after=st_out.quantity_available,
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

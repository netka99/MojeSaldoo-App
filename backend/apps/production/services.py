"""
Production order completion service.

complete_production_order(order, user):
  1. Determine consumed quantities (recipe-based for simple, user-provided for batch).
  2. Walk StockBatch FIFO for each ingredient — price consumption at actual purchase costs.
  3. Create RW document + items (deduct from warehouse stock).
  4. Create PW document + item (add finished goods to warehouse stock).
  5. Update Product.avg_cost for finished good.
  6. Persist total_input_cost, real_unit_cost, completed_at on the order.
"""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.delivery.services import (
    active_main_warehouse_for_company,
    _recalculate_product_avg_cost,
)
from apps.products.models import Product, ProductStock, StockBatch, StockMovement

from .models import ProductionOrder, ProductionOrderInput


# ── FIFO cost engine ──────────────────────────────────────────────────────────

def _consume_fifo(
    company_id,
    product: Product,
    warehouse,
    quantity: Decimal,
    user,
    reference_id,
    notes: str,
) -> Decimal:
    """
    Deduct `quantity` from `warehouse` stock using FIFO (oldest StockBatch first).
    Creates StockMovement records.
    Returns total cost of the consumed quantity (PLN).

    Raises ValidationError if insufficient stock.
    """
    if quantity <= Decimal("0"):
        return Decimal("0")

    stock = (
        ProductStock.objects.select_for_update()
        .filter(company_id=company_id, product=product, warehouse=warehouse)
        .first()
    )
    available = stock.quantity_available if stock else Decimal("0")
    if available < quantity:
        raise ValidationError(
            {
                "detail": (
                    f"Niewystarczający stan magazynowy dla '{product.name}': "
                    f"dostępne {available}, wymagane {quantity}."
                )
            }
        )

    remaining = quantity
    total_cost = Decimal("0")

    if product.track_batches:
        batches = list(
            StockBatch.objects.select_for_update()
            .filter(
                company_id=company_id,
                product=product,
                warehouse=warehouse,
                quantity_remaining__gt=0,
            )
            .order_by("received_date", "id")
        )
        for batch in batches:
            if remaining <= Decimal("0"):
                break
            take = min(batch.quantity_remaining, remaining)
            batch_unit_cost = batch.unit_cost or Decimal("0")
            total_cost += take * batch_unit_cost
            batch.quantity_remaining -= take
            batch.save(update_fields=["quantity_remaining"])
            remaining -= take

    # If batches didn't cover all (no batch tracking or cost missing), price at avg_cost
    if remaining > Decimal("0"):
        fallback_cost = product.avg_cost or Decimal("0")
        total_cost += remaining * fallback_cost
        remaining = Decimal("0")

    # Update ProductStock
    qty_before = stock.quantity_available
    stock.quantity_available -= quantity
    stock.save(update_fields=["quantity_available"])

    StockMovement.objects.create(
        company_id=company_id,
        product=product,
        warehouse=warehouse,
        user=user,
        movement_type=StockMovement.MovementType.ADJUSTMENT,
        quantity=-quantity,
        quantity_before=qty_before,
        quantity_after=stock.quantity_available,
        reference_type="production_order",
        reference_id=reference_id,
        notes=notes,
        created_by=user,
    )

    return total_cost


# ── Main completion function ──────────────────────────────────────────────────

def complete_production_order(order: ProductionOrder, user) -> ProductionOrder:
    """
    Finalize a draft ProductionOrder. Idempotency: raises if already completed.

    Steps:
      - Validate order and warehouse
      - Resolve consumption plan (recipe vs actual inputs)
      - For each ingredient: consume FIFO, record cost
      - Create RW document (raw material issue)
      - Create PW document (finished goods receipt)
      - Update finished good avg_cost
      - Mark order completed
    """
    if order.status == ProductionOrder.STATUS_COMPLETED:
        raise ValidationError({"detail": "Zlecenie jest już zakończone."})

    warehouse = active_main_warehouse_for_company(order.company_id)
    if warehouse is None:
        raise ValidationError({"detail": "Brak aktywnego magazynu głównego dla tej firmy."})

    recipe = order.recipe
    finished_product = recipe.product
    qty_produced = order.quantity_produced

    if qty_produced <= Decimal("0"):
        raise ValidationError({"detail": "Ilość wyprodukowana musi być większa od zera."})

    # Build consumption plan: {product: quantity_to_consume}
    if order.mode == ProductionOrder.MODE_BATCH:
        # Use user-provided actual inputs
        actual_inputs = list(
            order.inputs.select_related("ingredient").all()
        )
        if not actual_inputs:
            raise ValidationError(
                {"detail": "Tryb wsadu wymaga podania rzeczywistego zużycia surowców."}
            )
        consumption_plan = {inp.ingredient: inp.quantity_used for inp in actual_inputs}
        input_map = {inp.ingredient_id: inp for inp in actual_inputs}
    else:
        # Simple mode: derive from recipe
        recipe_items = list(recipe.items.select_related("ingredient").all())
        if not recipe_items:
            raise ValidationError({"detail": "Receptura nie ma żadnych składników."})
        scale = qty_produced / recipe.yield_quantity
        consumption_plan = {
            item.ingredient: (item.quantity * scale).quantize(Decimal("0.0001"))
            for item in recipe_items
        }
        input_map = {}

    with transaction.atomic():
        # ── 1. Create RW document ─────────────────────────────────────────────
        rw = DeliveryDocument.objects.create(
            company=order.company,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_RW,
            issue_date=order.date,
            from_warehouse=warehouse,
            status=DeliveryDocument.STATUS_DELIVERED,
            notes=f"Automatyczne RW dla zlecenia {order.order_number}",
        )

        total_cost = Decimal("0")

        for ingredient, qty in consumption_plan.items():
            if qty <= Decimal("0"):
                continue

            # FIFO consumption
            line_cost = _consume_fifo(
                company_id=order.company_id,
                product=ingredient,
                warehouse=warehouse,
                quantity=qty,
                user=user,
                reference_id=order.id,
                notes=f"Produkcja {order.order_number}",
            )
            total_cost += line_cost

            # RW item (unit_cost = avg line cost for traceability)
            unit_cost_for_item = (line_cost / qty).quantize(Decimal("0.0001")) if qty > 0 else None
            DeliveryItem.objects.create(
                delivery_document=rw,
                product=ingredient,
                quantity_planned=qty,
                quantity_actual=qty,
                unit_cost=unit_cost_for_item,
            )

            # Store FIFO cost on batch-mode input record
            if ingredient.id in input_map:
                inp = input_map[ingredient.id]
                inp.fifo_cost = line_cost
                inp.save(update_fields=["fifo_cost"])

        # ── 2. Create PW document ─────────────────────────────────────────────
        real_unit_cost = (
            (total_cost / qty_produced).quantize(Decimal("0.0001"))
            if qty_produced > 0
            else Decimal("0")
        )

        pw = DeliveryDocument.objects.create(
            company=order.company,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_PZ,  # PW reuses PZ type internally
            issue_date=order.date,
            to_warehouse=warehouse,
            status=DeliveryDocument.STATUS_DELIVERED,
            notes=f"Automatyczne PW dla zlecenia {order.order_number}",
        )
        DeliveryItem.objects.create(
            delivery_document=pw,
            product=finished_product,
            quantity_planned=qty_produced,
            quantity_actual=qty_produced,
            unit_cost=real_unit_cost,
        )

        # Add finished goods to stock
        stock, _ = ProductStock.objects.select_for_update().get_or_create(
            company_id=order.company_id,
            product=finished_product,
            warehouse=warehouse,
            defaults={
                "quantity_available": Decimal("0"),
                "quantity_reserved": Decimal("0"),
                "quantity_total": Decimal("0"),
            },
        )
        qty_before = stock.quantity_available
        stock.quantity_available += qty_produced
        stock.save(update_fields=["quantity_available"])

        if finished_product.track_batches:
            StockBatch.objects.create(
                company_id=order.company_id,
                product=finished_product,
                warehouse=warehouse,
                batch_number=order.order_number,
                received_date=order.date,
                quantity_initial=qty_produced,
                quantity_remaining=qty_produced,
                unit_cost=real_unit_cost,
            )

        StockMovement.objects.create(
            company_id=order.company_id,
            product=finished_product,
            warehouse=warehouse,
            user=user,
            movement_type=StockMovement.MovementType.PURCHASE,
            quantity=qty_produced,
            quantity_before=qty_before,
            quantity_after=stock.quantity_available,
            reference_type="production_order",
            reference_id=order.id,
            notes=f"Produkcja {order.order_number}",
            created_by=user,
        )

        # ── 3. Update finished good avg_cost ──────────────────────────────────
        _recalculate_product_avg_cost(finished_product, real_unit_cost, qty_produced)
        # Override source set by delivery helper — this cost came from production
        finished_product.avg_cost_source = Product.COST_SOURCE_PRODUCTION
        finished_product.save(update_fields=["avg_cost_source"])

        # ── 4. Finalise order ─────────────────────────────────────────────────
        order.status = ProductionOrder.STATUS_COMPLETED
        order.total_input_cost = total_cost
        order.real_unit_cost = real_unit_cost
        order.rw_document = rw
        order.pw_document = pw
        order.completed_at = timezone.now()
        order.save(
            update_fields=[
                "status",
                "total_input_cost",
                "real_unit_cost",
                "rw_document",
                "pw_document",
                "completed_at",
                "updated_at",
            ]
        )

    return order

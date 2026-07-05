"""Business logic for inventory count documents (decoupled from HTTP layer)."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.products.models import ProductStock, StockBatch, StockMovement


def _deduct_fifo_batches_for_inventory(
    company_id,
    product_id,
    warehouse_id,
    quantity: Decimal,
) -> None:
    """
    Walk StockBatch FIFO (oldest received_date first) and decrement
    quantity_remaining to reflect a negative inventory adjustment.

    Same pattern as _deduct_fifo_batches in apps.delivery.services.
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


@transaction.atomic
def complete_inventory_count(count, user) -> None:
    """
    Apply inventory corrections for a completed inventory count.

    For each item where quantity_actual is set and differs from quantity_system:
    - Get or create ProductStock (with select_for_update)
    - Calculate delta = quantity_actual - quantity_system
    - Record quantity_before from current stock
    - Create StockMovement (ADJUSTMENT type, signed delta)
    - Update ProductStock.quantity_available += delta
    - If delta > 0 and product.track_batches: create StockBatch with quantity_remaining=delta
    - If delta < 0: deduct FIFO batches (walk StockBatch by received_date)
    - Set count.status = 'completed', count.completed_at = now
    - Save count
    """
    from .models import InventoryCount

    warehouse = count.warehouse
    company_id = count.company_id
    doc_label = count.document_number or str(count.id)
    today = timezone.localdate()

    items = list(count.items.select_related("product").select_for_update())

    for item in items:
        if item.quantity_actual is None:
            continue

        delta = item.quantity_actual - item.quantity_system
        if delta == Decimal("0"):
            continue

        product = item.product

        # Get or create ProductStock with row lock
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
        qty_after = qty_before + delta

        # Create StockMovement (ADJUSTMENT)
        StockMovement.objects.create(
            company_id=company_id,
            product=product,
            warehouse=warehouse,
            user=user,
            movement_type=StockMovement.MovementType.ADJUSTMENT,
            quantity=delta,
            quantity_before=qty_before,
            quantity_after=qty_after,
            reference_type="inventory_count",
            reference_id=count.uuid,
            notes=f"Inwentaryzacja {doc_label}",
            created_by=user,
        )

        # Update ProductStock
        stock.quantity_available = qty_after
        stock.save(update_fields=["quantity_available"])

        # Handle batch tracking
        if delta > Decimal("0"):
            if product.track_batches:
                StockBatch.objects.create(
                    company_id=company_id,
                    product=product,
                    warehouse=warehouse,
                    batch_number=f"{doc_label}/{str(item.id)[:8]}",
                    received_date=today,
                    expiry_date=None,
                    quantity_initial=delta,
                    quantity_remaining=delta,
                    unit_cost=None,
                )
        elif delta < Decimal("0"):
            _deduct_fifo_batches_for_inventory(
                company_id=company_id,
                product_id=product.id,
                warehouse_id=warehouse.id,
                quantity=abs(delta),
            )

    count.status = InventoryCount.STATUS_COMPLETED
    count.completed_at = timezone.now()
    count.save(update_fields=["status", "completed_at", "updated_at"])

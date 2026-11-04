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

    completion_date = timezone.now().date()

    # Resolve linked source orders for notes / FK
    source_orders = list(
        order.source_links.select_related("order__customer").values_list("order", flat=True).distinct()
    )
    linked_orders = list(
        order.source_links.select_related("order__customer")
        .values_list("order__order_number", flat=True)
        .distinct()
    )
    single_order = None
    single_customer = None
    if len(source_orders) == 1:
        from apps.orders.models import Order as SalesOrder
        single_order = SalesOrder.objects.filter(id=source_orders[0]).first()
        single_customer = single_order.customer if single_order else None

    order_notes = ""
    if linked_orders:
        order_notes = f" ({', '.join(linked_orders)})"

    with transaction.atomic():
        # ── 1. Create RW document ─────────────────────────────────────────────
        rw = DeliveryDocument.objects.create(
            company=order.company,
            user=user,
            document_type=DeliveryDocument.DOC_TYPE_RW,
            issue_date=completion_date,
            from_warehouse=warehouse,
            status=DeliveryDocument.STATUS_DELIVERED,
            order=single_order,
            to_customer=single_customer,
            notes=f"Automatyczne RW dla zlecenia {order.order_number}{order_notes}",
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
                reference_id=order.uuid,
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
            issue_date=completion_date,
            to_warehouse=warehouse,
            status=DeliveryDocument.STATUS_DELIVERED,
            order=single_order,
            to_customer=single_customer,
            notes=f"Automatyczne PW dla zlecenia {order.order_number}{order_notes}",
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
            reference_id=order.uuid,
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


# ── Production planning ───────────────────────────────────────────────────────

def get_production_planning(company, date_from=None, date_to=None):
    """
    Aggregate open-order demand by finished product and cross-reference with
    active recipes.

    Returns a list of dicts (sorted by product name), one per product that:
      - appears in at least one open (non-cancelled, non-invoiced) order, AND
      - has an active Recipe for this company.

    Each dict contains:
      product_id, product_name, product_unit,
      recipe_id, recipe_name, recipe_yield_quantity,
      total_ordered, stock_available, shortfall, suggested_production_qty,
      estimated_unit_cost, estimated_total_cost,
      ingredients (list), orders (list)
    """
    from apps.orders.models import Order, OrderItem
    from .models import Recipe

    OPEN_STATUSES = [
        Order.STATUS_CONFIRMED,
        Order.STATUS_IN_PREPARATION,
        Order.STATUS_LOADED,
        Order.STATUS_DELIVERED,
        Order.STATUS_PARTIALLY_DELIVERED,
    ]

    orders_qs = Order.objects.filter(
        company=company,
        status__in=OPEN_STATUSES,
    ).prefetch_related(
        "items",
        "items__product",
        "customer",
    )
    if date_from:
        orders_qs = orders_qs.filter(delivery_date__gte=date_from)
    if date_to:
        orders_qs = orders_qs.filter(delivery_date__lte=date_to)

    # Build per-order scheduled quantity from active (draft) ProductionOrderSource links
    # scheduled_qty_by_order: {order_uuid_str: total_quantity_already_scheduled}
    from .models import ProductionOrderSource

    # Group links by production_order so we can detect legacy rows (quantity=0)
    from collections import defaultdict
    links_by_prod: dict = defaultdict(list)
    for link in (
        ProductionOrderSource.objects
        .filter(
            production_order__company=company,
            production_order__status__in=[ProductionOrder.STATUS_DRAFT, ProductionOrder.STATUS_COMPLETED],
        )
        .select_related("order", "production_order__recipe__product")
    ):
        links_by_prod[link.production_order_id].append(link)

    # Key: (order_uuid, product_uuid) → scheduled quantity
    # This prevents bułka's scheduled qty from bleeding into chalka/chleb on same order
    scheduled_qty_by_order_product: dict = {}
    for prod_id, links in links_by_prod.items():
        total_link_qty = sum(lnk.quantity for lnk in links)
        if total_link_qty > 0:
            product_uuid = str(links[0].production_order.recipe.product.uuid)
            for lnk in links:
                key = (str(lnk.order.uuid), product_uuid)
                scheduled_qty_by_order_product[key] = (
                    scheduled_qty_by_order_product.get(key, Decimal("0")) + lnk.quantity
                )
        # Legacy (quantity=0): skip per-order tracking — product_level_remaining handles it

    # Sum of already-scheduled qty per recipe's finished product (for stock-tracked products)
    active_qty_by_product: dict = {}
    for po in ProductionOrder.objects.filter(
        company=company,
        status__in=[ProductionOrder.STATUS_DRAFT, ProductionOrder.STATUS_COMPLETED],
    ).select_related("recipe__product"):
        if po.recipe_id and po.recipe.product_id:
            ppid = str(po.recipe.product.uuid)
            active_qty_by_product[ppid] = (
                active_qty_by_product.get(ppid, Decimal("0")) + (po.quantity_produced or Decimal("0"))
            )

    # Aggregate remaining demand per product
    product_demand: dict = {}
    for order in orders_qs:
        oid = str(order.uuid)
        for item in order.items.all():
            pid = str(item.product.uuid)
            total_remaining = item.quantity - (item.quantity_delivered or Decimal("0"))
            if total_remaining <= 0:
                continue
            # Scheduled qty is keyed by (order, product) so different products on same order
            # don't interfere with each other
            scheduled_for_order_product = scheduled_qty_by_order_product.get((oid, pid), Decimal("0"))
            unscheduled = max(Decimal("0"), total_remaining - scheduled_for_order_product)
            if pid not in product_demand:
                product_demand[pid] = {
                    "product_id": pid,
                    "product_name": item.product_name,
                    "total_ordered": Decimal("0"),
                    "orders": [],
                }
            product_demand[pid]["total_ordered"] += total_remaining
            product_demand[pid]["orders"].append(
                {
                    "order_id": oid,
                    "order_number": order.order_number,
                    "customer_name": order.customer.name if order.customer_id else "",
                    "quantity": total_remaining,
                    "scheduled_qty": scheduled_for_order_product,
                    "remaining_qty": unscheduled,
                    "delivery_date": (
                        order.delivery_date.isoformat() if order.delivery_date else None
                    ),
                    "in_production": scheduled_for_order_product > 0,
                    "fully_scheduled": unscheduled <= 0,
                }
            )

    if not product_demand:
        return []

    # Load active recipes for the demanded products only
    recipes = (
        Recipe.objects.filter(
            company=company,
            product__uuid__in=product_demand.keys(),
            is_active=True,
        )
        .select_related("product")
        .prefetch_related(
            "items",
            "items__ingredient",
            "items__ingredient__stocks",
            "product__stocks",
        )
    )

    result = []
    for recipe in recipes:
        pid = str(recipe.product.uuid)
        if pid not in product_demand:
            continue

        demand = product_demand[pid]
        total_ordered = demand["total_ordered"]
        already_scheduled = active_qty_by_product.get(pid, Decimal("0"))

        # Sum of remaining (unscheduled) demand across all orders for this product
        unscheduled_ordered = Decimal(
            sum(Decimal(str(o["remaining_qty"])) for o in demand["orders"])
        )

        # Current stock of the finished product
        # For finished-type products without batch tracking, stock is not maintained —
        # they are produced to order. In this case we skip the shortfall calculation.
        finished_product = recipe.product
        tracks = (
            finished_product.product_type != "finished"
            or finished_product.track_batches
        )
        if tracks:
            stock_available = Decimal(
                sum(s.quantity_available or 0 for s in finished_product.stocks.all())
            )
            shortfall = max(Decimal("0"), total_ordered - stock_available)
        else:
            stock_available = None
            shortfall = None

        # Batches of recipe needed to cover the shortfall
        yield_qty = Decimal(str(recipe.yield_quantity)) if recipe.yield_quantity else Decimal("1")
        # suggested_production_qty = unscheduled demand (orders not yet in any active production order)
        # We use product-level fallback (total - already_scheduled) to handle legacy orders (quantity=0 links)
        product_level_remaining = max(Decimal("0"), total_ordered - already_scheduled)
        if unscheduled_ordered > 0:
            # Cap by product_level_remaining to handle legacy links correctly
            production_qty = min(product_level_remaining, unscheduled_ordered)
        else:
            production_qty = product_level_remaining
        batches_needed = production_qty / yield_qty if production_qty > 0 else Decimal("0")

        # Per-ingredient requirements and cost
        ingredients = []
        all_have_cost = True
        total_ingredient_cost_per_batch = Decimal("0")

        for item in recipe.items.all():
            ing = item.ingredient
            ing_stock = Decimal(
                sum(s.quantity_available or 0 for s in ing.stocks.all())
            )
            qty_per_batch = Decimal(str(item.quantity))
            qty_needed = qty_per_batch * batches_needed

            if ing.avg_cost is not None:
                line_cost_per_batch = qty_per_batch * Decimal(str(ing.avg_cost))
                total_ingredient_cost_per_batch += line_cost_per_batch
            else:
                all_have_cost = False
                line_cost_per_batch = None

            ingredients.append(
                {
                    "ingredient_id": str(ing.uuid),
                    "ingredient_name": ing.name,
                    "ingredient_unit": ing.unit,
                    "quantity_per_batch": qty_per_batch,
                    "quantity_needed": qty_needed,
                    "stock_available": ing_stock,
                    "avg_cost": ing.avg_cost,
                    "line_cost_per_batch": line_cost_per_batch,
                    "has_enough_stock": ing_stock >= qty_needed,
                }
            )

        if all_have_cost and recipe.items.exists():
            estimated_unit_cost = total_ingredient_cost_per_batch / yield_qty
            estimated_total_cost = estimated_unit_cost * production_qty if production_qty > 0 else Decimal("0")
        else:
            estimated_unit_cost = None
            estimated_total_cost = None

        result.append(
            {
                "product_id": pid,
                "product_name": demand["product_name"],
                "product_unit": finished_product.unit,
                "recipe_id": str(recipe.uuid),
                "recipe_name": recipe.name or finished_product.name,
                "recipe_yield_quantity": yield_qty,
                "total_ordered": total_ordered,
                "already_scheduled": already_scheduled,
                "stock_available": stock_available,
                "shortfall": shortfall,
                "suggested_production_qty": production_qty,
                "estimated_unit_cost": estimated_unit_cost,
                "estimated_total_cost": estimated_total_cost,
                "ingredients": ingredients,
                "orders": demand["orders"],
            }
        )

    return sorted(result, key=lambda x: x["product_name"])

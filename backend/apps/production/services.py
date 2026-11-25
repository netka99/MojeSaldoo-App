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
            document_type=DeliveryDocument.DOC_TYPE_PW,
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

        # ── 5. Update quantity_produced on linked OrderItems ──────────────────
        # For each source order link, add this production run's quantity to the
        # matching OrderItem.quantity_produced. This tracks how much has been
        # produced for each order item separately from quantity_delivered (WZ).
        from apps.orders.models import OrderItem as OI
        from django.db.models import F
        for link in order.source_links.select_related("order").all():
            if link.quantity and link.quantity > 0:
                OI.objects.filter(
                    order=link.order,
                    product=finished_product,
                ).update(
                    quantity_produced=F("quantity_produced") + link.quantity
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
    # Filter by planning date: use production_date when set, fall back to delivery_date.
    # An order with production_date set is included if production_date is in range.
    # An order without production_date falls back to delivery_date range.
    if date_from or date_to:
        from django.db.models import Q
        with_prod = Q(production_date__isnull=False)
        without_prod = Q(production_date__isnull=True)
        if date_from and date_to:
            orders_qs = orders_qs.filter(
                (with_prod & Q(production_date__gte=date_from) & Q(production_date__lte=date_to)) |
                (without_prod & Q(delivery_date__gte=date_from) & Q(delivery_date__lte=date_to))
            )
        elif date_from:
            orders_qs = orders_qs.filter(
                (with_prod & Q(production_date__gte=date_from)) |
                (without_prod & Q(delivery_date__gte=date_from))
            )
        else:
            orders_qs = orders_qs.filter(
                (with_prod & Q(production_date__lte=date_to)) |
                (without_prod & Q(delivery_date__lte=date_to))
            )

    # Build per-order scheduled quantity from DRAFT PRD links only.
    # Completed PRDs are accounted for via OrderItem.quantity_produced.
    from .models import ProductionOrderSource

    # Group links by production_order so we can detect legacy rows (quantity=0)
    from collections import defaultdict
    links_by_prod: dict = defaultdict(list)
    for link in (
        ProductionOrderSource.objects
        .filter(
            production_order__company=company,
            production_order__status=ProductionOrder.STATUS_DRAFT,
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
        status__in=[ProductionOrder.STATUS_DRAFT],
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
            # Use quantity_produced to exclude already-produced units from planning demand.
            # quantity_delivered is set when WZ is created (physical delivery), which may
            # happen after production. Using quantity_produced gives an accurate "still
            # needs production" figure.
            already_produced = item.quantity_produced or Decimal("0")
            total_remaining = item.quantity - already_produced
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
                    "production_date": (
                        order.production_date.isoformat() if order.production_date else None
                    ),
                    "shipment_date": (
                        order.shipment_date.isoformat() if order.shipment_date else None
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
            product__id__in=product_demand.keys(),
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
        tracks = finished_product.track_batches
        if tracks:
            stock_available = Decimal(
                sum(s.quantity_available or 0 for s in finished_product.stocks.all())
            )
            shortfall = max(Decimal("0"), unscheduled_ordered - stock_available - already_scheduled)
        else:
            stock_available = None
            shortfall = None

        # Batches of recipe needed to cover the shortfall
        yield_qty = Decimal(str(recipe.yield_quantity)) if recipe.yield_quantity else Decimal("1")
        # suggested_production_qty = how many MORE units need to be scheduled:
        # unscheduled demand (remaining_qty per order, summed) - stock on hand - already in draft PRDs
        # Note: unscheduled_ordered already excludes scheduled_qty per order,
        # but already_scheduled counts total draft PRD quantity (which may cover stock too).
        # Together: unscheduled - stock - already_scheduled = "still missing from production plan"
        effective_stock = stock_available if stock_available is not None else Decimal("0")
        production_qty = max(Decimal("0"), unscheduled_ordered - effective_stock - already_scheduled)
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


# ── Product flow report ───────────────────────────────────────────────────────

def get_product_flow_report(company, date_from=None, date_to=None, product_id=None):
    """
    Per-finished-product view starting from customer orders (ZAM) filtered by
    delivery_date. For each ZAM we find its PRD (any date), WZ and FV.
    Also shows PRD runs that have no ZAM link (stock production).

    Returns a list of dicts, one per finished product, sorted by product name.
    """
    from collections import defaultdict
    from apps.orders.models import Order, OrderItem
    from apps.delivery.models import DeliveryDocument
    from apps.invoices.models import Invoice, InvoiceOrder, InvoiceItem
    from apps.products.models import ProductStock, StockMovement
    from django.utils import timezone as tz

    today = tz.localdate()

    # ── 1. Fetch all ZAM in the date window (filtered by delivery_date) ──────────
    zam_items_qs = (
        OrderItem.objects.filter(
            order__company=company,
            order__status__in=[
                Order.STATUS_CONFIRMED, Order.STATUS_IN_PREPARATION,
                Order.STATUS_LOADED, Order.STATUS_IN_DELIVERY,
                Order.STATUS_PARTIALLY_DELIVERED, Order.STATUS_DELIVERED,
                Order.STATUS_INVOICED,
            ],
        )
        .select_related("order", "order__customer", "product")
        .order_by("order__delivery_date", "order__id")
    )
    if date_from:
        zam_items_qs = zam_items_qs.filter(order__delivery_date__gte=date_from)
    if date_to:
        zam_items_qs = zam_items_qs.filter(order__delivery_date__lte=date_to)
    if product_id:
        zam_items_qs = zam_items_qs.filter(product__uuid=product_id)

    if not zam_items_qs.exists():
        return []

    # Group by product: product_id -> list of OrderItem
    zam_by_product: dict = defaultdict(list)
    all_zam_order_ids: set = set()
    for item in zam_items_qs:
        zam_by_product[item.product_id].append(item)
        all_zam_order_ids.add(item.order_id)

    # ── 2. Find all PRD linked to these ZAM (any date) ───────────────────────────
    # Map: order_id -> list of ProductionOrder
    prd_by_order: dict = defaultdict(list)
    all_prd_ids: set = set()
    prd_source_links = (
        ProductionOrder.objects.filter(
            company=company,
            source_links__order_id__in=all_zam_order_ids,
        )
        .select_related("recipe__product", "rw_document", "pw_document")
        .prefetch_related("source_links", "source_links__order", "source_links__order__customer")
        .distinct()
    )
    # Build order_id -> [PRD] map
    prd_map: dict = {}  # prd_id -> PRD object
    for prd in prd_source_links:
        prd_map[prd.id] = prd
        all_prd_ids.add(prd.id)
        for link in prd.source_links.all():
            if link.order_id in all_zam_order_ids:
                prd_by_order[link.order_id].append(prd)

    # Also fetch stock PRD (is_stock_production=True, no ZAM) for products in our set
    finished_product_ids = set(zam_by_product.keys())
    stock_prds = (
        ProductionOrder.objects.filter(
            company=company,
            is_stock_production=True,
            recipe__product_id__in=finished_product_ids,
        )
        .select_related("recipe__product", "rw_document", "pw_document")
        .prefetch_related("source_links")
    )
    if date_from:
        stock_prds = stock_prds.filter(date__gte=date_from)
    if date_to:
        stock_prds = stock_prds.filter(date__lte=date_to)
    for prd in stock_prds:
        if prd.id not in prd_map:
            prd_map[prd.id] = prd
            all_prd_ids.add(prd.id)

    # ── 3. Fetch WZ for all ZAM orders ───────────────────────────────────────────
    wz_docs_qs = (
        DeliveryDocument.objects.filter(
            company=company,
            document_type=DeliveryDocument.DOC_TYPE_WZ,
            order_id__in=all_zam_order_ids,
        )
        .prefetch_related("items", "items__product")
    )
    wz_by_order: dict = defaultdict(list)
    for wz in wz_docs_qs:
        wz_by_order[wz.order_id].append(wz)

    # ── 4. Fetch invoices for all ZAM orders ─────────────────────────────────────
    invoices_via_junction = (
        InvoiceOrder.objects.filter(order_id__in=all_zam_order_ids)
        .select_related("invoice")
    )
    invoices_via_legacy = Invoice.objects.filter(order_id__in=all_zam_order_ids)

    invoice_by_order: dict = defaultdict(dict)
    for io in invoices_via_junction:
        invoice_by_order[io.order_id][io.invoice_id] = io.invoice
    for inv in invoices_via_legacy:
        if inv.order_id:
            invoice_by_order[inv.order_id][inv.id] = inv

    all_invoice_ids = {inv_id for invs in invoice_by_order.values() for inv_id in invs}
    inv_items_by_inv: dict = defaultdict(lambda: defaultdict(Decimal))
    if all_invoice_ids:
        for ii in InvoiceItem.objects.filter(invoice_id__in=all_invoice_ids, is_removed=False):
            if ii.product_id:
                inv_items_by_inv[ii.invoice_id][ii.product_id] += ii.quantity or Decimal("0")

    # ── 5. Stock per finished product ────────────────────────────────────────────
    stock_by_product: dict = defaultdict(Decimal)
    for ps in ProductStock.objects.filter(company=company, product_id__in=finished_product_ids):
        stock_by_product[ps.product_id] += (ps.quantity_available or Decimal("0"))

    # Stock on date_from: last StockMovement before date_from → quantity_after
    # This gives the accurate opening stock for the report period.
    stock_before_by_product: dict = {}
    if date_from and finished_product_ids:
        from datetime import datetime, time as dt_time
        from django.db import connection
        date_from_dt = tz.make_aware(datetime.combine(date_from, dt_time.min))
        # One query: for each product pick quantity_after of the latest movement before date_from.
        # Uses DISTINCT ON (product_id) ORDER BY product_id, created_at DESC — PostgreSQL only.
        # Falls back to per-product loop for other backends.
        try:
            rows = (
                StockMovement.objects
                .filter(company=company, product_id__in=finished_product_ids, created_at__lt=date_from_dt)
                .order_by('product_id', '-created_at')
                .distinct('product_id')
                .values('product_id', 'quantity_after')
            )
            for row in rows:
                stock_before_by_product[row['product_id']] = row['quantity_after']
        except Exception:
            # Fallback for non-PostgreSQL (e.g. SQLite in tests)
            for pid in finished_product_ids:
                mov = (
                    StockMovement.objects
                    .filter(company=company, product_id=pid, created_at__lt=date_from_dt)
                    .order_by('-created_at')
                    .values('quantity_after')
                    .first()
                )
                if mov is not None:
                    stock_before_by_product[pid] = mov['quantity_after']

    # ── 6. Build result per product ───────────────────────────────────────────────
    result = []

    for product_id_int, zam_items in zam_by_product.items():
        sample_product = zam_items[0].product
        product_uuid = str(sample_product.uuid)
        product_name = sample_product.name
        product_unit = sample_product.unit or ""
        stock_available = stock_by_product.get(product_id_int) if product_id_int in stock_by_product else None

        qty_produced_total = Decimal("0")
        qty_delivered_total = Decimal("0")
        qty_invoiced_total = Decimal("0")
        has_alerts = False

        # Collect all unique PRDs for ZAMs of this product
        seen_prd_ids: set = set()
        production_runs = []
        unscheduled_orders = []

        # Process each ZAM
        for zam_item in zam_items:
            order = zam_item.order
            order_id_int = order.id
            # Check if any PRD for this order produces THIS product
            prds_for_this_product = [
                prd for prd in prd_by_order.get(order_id_int, [])
                if prd.recipe and prd.recipe.product_id == product_id_int
            ]

            if not prds_for_this_product:
                # No PRD for this product from this ZAM — unscheduled
                is_overdue = order.delivery_date and order.delivery_date < today
                unscheduled_orders.append({
                    "order_id": str(order.uuid),
                    "order_number": order.order_number or "",
                    "customer_name": order.customer.name if order.customer_id else "",
                    "qty": zam_item.quantity,
                    "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
                    "is_overdue": is_overdue,
                })
                has_alerts = True

        if unscheduled_orders:
            has_alerts = True

        # Collect unique PRDs touching any ZAM of this product in the window
        prd_ids_for_product: set = set()
        for zam_item in zam_items:
            for prd in prd_by_order.get(zam_item.order_id, []):
                # Accept PRD if its recipe produces this product
                if prd.recipe and prd.recipe.product_id == product_id_int:
                    prd_ids_for_product.add(prd.id)

        # Also add stock PRDs for this product
        for prd in stock_prds:
            if prd.recipe and prd.recipe.product_id == product_id_int:
                prd_ids_for_product.add(prd.id)

        for prd_id in prd_ids_for_product:
            prd = prd_map[prd_id]
            qty_produced = prd.quantity_produced or Decimal("0")
            qty_produced_total += qty_produced

            source_orders_list = []
            prd_has_no_source = True

            for link in prd.source_links.all():
                order = link.order
                # Only show source orders that are in our ZAM window for this product
                if order.id not in all_zam_order_ids:
                    continue
                zam_item_match = next((zi for zi in zam_items if zi.order_id == order.id), None)
                if not zam_item_match:
                    continue

                prd_has_no_source = False
                # Show full ordered qty from ZAM, not just the linked qty
                qty_from_order = zam_item_match.quantity

                # WZ
                wz_entries = []
                qty_delivered_for_order = Decimal("0")
                has_draft_wz = False
                for wz in wz_by_order.get(order.id, []):
                    wz_qty = Decimal("0")
                    for witem in wz.items.all():
                        if witem.product_id == product_id_int:
                            wz_qty += witem.quantity_actual or witem.quantity_planned or Decimal("0")
                    if wz.status != "delivered":
                        has_draft_wz = True
                    else:
                        qty_delivered_total += wz_qty
                        qty_delivered_for_order += wz_qty
                    wz_entries.append({
                        "id": str(wz.uuid),
                        "number": wz.document_number or "",
                        "qty": wz_qty,
                        "date": wz.issue_date.isoformat() if wz.issue_date else "",
                        "status": wz.status,
                    })

                # Invoices
                invoice_entries = []
                qty_invoiced_for_order = Decimal("0")
                for inv_id, inv in invoice_by_order.get(order.id, {}).items():
                    inv_qty = inv_items_by_inv.get(inv_id, {}).get(product_id_int, Decimal("0"))
                    qty_invoiced_for_order += inv_qty
                    invoice_entries.append({
                        "id": str(inv.uuid),
                        "number": inv.invoice_number or "",
                        "date": inv.issue_date.isoformat() if inv.issue_date else "",
                        "qty": inv_qty,
                    })

                has_wz = any(w["status"] == "delivered" for w in wz_entries)
                has_invoice = bool(invoice_entries)

                order_alerts = []
                if has_wz and not has_invoice:
                    order_alerts.append("missing_invoice"); has_alerts = True
                if has_draft_wz:
                    order_alerts.append("wz_draft"); has_alerts = True
                if not has_wz and order.delivery_date and order.delivery_date < today:
                    order_alerts.append("delivery_overdue"); has_alerts = True
                if has_wz and qty_delivered_for_order < qty_from_order - Decimal("0.01"):
                    order_alerts.append("partial_delivery"); has_alerts = True

                qty_invoiced_total += qty_invoiced_for_order

                source_orders_list.append({
                    "order_id": str(order.uuid),
                    "order_number": order.order_number or "",
                    "customer_name": order.customer.name if order.customer_id else "",
                    "qty_from_order": qty_from_order,
                    "qty_delivered": qty_delivered_for_order,
                    "qty_invoiced": qty_invoiced_for_order,
                    "wz_docs": wz_entries,
                    "invoices": invoice_entries,
                    "has_wz": has_wz,
                    "has_invoice": has_invoice,
                    "alerts": order_alerts,
                })

            prd_alerts = []
            if prd_has_no_source:
                if prd.is_stock_production:
                    prd_alerts.append("stock_production")
                else:
                    prd_alerts.append("no_source_orders")
                    has_alerts = True

            production_runs.append({
                "id": str(prd.uuid),
                "prd_number": prd.order_number or "",
                "date": prd.date.isoformat() if prd.date else "",
                "status": prd.status,
                "qty_produced": qty_produced,
                "total_input_cost": prd.total_input_cost,
                "real_unit_cost": prd.real_unit_cost,
                "rw_number": prd.rw_document.document_number if prd.rw_document else None,
                "rw_id": str(prd.rw_document.uuid) if prd.rw_document else None,
                "pw_number": prd.pw_document.document_number if prd.pw_document else None,
                "pw_id": str(prd.pw_document.uuid) if prd.pw_document else None,
                "source_orders": source_orders_list,
                "alerts": prd_alerts,
            })

        # Prefer stock_before from last StockMovement before date_from (accurate).
        # Fall back to back-calculating from current stock if no movement history.
        # Never show negative — means history is incomplete.
        if product_id_int in stock_before_by_product:
            stock_before = stock_before_by_product[product_id_int]
        elif stock_available is not None:
            stock_before_raw = stock_available - qty_produced_total + qty_delivered_total
            stock_before = stock_before_raw if stock_before_raw >= 0 else None
        else:
            stock_before = None

        result.append({
            "product_id": product_uuid,
            "product_name": product_name,
            "product_unit": product_unit,
            "stock_before": stock_before,
            "stock_available": stock_available,
            "qty_produced": qty_produced_total,
            "qty_delivered": qty_delivered_total,
            "qty_invoiced": qty_invoiced_total,
            "has_alerts": has_alerts,
            "production_runs": production_runs,
            "unscheduled_orders": unscheduled_orders,
        })

    return sorted(result, key=lambda x: x["product_name"])

"""Business logic for van routes (decoupled from HTTP layer)."""

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.delivery.models import DeliveryItem
from apps.delivery.services import create_van_loading_mm
from apps.orders.models import Order
from apps.products.models import ProductStock, Warehouse

from .models import VanRoute


def get_van_route_for_document(company_id, van_route_id) -> VanRoute | None:
    """Resolve van route for linking a delivery document; None if id omitted."""
    if not van_route_id:
        return None
    try:
        return VanRoute.objects.get(uuid=van_route_id, company_id=company_id)
    except VanRoute.DoesNotExist:
        raise ValidationError({"van_route_id": "Van route not found or not accessible."})


def validate_wz_van_route_link(
    route: VanRoute,
    *,
    order: Order | None = None,
    issue_date=None,
    from_warehouse=None,
) -> None:
    """
    Raise ValidationError when a WZ document should not be linked to this van route.

    Order WZ: order must be on the route, issue_date must match route date.
    Standalone WZ: issue_date must match route date; from_warehouse must match van.
    """
    if order is not None:
        if not route.orders.filter(pk=order.pk).exists():
            raise ValidationError({"van_route_id": "Order is not assigned to this van route."})
    if issue_date is not None and issue_date != route.date:
        raise ValidationError(
            {"van_route_id": "Document issue date must match the van route date."}
        )
    if from_warehouse is not None and str(from_warehouse.pk) != str(route.van_warehouse_id):
        raise ValidationError(
            {"van_route_id": "From warehouse must match the van route's warehouse."}
        )


def _validate_orders_for_route(company_id, order_ids: list) -> list:
    """
    Validate and return Order objects for assignment to a route.
    Raises ValidationError if any order is invalid.
    """
    orders = list(Order.objects.filter(company_id=company_id, id__in=order_ids))
    if len(orders) != len(order_ids):
        raise ValidationError({"order_ids": "One or more orders not found or not accessible."})

    already_routed = (
        Order.objects.filter(id__in=order_ids, van_routes__status__in=VanRoute.ACTIVE_STATUSES)
        .values_list("id", flat=True)
    )
    if already_routed:
        raise ValidationError(
            {"order_ids": f"Some orders are already assigned to an active route: {list(already_routed)}"}
        )

    terminal_orders = (
        Order.objects.filter(
            id__in=order_ids,
            status__in=(Order.STATUS_DELIVERED, Order.STATUS_INVOICED),
        )
        .values_list("order_number", flat=True)
    )
    if terminal_orders:
        numbers = ", ".join(n for n in terminal_orders if n)
        raise ValidationError(
            {"order_ids": f"Some orders have already been delivered or invoiced: {numbers}"}
        )

    return orders


def create_van_route(
    *,
    company_id,
    user,
    date,
    driver_name: str,
    van_name: str,
    van_warehouse,
    main_warehouse,
    order_ids: list,
) -> VanRoute:
    """
    Create a new planned VanRoute and assign orders to it.
    Validates that all orders belong to the company, are not already in an
    active route, have not already been delivered, and have no issued WZ.
    """
    if van_warehouse.company_id != company_id:
        raise ValidationError("Van warehouse must belong to your company.")
    if main_warehouse.company_id != company_id:
        raise ValidationError("Main warehouse must belong to your company.")
    if van_warehouse.warehouse_type != Warehouse.WarehouseType.MOBILE:
        raise ValidationError({"van_warehouse_id": "Van warehouse must be a mobile warehouse."})
    if main_warehouse.warehouse_type != Warehouse.WarehouseType.MAIN:
        raise ValidationError({"main_warehouse_id": "Main warehouse must be a main (MG) warehouse."})

    # Block a second active route for the same van warehouse
    existing_active = VanRoute.objects.filter(
        company_id=company_id,
        van_warehouse=van_warehouse,
        status__in=VanRoute.ACTIVE_STATUSES,
    ).first()
    if existing_active:
        raise ValidationError(
            {
                "van_warehouse_id": (
                    f"Van warehouse already has an active route "
                    f"({existing_active.status}). Close it before starting a new one."
                )
            }
        )

    orders = _validate_orders_for_route(company_id, order_ids)

    with transaction.atomic():
        route = VanRoute.objects.create(
            company_id=company_id,
            user=user,
            date=date,
            driver_name=driver_name,
            van_name=van_name,
            van_warehouse=van_warehouse,
            main_warehouse=main_warehouse,
            status=VanRoute.STATUS_PLANNED,
        )
        route.orders.set(orders)

    return route


def start_loading(route: VanRoute, user, items: list[dict]) -> VanRoute:
    """
    Create MM document (main → van), move stock.
    Transition: planned → loading.
    items: [{"product_id": uuid, "quantity": Decimal}, ...]
    """
    if route.status != VanRoute.STATUS_PLANNED:
        raise ValidationError("Route must be in 'planned' status to start loading.")

    mm = create_van_loading_mm(
        company_id=route.company_id,
        user=user,
        from_warehouse=route.main_warehouse,
        to_warehouse=route.van_warehouse,
        items=items,
        issue_date=route.date,
        driver_name=route.driver_name,
        notes=f"Załadunek trasy {route.id}",
        van_route=route,
    )

    # Snapshot carry-over: find the most recent closed route for the same van
    # and record any items marked 'kept' in its reconciliation summary.
    carry_over = None
    prev_route = (
        VanRoute.objects.filter(
            company_id=route.company_id,
            van_warehouse=route.van_warehouse,
            status=VanRoute.STATUS_CLOSED,
        )
        .exclude(pk=route.pk)
        .order_by("-date", "-created_at")
        .first()
    )
    if prev_route and prev_route.reconciliation_summary:
        kept = [
            item for item in (prev_route.reconciliation_summary.get("items") or [])
            if item.get("action") == "kept"
        ]
        if kept:
            carry_over = [
                {
                    "product_id": item["product_id"],
                    "product_name": item["product_name"],
                    "quantity": item["quantity"],
                    "unit": item["unit"],
                    "from_route_number": prev_route.route_number or str(prev_route.pk)[:8],
                    "from_route_id": str(prev_route.pk),
                }
                for item in kept
            ]

    with transaction.atomic():
        route.mm_document = mm
        route.status = VanRoute.STATUS_LOADING
        update_fields = ["mm_document", "status", "updated_at"]
        if carry_over is not None:
            route.carry_over_items = carry_over
            update_fields.append("carry_over_items")
        route.save(update_fields=update_fields)

    return route


def confirm_loading(route: VanRoute) -> VanRoute:
    """
    Driver confirms van is loaded, route goes on the road.
    Transition: loading → in_progress.
    """
    if route.status != VanRoute.STATUS_LOADING:
        raise ValidationError("Route must be in 'loading' status to confirm loading.")

    route.status = VanRoute.STATUS_IN_PROGRESS
    route.save(update_fields=["status", "updated_at"])
    return route


def close_route(route: VanRoute) -> VanRoute:
    """
    Mark route as closed after reconciliation.
    Accepts loading/in_progress/settling — covers the case where confirm-loading
    was skipped (driver went straight to delivering stops).
    """
    if route.status not in (
        VanRoute.STATUS_LOADING,
        VanRoute.STATUS_IN_PROGRESS,
        VanRoute.STATUS_SETTLING,
    ):
        raise ValidationError("Route must be active (loading/in_progress/settling) to close.")

    route.status = VanRoute.STATUS_CLOSED
    route.save(update_fields=["status", "updated_at"])
    return route

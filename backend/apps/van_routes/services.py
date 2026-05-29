"""Business logic for van routes (decoupled from HTTP layer)."""

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.delivery.services import create_van_loading_mm
from apps.orders.models import Order
from apps.products.models import ProductStock

from .models import VanRoute


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
    Validates that all orders belong to the company and are not already in an
    active route.
    """
    from apps.products.models import Warehouse

    if van_warehouse.company_id != company_id:
        raise ValidationError("Van warehouse must belong to your company.")
    if main_warehouse.company_id != company_id:
        raise ValidationError("Main warehouse must belong to your company.")
    if van_warehouse.warehouse_type != Warehouse.WarehouseType.MOBILE:
        raise ValidationError({"van_warehouse_id": "Van warehouse must be a mobile warehouse."})
    if main_warehouse.warehouse_type != Warehouse.WarehouseType.MAIN:
        raise ValidationError({"main_warehouse_id": "Main warehouse must be a main (MG) warehouse."})

    orders = list(
        Order.objects.filter(company_id=company_id, id__in=order_ids)
    )
    if len(orders) != len(order_ids):
        raise ValidationError({"order_ids": "One or more orders not found or not accessible."})

    # Check none are already in an active route
    already_routed = (
        Order.objects.filter(
            id__in=order_ids,
            van_routes__status__in=VanRoute.ACTIVE_STATUSES,
        )
        .values_list("id", flat=True)
    )
    if already_routed:
        raise ValidationError(
            {"order_ids": f"Some orders are already assigned to an active route: {list(already_routed)}"}
        )

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
        notes=f"Van route {route.id}",
    )

    with transaction.atomic():
        route.mm_document = mm
        route.status = VanRoute.STATUS_LOADING
        route.save(update_fields=["mm_document", "status", "updated_at"])

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

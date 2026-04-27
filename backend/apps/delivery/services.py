"""Business logic for delivery documents (decoupled from HTTP layer)."""

from django.db import transaction
from django.utils import timezone

from apps.orders.models import Order
from apps.products.models import Warehouse

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

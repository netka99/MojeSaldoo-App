"""
Signals that keep OrderItem.quantity_delivered and quantity_returned in sync
whenever a DeliveryItem referencing that order item is saved or deleted.

This makes the fields authoritative — the manual increments in
delivery/views.py complete_delivery are a fast path; these signals are the
safety net that repairs any divergence (cancellation, direct DB edits, etc.).
"""
from decimal import Decimal

from django.db.models import Sum
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver


def _recompute_order_item_quantities(order_item_id) -> None:
    """Recompute quantity_delivered and quantity_returned for one OrderItem from DB."""
    # Lazy imports to avoid circular dependency at module load time.
    from apps.delivery.models import DeliveryDocument, DeliveryItem
    from apps.orders.models import Order, OrderItem

    try:
        oi = OrderItem.objects.select_related("order").get(pk=order_item_id)
    except OrderItem.DoesNotExist:
        return

    base_qs = DeliveryItem.objects.filter(order_item_id=order_item_id)

    delivered = (
        base_qs.filter(
            delivery_document__document_type=DeliveryDocument.DOC_TYPE_WZ,
            delivery_document__status=DeliveryDocument.STATUS_DELIVERED,
        ).aggregate(total=Sum("quantity_actual"))["total"]
        or Decimal("0")
    )

    returned = (
        base_qs.filter(
            delivery_document__document_type=DeliveryDocument.DOC_TYPE_ZW,
            delivery_document__status=DeliveryDocument.STATUS_DELIVERED,
        ).aggregate(total=Sum("quantity_actual"))["total"]
        or Decimal("0")
    )

    OrderItem.objects.filter(pk=order_item_id).update(
        quantity_delivered=delivered,
        quantity_returned=returned,
    )

    # Auto-advance order status based on delivery completeness.
    _sync_order_status(oi.order)


def _sync_order_status(order) -> None:
    """Set order status to partially_delivered / delivered based on item sums."""
    from apps.orders.models import Order, OrderItem

    if order.status in (Order.STATUS_CANCELLED, Order.STATUS_INVOICED):
        return

    items = list(OrderItem.objects.filter(order_id=order.pk))
    if not items:
        return

    total_ordered = sum(i.quantity for i in items)
    total_delivered = sum(i.quantity_delivered for i in items)

    if total_delivered <= 0:
        return

    if total_delivered >= total_ordered:
        if order.status not in (Order.STATUS_DELIVERED, Order.STATUS_INVOICED):
            Order.objects.filter(pk=order.pk).update(status=Order.STATUS_DELIVERED)
    elif order.status not in (
        Order.STATUS_PARTIALLY_DELIVERED,
        Order.STATUS_DELIVERED,
        Order.STATUS_INVOICED,
    ):
        Order.objects.filter(pk=order.pk).update(status=Order.STATUS_PARTIALLY_DELIVERED)


# ── Signal receivers ────────────────────────────────────────────────────────
# Using string sender references avoids circular imports at module load time.

@receiver(post_save, sender="delivery.DeliveryItem")
def on_delivery_item_save(sender, instance, **kwargs):
    if not instance.order_item_id:
        return
    # Only recompute from DB once the document is in its terminal delivered state.
    # During the WZ completion flow (status=in_transit when items are saved), the
    # view handles quantity_delivered manually to avoid race conditions. Firing here
    # would zero quantity_delivered mid-transaction before the view's manual update.
    from apps.delivery.models import DeliveryDocument
    doc_status = (
        DeliveryDocument.objects
        .values_list("status", flat=True)
        .filter(pk=instance.delivery_document_id)
        .first()
    )
    if doc_status != DeliveryDocument.STATUS_DELIVERED:
        return
    _recompute_order_item_quantities(instance.order_item_id)


@receiver(post_delete, sender="delivery.DeliveryItem")
def on_delivery_item_delete(sender, instance, **kwargs):
    if instance.order_item_id:
        _recompute_order_item_quantities(instance.order_item_id)

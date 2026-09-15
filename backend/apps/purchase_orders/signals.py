"""
Signals that update SupplierOrderItem.quantity_received when a PZ linked to a
SupplierOrder is saved or deleted.

The PZ is linked via DeliveryDocument.source_supplier_order.
We update received quantities by summing DeliveryItem.quantity_actual for all
non-cancelled PZ documents that originated from each ZD.
"""
from decimal import Decimal

from django.db.models import Sum
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver


def _sync_received_quantities(supplier_order_id: int) -> None:
    """Recompute quantity_received for every SupplierOrderItem in this ZD."""
    from apps.delivery.models import DeliveryDocument, DeliveryItem

    from .models import SupplierOrder, SupplierOrderItem

    try:
        so = SupplierOrder.objects.get(pk=supplier_order_id)
    except SupplierOrder.DoesNotExist:
        return

    # All non-cancelled PZ docs linked to this ZD
    pz_docs = DeliveryDocument.objects.filter(
        source_supplier_order_id=supplier_order_id,
        document_type=DeliveryDocument.DOC_TYPE_PZ,
    ).exclude(status=DeliveryDocument.STATUS_CANCELLED)

    for item in SupplierOrderItem.objects.filter(supplier_order_id=supplier_order_id):
        received = (
            DeliveryItem.objects.filter(
                delivery_document__in=pz_docs,
                product_id=item.product_id,
            ).aggregate(total=Sum("quantity_actual"))["total"]
            or Decimal("0")
        )
        if received != item.quantity_received:
            item.quantity_received = received
            item.save(update_fields=["quantity_received"])

    so.refresh_status()


@receiver(post_save, sender="delivery.DeliveryDocument")
def on_pz_save(sender, instance, **kwargs):
    """When a PZ is saved, update ZD received quantities."""
    if (
        instance.document_type == "PZ"
        and instance.source_supplier_order_id
    ):
        _sync_received_quantities(instance.source_supplier_order_id)


@receiver(post_delete, sender="delivery.DeliveryDocument")
def on_pz_delete(sender, instance, **kwargs):
    """When a PZ is deleted, update ZD received quantities."""
    if (
        instance.document_type == "PZ"
        and instance.source_supplier_order_id
    ):
        _sync_received_quantities(instance.source_supplier_order_id)

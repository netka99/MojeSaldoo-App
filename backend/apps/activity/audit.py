"""
Audit logging helpers and Django signal handlers.

Usage:
    from apps.activity.audit import log_audit

    log_audit(
        request=request,
        company=invoice.company,
        action='invoice.created',
        obj=invoice,
        after={'number': invoice.number, 'total_gross': str(invoice.total_gross)},
    )
"""
from __future__ import annotations

from typing import Any

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .models import AuditLog


def _get_ip(request) -> str | None:
    if request is None:
        return None
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def log_audit(
    *,
    request=None,
    user=None,
    company,
    action: str,
    obj,
    obj_repr: str = '',
    before: dict | None = None,
    after: dict | None = None,
) -> AuditLog:
    """Create an AuditLog entry. Pass either request or user directly."""
    resolved_user = user
    if resolved_user is None and request is not None:
        u = getattr(request, 'user', None)
        resolved_user = u if u and getattr(u, 'is_authenticated', False) else None

    return AuditLog.objects.create(
        company=company,
        user=resolved_user,
        action=action,
        object_type=type(obj).__name__,
        object_id=str(obj.pk),
        object_repr=obj_repr or str(obj),
        before=before,
        after=after,
        ip_address=_get_ip(request),
    )


# ---------------------------------------------------------------------------
# Invoice signals
# ---------------------------------------------------------------------------

def _invoice_snapshot(invoice) -> dict:
    return {
        'number': getattr(invoice, 'number', ''),
        'status': getattr(invoice, 'status', ''),
        'total_gross': str(getattr(invoice, 'total_gross', '') or ''),
    }


@receiver(pre_save, sender='invoices.Invoice')
def _invoice_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _invoice_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='invoices.Invoice')
def _invoice_post_save(sender, instance, created, **kwargs):
    action = 'invoice.created' if created else 'invoice.updated'
    before = None if created else getattr(instance, '_audit_before', None)
    after = _invoice_snapshot(instance)
    if not created and before == after:
        return  # nothing changed
    AuditLog.objects.create(
        company=instance.company,
        user=getattr(instance, '_audit_user', None),
        action=action,
        object_type='Invoice',
        object_id=str(instance.pk),
        object_repr=getattr(instance, 'number', str(instance.pk)),
        before=before,
        after=after,
        ip_address=getattr(instance, '_audit_ip', None),
    )


@receiver(post_delete, sender='invoices.Invoice')
def _invoice_post_delete(sender, instance, **kwargs):
    AuditLog.objects.create(
        company=instance.company,
        user=getattr(instance, '_audit_user', None),
        action='invoice.deleted',
        object_type='Invoice',
        object_id=str(instance.pk),
        object_repr=getattr(instance, 'number', str(instance.pk)),
        before=_invoice_snapshot(instance),
        after=None,
        ip_address=getattr(instance, '_audit_ip', None),
    )


# ---------------------------------------------------------------------------
# Product signals (price changes)
# ---------------------------------------------------------------------------

def _product_price_snapshot(product) -> dict:
    return {
        'price_net': str(getattr(product, 'price_net', '') or ''),
        'price_gross': str(getattr(product, 'price_gross', '') or ''),
        'vat_rate': str(getattr(product, 'vat_rate', '') or ''),
    }


@receiver(pre_save, sender='products.Product')
def _product_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _product_price_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='products.Product')
def _product_post_save(sender, instance, created, **kwargs):
    if created:
        return  # only log price changes, not creation (too noisy)
    before = getattr(instance, '_audit_before', None)
    after = _product_price_snapshot(instance)
    if before is None or before == after:
        return
    AuditLog.objects.create(
        company=instance.company,
        user=getattr(instance, '_audit_user', None),
        action='product.price_changed',
        object_type='Product',
        object_id=str(instance.pk),
        object_repr=getattr(instance, 'name', str(instance.pk)),
        before=before,
        after=after,
        ip_address=getattr(instance, '_audit_ip', None),
    )


# ---------------------------------------------------------------------------
# Stock adjustment signals
# ---------------------------------------------------------------------------

@receiver(post_save, sender='products.StockMovement')
def _stock_movement_post_save(sender, instance, created, **kwargs):
    if not created:
        return
    product = getattr(instance, 'product', None)
    AuditLog.objects.create(
        company=instance.company,
        user=getattr(instance, '_audit_user', None),
        action='stock.adjusted',
        object_type='StockMovement',
        object_id=str(instance.pk),
        object_repr=str(product.name if product else instance.pk),
        before=None,
        after={
            'product': str(product.pk) if product else None,
            'quantity': str(getattr(instance, 'quantity', '')),
            'movement_type': getattr(instance, 'movement_type', ''),
        },
        ip_address=getattr(instance, '_audit_ip', None),
    )

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

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .models import AuditLog
from .middleware import get_current_user, get_current_ip


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


def _s(val) -> str:
    """Safe str conversion — returns '' for None/falsy."""
    return str(val) if val is not None else ''


def _obj_id(instance) -> str:
    """Return the UUID string for a model instance, falling back to str(pk)."""
    uid = getattr(instance, 'uuid', None)
    return str(uid) if uid is not None else str(instance.pk)


def _d(val) -> str:
    """Format Decimal/numeric value to 2 decimal places."""
    if val is None or val == '':
        return ''
    try:
        from decimal import Decimal, InvalidOperation
        return str(round(Decimal(str(val)), 2))
    except (InvalidOperation, TypeError, ValueError):
        return str(val)


# ---------------------------------------------------------------------------
# Invoice signals
# ---------------------------------------------------------------------------

def _invoice_snapshot(invoice) -> dict:
    return {
        'number': _s(getattr(invoice, 'invoice_number', '')),
        'status': _s(getattr(invoice, 'status', '')),
        'total_gross': _d(getattr(invoice, 'total_gross', '') or ''),
        'vat_amount': _d(getattr(invoice, 'vat_amount', '') or ''),
        'payment_method': _s(getattr(invoice, 'payment_method', '')),
        'paid_at': _s(getattr(invoice, 'paid_at', '') or ''),
        'ksef_status': _s(getattr(invoice, 'ksef_status', '')),
        'is_correction': _s(getattr(invoice, 'is_correction', False)),
        'annotation_zwolnienie': _s(getattr(invoice, 'annotation_zwolnienie', False)),
        'annotation_mpp': _s(getattr(invoice, 'annotation_mpp', False)),
        'annotation_odwrotne': _s(getattr(invoice, 'annotation_odwrotne', False)),
        'bank_account_iban': _s(getattr(invoice, 'bank_account_iban', '') or ''),
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
        return
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action=action,
        object_type='Invoice',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'invoice_number', None) or str(instance.pk),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )


@receiver(post_delete, sender='invoices.Invoice')
def _invoice_post_delete(sender, instance, **kwargs):
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action='invoice.deleted',
        object_type='Invoice',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'invoice_number', None) or str(instance.pk),
        before=_invoice_snapshot(instance),
        after=None,
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# Product signals
# ---------------------------------------------------------------------------

def _product_snapshot(product) -> dict:
    return {
        'name': _s(getattr(product, 'name', '')),
        'price_net': _d(getattr(product, 'price_net', '') or ''),
        'price_gross': _d(getattr(product, 'price_gross', '') or ''),
        'vat_rate': _s(getattr(product, 'vat_rate', '') or ''),
        'sku': _s(getattr(product, 'sku', '') or ''),
        'is_active': _s(getattr(product, 'is_active', True)),
        'unit': _s(getattr(product, 'unit', '') or ''),
    }


@receiver(pre_save, sender='products.Product')
def _product_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _product_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='products.Product')
def _product_post_save(sender, instance, created, **kwargs):
    if created:
        AuditLog.objects.create(
            company=instance.company,
            user=get_current_user(),
            action='product.created',
            object_type='Product',
            object_id=_obj_id(instance),
            object_repr=getattr(instance, 'name', str(instance.pk)),
            before=None,
            after=_product_snapshot(instance),
            ip_address=get_current_ip(),
        )
        return
    before = getattr(instance, '_audit_before', None)
    after = _product_snapshot(instance)
    if before is None or before == after:
        return
    # Determine specific action
    if before.get('price_net') != after.get('price_net') or before.get('price_gross') != after.get('price_gross'):
        action = 'product.price_changed'
    else:
        action = 'product.updated'
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action=action,
        object_type='Product',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'name', str(instance.pk)),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# Stock adjustment signals
# ---------------------------------------------------------------------------

_MOVEMENT_TYPE_LABELS = {
    'purchase': 'Przyjęcie (zakup)',
    'sale': 'Wydanie (sprzedaż)',
    'return': 'Zwrot',
    'adjustment': 'Korekta ręczna',
    'transfer': 'Przesunięcie',
    'damage': 'Uszkodzenie/odpis',
    'reservation': 'Rezerwacja',
    'unreservation': 'Zwolnienie rezerwacji',
}

_REFERENCE_TYPE_LABELS = {
    'delivery': 'Dokument dostawy',
    'DeliveryDocument': 'Dokument dostawy',
    'order': 'Zamówienie',
    'Order': 'Zamówienie',
    'invoice': 'Faktura',
    'Invoice': 'Faktura',
    'production_order': 'Zlecenie produkcji',
    'ProductionOrder': 'Zlecenie produkcji',
}


@receiver(post_save, sender='products.StockMovement')
def _stock_movement_post_save(sender, instance, created, **kwargs):
    if not created:
        return
    product = getattr(instance, 'product', None)
    qty_before = _d(getattr(instance, 'quantity_before', '') or '')
    qty_after = _d(getattr(instance, 'quantity_after', '') or '')
    qty_change = _d(getattr(instance, 'quantity', '') or '')
    movement_type = _s(getattr(instance, 'movement_type', ''))
    reference_type = _s(getattr(instance, 'reference_type', '') or '')
    movement_label = _MOVEMENT_TYPE_LABELS.get(movement_type, movement_type)
    reference_label = _REFERENCE_TYPE_LABELS.get(reference_type, reference_type)
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action='stock.adjusted',
        object_type='StockMovement',
        object_id=_obj_id(instance),
        object_repr=str(product.name if product else instance.pk),
        before={'quantity': qty_before} if qty_before else None,
        after={
            'quantity': qty_after,
            'quantity_change': qty_change,
            'movement_type': movement_label,
            'reference_type': reference_label,
        },
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# DeliveryDocument signals (WZ / PZ / RW / ZW / MM / WZ-KOR / PZ-KOR)
# ---------------------------------------------------------------------------

def _delivery_snapshot(doc) -> dict:
    return {
        'document_number': _s(getattr(doc, 'document_number', '')),
        'status': _s(getattr(doc, 'status', '')),
        'document_type': _s(getattr(doc, 'document_type', '')),
        'issue_date': _s(getattr(doc, 'issue_date', '') or ''),
        'notes': _s(getattr(doc, 'notes', '') or ''),
    }


@receiver(pre_save, sender='delivery.DeliveryDocument')
def _delivery_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _delivery_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='delivery.DeliveryDocument')
def _delivery_post_save(sender, instance, created, **kwargs):
    action = 'delivery.created' if created else 'delivery.updated'
    before = None if created else getattr(instance, '_audit_before', None)
    after = _delivery_snapshot(instance)
    if not created and before == after:
        return
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action=action,
        object_type='DeliveryDocument',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'document_number', str(instance.pk)),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )


@receiver(post_delete, sender='delivery.DeliveryDocument')
def _delivery_post_delete(sender, instance, **kwargs):
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action='delivery.deleted',
        object_type='DeliveryDocument',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'document_number', str(instance.pk)),
        before=_delivery_snapshot(instance),
        after=None,
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# Order signals
# ---------------------------------------------------------------------------

def _order_snapshot(order) -> dict:
    return {
        'order_number': _s(getattr(order, 'order_number', '')),
        'status': _s(getattr(order, 'status', '')),
        'total_gross': _d(getattr(order, 'total_gross', '') or ''),
        'total_net': _d(getattr(order, 'total_net', '') or ''),
        'discount_amount': _d(getattr(order, 'discount_amount', '') or ''),
        'delivery_date': _s(getattr(order, 'delivery_date', '') or ''),
    }


@receiver(pre_save, sender='orders.Order')
def _order_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _order_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='orders.Order')
def _order_post_save(sender, instance, created, **kwargs):
    action = 'order.created' if created else 'order.updated'
    before = None if created else getattr(instance, '_audit_before', None)
    after = _order_snapshot(instance)
    if not created and before == after:
        return
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action=action,
        object_type='Order',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'order_number', str(instance.pk)),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# Customer signals
# ---------------------------------------------------------------------------

def _customer_snapshot(customer) -> dict:
    return {
        'name': _s(getattr(customer, 'name', '')),
        'company_name': _s(getattr(customer, 'company_name', '') or ''),
        'nip': _s(getattr(customer, 'nip', '') or ''),
        'email': _s(getattr(customer, 'email', '') or ''),
        'phone': _s(getattr(customer, 'phone', '') or ''),
        'payment_terms': _s(getattr(customer, 'payment_terms', '')),
        'credit_limit': _s(getattr(customer, 'credit_limit', '') or ''),
        'is_active': _s(getattr(customer, 'is_active', True)),
        'is_individual': _s(getattr(customer, 'is_individual', False)),
    }


@receiver(pre_save, sender='customers.Customer')
def _customer_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _customer_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='customers.Customer')
def _customer_post_save(sender, instance, created, **kwargs):
    if created:
        AuditLog.objects.create(
            company=instance.company,
            user=get_current_user(),
            action='customer.created',
            object_type='Customer',
            object_id=_obj_id(instance),
            object_repr=getattr(instance, 'name', str(instance.pk)),
            before=None,
            after=_customer_snapshot(instance),
            ip_address=get_current_ip(),
        )
        return
    before = getattr(instance, '_audit_before', None)
    after = _customer_snapshot(instance)
    if before is None or before == after:
        return
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action='customer.updated',
        object_type='Customer',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'name', str(instance.pk)),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# Company signals (ustawienia firmy)
# ---------------------------------------------------------------------------

def _company_snapshot(company) -> dict:
    return {
        'name': _s(getattr(company, 'name', '')),
        'nip': _s(getattr(company, 'nip', '') or ''),
        'is_vat_payer': _s(getattr(company, 'is_vat_payer', True)),
        'ksef_environment': _s(getattr(company, 'ksef_environment', '') or ''),
        'ksef_usage': _s(getattr(company, 'ksef_usage', '') or ''),
        'bank_account_iban': _s(getattr(company, 'bank_account_iban', '') or ''),
        'taxation_form': _s(getattr(company, 'taxation_form', '') or ''),
        'price_input_mode': _s(getattr(company, 'price_input_mode', '') or ''),
    }


@receiver(pre_save, sender='users.Company')
def _company_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _company_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='users.Company')
def _company_post_save(sender, instance, created, **kwargs):
    if created:
        return  # nie logujemy tworzenia firmy (onboarding)
    before = getattr(instance, '_audit_before', None)
    after = _company_snapshot(instance)
    if before is None or before == after:
        return
    AuditLog.objects.create(
        company=instance,
        user=get_current_user(),
        action='company.updated',
        object_type='Company',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'name', str(instance.pk)),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )


# ---------------------------------------------------------------------------
# ProductionOrder signals
# ---------------------------------------------------------------------------

def _production_order_snapshot(order) -> dict:
    return {
        'order_number': _s(getattr(order, 'order_number', '')),
        'status': _s(getattr(order, 'status', '')),
    }


@receiver(pre_save, sender='production.ProductionOrder')
def _production_order_pre_save(sender, instance, **kwargs):
    if instance.pk:
        try:
            instance._audit_before = _production_order_snapshot(sender.objects.get(pk=instance.pk))
        except sender.DoesNotExist:
            instance._audit_before = None
    else:
        instance._audit_before = None


@receiver(post_save, sender='production.ProductionOrder')
def _production_order_post_save(sender, instance, created, **kwargs):
    action = 'production_order.created' if created else 'production_order.updated'
    before = None if created else getattr(instance, '_audit_before', None)
    after = _production_order_snapshot(instance)
    if not created and before == after:
        return
    AuditLog.objects.create(
        company=instance.company,
        user=get_current_user(),
        action=action,
        object_type='ProductionOrder',
        object_id=_obj_id(instance),
        object_repr=getattr(instance, 'order_number', str(instance.pk)),
        before=before,
        after=after,
        ip_address=get_current_ip(),
    )

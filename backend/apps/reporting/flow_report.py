"""Per-customer order→WZ→invoice flow report."""
from decimal import Decimal

from django.db.models import Prefetch
from django.utils import timezone as _tz

from apps.delivery.models import DeliveryDocument, DeliveryItem
from apps.invoices.models import Invoice as Inv, InvoiceItem, InvoiceOrder
from apps.orders.models import Order, OrderItem

# Company.invoice_returns_mode values
_RETURNS_FVKOR = "fv_kor"

_OPEN_ORDER = frozenset([
    'draft', 'confirmed', 'in_preparation', 'loaded',
    'in_delivery', 'partially_delivered', 'delivered',
])
_ACTIVE_INV = frozenset(['issued', 'sent', 'paid', 'overdue'])


def _build_orders_prefetch(track_zw: bool):
    """Build prefetch for orders. When track_zw=True, also prefetch ZW return docs on each WZ."""
    wz_items_qs = DeliveryItem.objects.select_related('product')
    wz_prefetch_qs = DeliveryDocument.objects.filter(
        document_type=DeliveryDocument.DOC_TYPE_WZ,
    ).exclude(status='cancelled').prefetch_related(
        Prefetch('items', queryset=wz_items_qs, to_attr='wz_items'),
    )
    if track_zw:
        zw_qs = DeliveryDocument.objects.filter(
            document_type=DeliveryDocument.DOC_TYPE_ZW,
        ).exclude(status='cancelled').prefetch_related(
            Prefetch('items', queryset=wz_items_qs, to_attr='wz_items'),
        )
        wz_prefetch_qs = wz_prefetch_qs.prefetch_related(
            Prefetch('return_documents', queryset=zw_qs, to_attr='zw_docs'),
        )

    inv_prefetch_qs = Inv.objects.filter(
        is_correction=False,
    ).exclude(status__in=['cancelled', 'draft']).prefetch_related(
        Prefetch(
            'items',
            queryset=InvoiceItem.objects.filter(is_removed=False),
            to_attr='inv_items',
        ),
        Prefetch(
            'corrections',
            queryset=Inv.objects.filter(is_correction=True).exclude(status='cancelled'),
            to_attr='active_corrections',
        ),
        Prefetch(
            'invoice_orders',
            queryset=InvoiceOrder.objects.select_related('order'),
            to_attr='all_invoice_orders',
        ),
    )

    return (
        Order.objects
        .prefetch_related(
            Prefetch('delivery_documents', queryset=wz_prefetch_qs, to_attr='wz_docs'),
            Prefetch('invoices', queryset=inv_prefetch_qs, to_attr='active_invoices'),
            Prefetch(
                'invoice_orders',
                queryset=InvoiceOrder.objects.filter(
                    invoice__is_correction=False,
                ).exclude(
                    invoice__status__in=['cancelled', 'draft'],
                ).select_related('invoice').prefetch_related(
                    Prefetch(
                        'invoice__corrections',
                        queryset=Inv.objects.filter(is_correction=True).exclude(status='cancelled'),
                        to_attr='active_corrections',
                    ),
                    Prefetch(
                        'invoice__invoice_orders',
                        queryset=InvoiceOrder.objects.select_related('order'),
                        to_attr='all_invoice_orders',
                    ),
                    Prefetch(
                        'invoice__items',
                        queryset=InvoiceItem.objects.filter(is_removed=False),
                        to_attr='inv_items',
                    ),
                ),
                to_attr='active_invoice_orders',
            ),
            Prefetch(
                'items',
                queryset=OrderItem.objects.select_related('product'),
                to_attr='order_items',
            ),
        )
        .select_related('customer')
        .order_by('customer__name', 'delivery_date')
    )


def _build_invoiced_map(inv_list: list) -> dict:
    """Build product_id → invoiced_qty map from a list of Invoice objects."""
    result: dict = {}
    for inv in inv_list:
        for ii in getattr(inv, 'inv_items', []):
            pid = str(ii.product_id) if ii.product_id else None
            if pid is None:
                continue
            result[pid] = result.get(pid, Decimal('0')) + (ii.quantity or Decimal('0'))
    return result


def _build_order_lines(order) -> list:
    """Return per-product summary for one order: ordered / delivered / invoiced quantities.

    delivered_qty — summed from WZ items (quantity_actual or quantity_planned).
    returned_qty  — summed from:
      - WZ items (quantity_returned) for net_qty mode (returns on WZ lines)
      - ZW items (quantity_actual/planned) for fv_kor mode (separate return docs)
    """
    wz_delivered: dict = {}
    wz_returned: dict = {}
    for wz in getattr(order, 'wz_docs', []):
        for wi in getattr(wz, 'wz_items', []):
            pid = str(wi.product_id) if wi.product_id else None
            if pid is None:
                continue
            delivered = wi.quantity_actual if wi.quantity_actual is not None else wi.quantity_planned
            wz_delivered[pid] = wz_delivered.get(pid, Decimal('0')) + (delivered or Decimal('0'))
            # net_qty mode: returns embedded as quantity_returned on WZ lines
            wz_returned[pid] = wz_returned.get(pid, Decimal('0')) + (wi.quantity_returned or Decimal('0'))
        # fv_kor mode: returns on separate ZW documents
        for zw in getattr(wz, 'zw_docs', []):
            for zi in getattr(zw, 'wz_items', []):
                pid = str(zi.product_id) if zi.product_id else None
                if pid is None:
                    continue
                zw_qty = zi.quantity_actual if zi.quantity_actual is not None else zi.quantity_planned
                wz_returned[pid] = wz_returned.get(pid, Decimal('0')) + (zw_qty or Decimal('0'))

    # Build invoiced map from all invoices linked to this order
    all_invoices = (
        list(getattr(order, 'active_invoices', []))
        + [io.invoice for io in getattr(order, 'active_invoice_orders', [])]
    )
    invoiced_map = _build_invoiced_map(all_invoices)

    lines = []
    for oi in getattr(order, 'order_items', []):
        pid = str(oi.product_id) if oi.product_id else None
        delivered = wz_delivered.get(pid, Decimal('0')) if pid else Decimal('0')
        returned  = wz_returned.get(pid,  Decimal('0')) if pid else Decimal('0')
        invoiced  = invoiced_map.get(pid,  Decimal('0')) if pid else Decimal('0')
        lines.append({
            'product_id': pid,
            'product_name': oi.product_name or (oi.product.name if oi.product_id else '—'),
            'unit': oi.product_unit or '',
            'ordered_qty': str(oi.quantity),
            'delivered_qty': str(delivered),
            'returned_qty': str(returned),
            'invoiced_qty': str(invoiced),
            'unit_price_gross': str(oi.unit_price_gross),
        })
    return lines


def _serialize_invoice(inv, date_from=None, date_to=None) -> dict:
    """Serialize invoice with its corrections. Flags cross-period multi-order invoices."""
    corrections = [
        {
            'id': str(kor.uuid),
            'number': kor.invoice_number,
            'status': kor.status,
            'issue_date': str(kor.issue_date) if kor.issue_date else None,
            'total_gross': str(kor.total_gross or 0),
            'correction_reason': kor.correction_reason or '',
        }
        for kor in getattr(inv, 'active_corrections', [])
    ]
    # Detect multi-order invoice where some orders fall outside the report period
    cross_period = False
    all_ios = getattr(inv, 'all_invoice_orders', None)
    if date_from and date_to and all_ios is not None and len(all_ios) > 1:
        for io in all_ios:
            if io.order_id and (
                io.order.delivery_date < date_from or io.order.delivery_date > date_to
            ):
                cross_period = True
                break

    return {
        'id': str(inv.uuid),
        'number': inv.invoice_number,
        'status': inv.status,
        'due_date': str(inv.due_date) if inv.due_date else None,
        'total_gross': str(inv.total_gross or 0),
        'corrections': corrections,
        'cross_period': cross_period,
    }


def _build_invoiced_map_lines(inv) -> list:
    """Return line list from a single invoice's items (for manual invoice display)."""
    return [
        {
            'product_name': ii.product_name or '—',
            'unit': ii.product_unit or '',
            'quantity': str(ii.quantity),
        }
        for ii in getattr(inv, 'inv_items', [])
    ]


def _wz_has_zw_without_fvkor(wz, inv_list: list) -> bool:
    """Return True if the WZ has ZW return documents but none of its linked invoices have a FV-KOR."""
    zw_docs = getattr(wz, 'zw_docs', [])
    if not zw_docs:
        return False
    for inv in inv_list:
        if getattr(inv, 'active_corrections', None):
            return False
    return True


def build_customer_flow(company, date_from, date_to):
    today = _tz.localdate()
    wz_required = getattr(company, 'wz_required_before_invoice', False)
    returns_mode = getattr(company, 'invoice_returns_mode', _RETURNS_FVKOR)
    track_zw = (returns_mode == _RETURNS_FVKOR)

    orders_qs = _build_orders_prefetch(track_zw=track_zw).filter(
        company=company,
        delivery_date__gte=date_from,
        delivery_date__lte=date_to,
    )

    _standalone_inv_qs = Inv.objects.filter(
        is_correction=False,
    ).exclude(status__in=['cancelled', 'draft'])
    if track_zw:
        _standalone_inv_qs = _standalone_inv_qs.prefetch_related(
            Prefetch(
                'corrections',
                queryset=Inv.objects.filter(is_correction=True).exclude(status='cancelled'),
                to_attr='active_corrections',
            )
        )

    _standalone_wz_qs_base = DeliveryDocument.objects.filter(
        company=company,
        document_type=DeliveryDocument.DOC_TYPE_WZ,
        issue_date__gte=date_from,
        issue_date__lte=date_to,
        order__isnull=True,
    ).exclude(status='cancelled').select_related('to_customer')

    if track_zw:
        _standalone_wz_qs_base = _standalone_wz_qs_base.prefetch_related(
            Prefetch(
                'return_documents',
                queryset=DeliveryDocument.objects.filter(
                    document_type=DeliveryDocument.DOC_TYPE_ZW,
                ).exclude(status='cancelled'),
                to_attr='zw_docs',
            )
        )

    standalone_wz_qs = _standalone_wz_qs_base.prefetch_related(
        Prefetch('invoices', queryset=_standalone_inv_qs, to_attr='active_invoices')
    )

    # Manual invoices: no Order FK, no InvoiceOrder, filtered by issue_date
    manual_inv_qs = (
        Inv.objects.filter(
            company=company,
            issue_date__gte=date_from,
            issue_date__lte=date_to,
            is_correction=False,
            order__isnull=True,
        )
        .exclude(status__in=['cancelled', 'draft'])
        .filter(invoice_orders__isnull=True)
        .select_related('customer')
        .prefetch_related(
            Prefetch(
                'items',
                queryset=InvoiceItem.objects.filter(is_removed=False),
                to_attr='inv_items',
            )
        )
    )

    # Build per-customer buckets
    buckets: dict = {}

    def _bucket(cust_id, cust_name):
        if cust_id not in buckets:
            buckets[cust_id] = {
                'customer_id': str(cust_id),
                'customer_name': cust_name,
                'orders': [],
                'standalone_wz': [],
                'invoice_ids': set(),
                'invoices': [],
                'manual_invoices': [],
            }
        return buckets[cust_id]

    for order in orders_qs:
        if not order.customer_id:
            continue
        b = _bucket(order.customer_id, order.customer.name)
        b['orders'].append(order)
        for inv in getattr(order, 'active_invoices', []):
            if inv.pk not in b['invoice_ids']:
                b['invoice_ids'].add(inv.pk)
                b['invoices'].append(inv)
        for io in getattr(order, 'active_invoice_orders', []):
            inv = io.invoice
            if inv.pk not in b['invoice_ids']:
                b['invoice_ids'].add(inv.pk)
                b['invoices'].append(inv)

    for wz in standalone_wz_qs:
        cid = wz.to_customer_id
        if not cid:
            continue
        cname = wz.to_customer.name if wz.to_customer_id else 'Bez klienta'
        b = _bucket(cid, cname)
        b['standalone_wz'].append(wz)
        for inv in getattr(wz, 'active_invoices', []):
            if inv.pk not in b['invoice_ids']:
                b['invoice_ids'].add(inv.pk)
                b['invoices'].append(inv)

    for inv in manual_inv_qs:
        if not inv.customer_id:
            continue
        b = _bucket(inv.customer_id, inv.customer.name)
        b['manual_invoices'].append(inv)

    results = []
    for b in sorted(buckets.values(), key=lambda x: x['customer_name'].lower()):
        orders   = b['orders']
        stan_wz  = b['standalone_wz']
        invoices = b['invoices']
        manual_invoices = b['manual_invoices']

        order_total     = len(orders)
        order_open      = sum(1 for o in orders if o.status in _OPEN_ORDER)
        order_cancelled = sum(1 for o in orders if o.status == 'cancelled')
        order_invoiced  = sum(1 for o in orders if o.status == 'invoiced')

        # Build order-level WZ list paired with its order's invoices for invoice check
        order_wz_pairs = [
            (wz, o)
            for o in orders
            for wz in getattr(o, 'wz_docs', [])
        ]
        all_wz = [wz for wz, _ in order_wz_pairs] + stan_wz
        wz_total = len(all_wz)
        wz_no_invoice = 0
        for wz, o in order_wz_pairs:
            if wz.status in ('delivered', 'in_transit', 'saved'):
                order_has_inv = (
                    bool(getattr(o, 'active_invoices', []))
                    or bool(getattr(o, 'active_invoice_orders', []))
                )
                if not order_has_inv:
                    wz_no_invoice += 1
        for wz in stan_wz:
            if wz.status in ('delivered', 'in_transit', 'saved') and not getattr(wz, 'active_invoices', []):
                wz_no_invoice += 1

        all_invoices = invoices + manual_invoices
        inv_total   = len(all_invoices)
        inv_overdue = sum(
            1 for inv in all_invoices
            if inv.status == 'overdue'
            or (inv.status in ('issued', 'sent') and inv.due_date and inv.due_date < today)
        )
        inv_gross = sum((inv.total_gross or Decimal('0')) for inv in all_invoices)

        problems = set()
        if wz_required:
            for o in orders:
                if o.status in ('delivered', 'invoiced') and not getattr(o, 'wz_docs', []):
                    problems.add('delivered_no_wz')
                    break
        if wz_no_invoice > 0:
            problems.add('wz_no_invoice')
        for o in orders:
            if o.status == 'delivered':
                has_inv = (bool(getattr(o, 'active_invoices', []))
                           or bool(getattr(o, 'active_invoice_orders', [])))
                if not has_inv:
                    problems.add('delivered_no_invoice')
                    break
        if inv_overdue > 0:
            problems.add('invoice_overdue')
        if track_zw:
            # For order-linked WZs, use the order's invoices; standalone WZs use wz.active_invoices
            order_inv_map = {
                wz: (
                    [io.invoice for io in getattr(o, 'active_invoice_orders', [])]
                    + list(getattr(o, 'active_invoices', []))
                )
                for wz, o in order_wz_pairs
            }
            for wz in all_wz:
                inv_list_for_wz = order_inv_map.get(wz) or list(getattr(wz, 'active_invoices', []))
                if _wz_has_zw_without_fvkor(wz, inv_list_for_wz):
                    problems.add('wz_zw_no_fvkor')
                    break

        # Per-order detail
        orders_detail = []
        for o in orders:
            wz_list = getattr(o, 'wz_docs', [])
            inv_list = (
                [io.invoice for io in getattr(o, 'active_invoice_orders', [])]
                + list(getattr(o, 'active_invoices', []))
            )
            seen_inv = set()
            inv_deduped = []
            for inv in inv_list:
                if inv.pk not in seen_inv:
                    seen_inv.add(inv.pk)
                    inv_deduped.append(inv)

            # row-level problem flag
            row_ok = True
            row_problem = None
            if o.status == 'delivered' and not inv_deduped:
                row_ok = False
                row_problem = 'delivered_no_invoice'
            elif wz_required and o.status in ('delivered', 'invoiced') and not wz_list:
                row_ok = False
                row_problem = 'delivered_no_wz'
            elif any(
                inv.status == 'overdue'
                or (inv.status in ('issued', 'sent') and inv.due_date and inv.due_date < today)
                for inv in inv_deduped
            ):
                row_ok = False
                row_problem = 'invoice_overdue'
            elif track_zw and any(
                _wz_has_zw_without_fvkor(w, inv_deduped) for w in wz_list
            ):
                row_ok = False
                row_problem = 'wz_zw_no_fvkor'

            orders_detail.append({
                'id': str(o.uuid),
                'order_number': o.order_number,
                'delivery_date': str(o.delivery_date),
                'status': o.status,
                'total_gross': str(o.total_gross or 0),
                'lines': _build_order_lines(o),
                'wz': [
                    {
                        'id': str(w.uuid),
                        'number': w.document_number,
                        'status': w.status,
                        'zw': [
                            {'id': str(z.uuid), 'number': z.document_number}
                            for z in getattr(w, 'zw_docs', [])
                        ] if track_zw else [],
                    }
                    for w in wz_list
                ],
                'invoices': [
                    _serialize_invoice(inv, date_from, date_to)
                    for inv in inv_deduped
                ],
                'ok': row_ok,
                'problem': row_problem,
            })

        for wz in stan_wz:
            inv_list = list(getattr(wz, 'active_invoices', []))
            if not inv_list and wz.status in ('delivered', 'in_transit', 'saved'):
                row_problem = 'wz_no_invoice'
            elif track_zw and _wz_has_zw_without_fvkor(wz, inv_list):
                row_problem = 'wz_zw_no_fvkor'
            else:
                row_problem = None
            wz_entry = {
                'id': str(wz.uuid),
                'number': wz.document_number,
                'status': wz.status,
                'zw': [
                    {'id': str(z.uuid), 'number': z.document_number}
                    for z in getattr(wz, 'zw_docs', [])
                ] if track_zw else [],
            }
            orders_detail.append({
                'id': None,
                'order_number': None,
                'delivery_date': str(wz.issue_date),
                'status': None,
                'total_gross': None,
                'lines': [],
                'wz': [wz_entry],
                'invoices': [
                    _serialize_invoice(inv, date_from, date_to)
                    for inv in inv_list
                ],
                'ok': row_problem is None,
                'problem': row_problem,
            })

        manual_detail = [
            {
                'id': str(inv.uuid),
                'number': inv.invoice_number,
                'status': inv.status,
                'issue_date': str(inv.issue_date) if inv.issue_date else None,
                'due_date': str(inv.due_date) if inv.due_date else None,
                'total_gross': str(inv.total_gross or 0),
                'lines': _build_invoiced_map_lines(inv),
            }
            for inv in manual_invoices
        ]

        results.append({
            'customer_id':   b['customer_id'],
            'customer_name': b['customer_name'],
            'orders': {
                'total': order_total,
                'open':  order_open,
                'invoiced': order_invoiced,
                'cancelled': order_cancelled,
            },
            'wz': {
                'total': wz_total,
                'without_invoice': wz_no_invoice,
            },
            'invoices': {
                'total': inv_total,
                'overdue': inv_overdue,
                'total_gross': str(inv_gross),
            },
            'problems': sorted(problems),
            'orders_detail': orders_detail,
            'manual_invoices': manual_detail,
        })

    return {
        'period': {'date_from': date_from, 'date_to': date_to},
        'wz_required': wz_required,
        'returns_mode': returns_mode,
        'customers': results,
    }

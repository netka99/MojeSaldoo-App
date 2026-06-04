import type { DeliveryDocument } from '@/types';

function itemQty(item: { quantity_actual: string | number | null; quantity_planned: string | number }): number {
  if (item.quantity_actual != null) {
    const n = parseFloat(String(item.quantity_actual));
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseFloat(String(item.quantity_planned));
  return Number.isFinite(n) ? n : 0;
}

/** Sum line quantities per product for delivered WZ documents only. */
export function sumDeliveredWzByProduct(wzDocs: DeliveryDocument[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const wz of wzDocs ?? []) {
    if (wz.status !== 'delivered') continue;
    for (const item of wz.items ?? []) {
      m.set(item.product_id, (m.get(item.product_id) ?? 0) + itemQty(item));
    }
  }
  return m;
}

/** Sum planned quantities per product on WZ that are not yet delivered. */
export function sumPendingWzByProduct(wzDocs: DeliveryDocument[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const wz of wzDocs ?? []) {
    if (wz.status === 'delivered' || wz.status === 'cancelled') continue;
    for (const item of wz.items ?? []) {
      const n = parseFloat(String(item.quantity_planned));
      const qty = Number.isFinite(n) ? n : 0;
      m.set(item.product_id, (m.get(item.product_id) ?? 0) + qty);
    }
  }
  return m;
}

export function countPendingWzDocs(wzDocs: DeliveryDocument[] | undefined): number {
  return (wzDocs ?? []).filter((wz) => wz.status !== 'delivered' && wz.status !== 'cancelled').length;
}

import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import type { Order, OrderStatus } from '@/types';

export type OrderHistoryEntry = {
  /** ISO timestamp for sorting and display */
  at: string;
  kind: 'created' | 'confirmed' | 'delivered' | 'cancelled';
  label: string;
  sub: string;
};

/**
 * Build a timeline from order timestamps. The API does not expose a full event log; we derive
 * entries from `created_at`, `confirmed_at`, `delivered_at`, and `updated_at` when status is
 * `cancelled`.
 */
export function buildOrderStatusHistory(o: Order): OrderHistoryEntry[] {
  const list: OrderHistoryEntry[] = [
    {
      at: o.created_at,
      kind: 'created',
      label: 'Utworzono',
      sub: 'Zamówienie zarejestrowane w systemie',
    },
  ];
  if (o.confirmed_at) {
    list.push({
      at: o.confirmed_at,
      kind: 'confirmed',
      label: 'Potwierdzono',
      sub: `Status: ${ORDER_STATUS_LABELS_PL.confirmed}`,
    });
  }
  if (o.delivered_at) {
    list.push({
      at: o.delivered_at,
      kind: 'delivered',
      label: 'Dostawiono',
      sub: 'Zarejestrowano datę realizacji dostawy',
    });
  }
  if (o.status === 'cancelled') {
    list.push({
      at: o.updated_at,
      kind: 'cancelled',
      label: 'Anulowano',
      sub: `Wycofano zamówienie (${ORDER_STATUS_LABELS_PL.cancelled})`,
    });
  }
  list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return list;
}

export function isOrderCancellableStatus(status: OrderStatus): boolean {
  return status === 'draft' || status === 'confirmed';
}

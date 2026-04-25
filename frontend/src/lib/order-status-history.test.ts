import { describe, it, expect } from 'vitest';
import { buildOrderStatusHistory, isOrderCancellableStatus } from './order-status-history';
import type { Order } from '@/types';

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o-1',
    customer_id: 'c-1',
    customer_name: 'ACME',
    company: 'co-1',
    user: null,
    order_number: 'ZAM/1',
    order_date: '2026-01-10',
    delivery_date: '2026-01-20',
    status: 'draft',
    subtotal_net: '10',
    subtotal_gross: '12.3',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '10',
    total_gross: '12.3',
    customer_notes: '',
    internal_notes: '',
    created_at: '2026-01-10T10:00:00.000Z',
    updated_at: '2026-01-10T10:00:00.000Z',
    confirmed_at: null,
    delivered_at: null,
    items: [],
    ...over,
  };
}

describe('order-status-history', () => {
  it('buildOrderStatusHistory: draft only has created', () => {
    const o = makeOrder();
    const h = buildOrderStatusHistory(o);
    expect(h).toHaveLength(1);
    expect(h[0]!.kind).toBe('created');
  });

  it('buildOrderStatusHistory: includes confirmed and delivered', () => {
    const o = makeOrder({
      status: 'delivered',
      confirmed_at: '2026-01-10T12:00:00.000Z',
      delivered_at: '2026-01-15T16:00:00.000Z',
      updated_at: '2026-01-15T16:00:00.000Z',
    });
    const h = buildOrderStatusHistory(o);
    expect(h.map((e) => e.kind)).toEqual(['created', 'confirmed', 'delivered']);
  });

  it('buildOrderStatusHistory: cancelled adds cancellation entry', () => {
    const o = makeOrder({
      status: 'cancelled',
      updated_at: '2026-01-11T09:00:00.000Z',
    });
    const h = buildOrderStatusHistory(o);
    expect(h.some((e) => e.kind === 'cancelled')).toBe(true);
  });

  it('isOrderCancellableStatus', () => {
    expect(isOrderCancellableStatus('draft')).toBe(true);
    expect(isOrderCancellableStatus('confirmed')).toBe(true);
    expect(isOrderCancellableStatus('delivered')).toBe(false);
  });
});

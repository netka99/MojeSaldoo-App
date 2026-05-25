/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  formatDeliveryDateLong,
  formatMoneyGross,
  formatOrderLineQuantityWithUnit,
  orderStatusBadgeClassName,
  sumOrdersGross,
} from './order-utils';
import type { Order } from '@/types';

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    customer_id: 'c-1',
    customer_name: 'Jan Kowalski',
    company: 'co-1',
    user: null,
    order_number: 'ZAM/2026/01',
    order_date: '2026-04-01',
    delivery_date: '2026-04-20',
    status: 'confirmed',
    subtotal_net: '100.00',
    subtotal_gross: '123.00',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '100.00',
    total_gross: '123.00',
    customer_notes: '',
    internal_notes: '',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    confirmed_at: '2026-04-01T10:00:00Z',
    delivered_at: null,
    items: [],
    ...over,
  };
}

describe('orderStatusBadgeClassName', () => {
  it('maps all status values to the expected Tailwind class fragments', () => {
    expect(orderStatusBadgeClassName('draft')).toContain('surface-container');
    expect(orderStatusBadgeClassName('confirmed')).toContain('blue');
    expect(orderStatusBadgeClassName('delivered')).toContain('green');
    expect(orderStatusBadgeClassName('cancelled')).toContain('red');
    expect(orderStatusBadgeClassName('in_preparation')).toContain('amber');
    expect(orderStatusBadgeClassName('loaded')).toContain('amber');
    expect(orderStatusBadgeClassName('in_delivery')).toContain('amber');
    expect(orderStatusBadgeClassName('invoiced')).toContain('violet');
  });
});

describe('sumOrdersGross', () => {
  it('returns 0 for an empty list', () => {
    expect(sumOrdersGross([])).toBe(0);
  });

  it('sums string and number total_gross values', () => {
    const orders = [
      makeOrder({ id: 'a', total_gross: '10.5' }),
      makeOrder({ id: 'b', total_gross: 2.25 }),
    ];
    expect(sumOrdersGross(orders)).toBeCloseTo(12.75);
  });

  it('skips NaN total_gross values', () => {
    const orders = [
      makeOrder({ id: 'a', total_gross: '10' }),
      makeOrder({ id: 'b', total_gross: 'nope' }),
      makeOrder({ id: 'c', total_gross: Number.NaN }),
    ];
    expect(sumOrdersGross(orders)).toBe(10);
  });
});

describe('formatMoneyGross', () => {
  it('formats valid numbers in PLN', () => {
    expect(formatMoneyGross(123.45)).toMatch(/123/);
    expect(formatMoneyGross(123.45)).toMatch(/PLN|zł/i);
  });

  it('returns em dash for NaN input', () => {
    expect(formatMoneyGross('not-a-number')).toBe('—');
    expect(formatMoneyGross(Number.NaN)).toBe('—');
  });
});

describe('formatOrderLineQuantityWithUnit', () => {
  it('formats integers and uses default unit', () => {
    expect(formatOrderLineQuantityWithUnit(20, '')).toBe('20 szt.');
    expect(formatOrderLineQuantityWithUnit('3', 'kg')).toBe('3 kg');
  });

  it('uses pl-PL decimal formatting for non-integers', () => {
    expect(formatOrderLineQuantityWithUnit(3.5, 'kg')).toMatch(/3/);
    expect(formatOrderLineQuantityWithUnit(3.5, 'kg')).toContain('kg');
  });
});

describe('formatDeliveryDateLong', () => {
  it('includes Polish weekday and month names for a valid YYYY-MM-DD', () => {
    // 2026-05-12 is Tuesday — calendar date (local) matches delivery_date strings from the API
    const s = formatDeliveryDateLong('2026-05-12');
    expect(s).not.toBe('—');
    expect(s.toLowerCase()).toContain('wtorek');
    expect(s.toLowerCase()).toContain('maja');
  });
});

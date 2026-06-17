import { describe, it, expect } from 'vitest';
import type { DeliveryDocument } from '@/types';
import { countPendingWzDocs, sumDeliveredWzByProduct, sumPendingWzByProduct } from './van-wz-utils';

const base = {
  company: 'c1',
  order_id: null,
  order_number: null,
  customer_name: '',
  user: 1,
  document_type: 'WZ' as const,
  document_number: 'WZ/1',
  issue_date: '2026-06-02',
  from_warehouse_id: 'w1',
  to_warehouse_id: null,
  to_customer_id: null,
  driver_name: '',
  has_returns: false,
  returns_notes: '',
  receiver_name: '',
  notes: '',
  delivered_at: null,
  created_at: '',
  updated_at: '',
};

function wz(
  status: DeliveryDocument['status'],
  items: DeliveryDocument['items'],
): DeliveryDocument {
  return { ...base, id: `wz-${status}`, status, items };
}

describe('van-wz-utils', () => {
  it('counts only delivered WZ lines as sold', () => {
    const docs = [
      wz('delivered', [
        {
          id: 'i1',
          order_item_id: null,
          product_id: 'p1',
          quantity_planned: '5',
          quantity_actual: '5',
          quantity_returned: '0',
          return_reason: '',
          is_damaged: false,
          notes: '',
          created_at: '',
        },
      ]),
      wz('draft', [
        {
          id: 'i2',
          order_item_id: null,
          product_id: 'p1',
          quantity_planned: '3',
          quantity_actual: null,
          quantity_returned: '0',
          return_reason: '',
          is_damaged: false,
          notes: '',
          created_at: '',
        },
      ]),
    ];
    expect(sumDeliveredWzByProduct(docs).get('p1')).toBe(5);
    expect(sumPendingWzByProduct(docs).get('p1')).toBe(3);
    expect(countPendingWzDocs(docs)).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import type {
  StockSnapshot,
  StockSnapshotItem,
  VanReconciliationItemPayload,
  VanReconciliationPayload,
  VanReconciliationResult,
} from '@/types';

/** Ensures `export *` from `product.types` + `delivery.types` re-exports van reconciliation and stock snapshot. */
describe('@/types barrel — van reconciliation + stock snapshot', () => {
  it('allows constructing shapes for the van reconciliation feature', () => {
    const line: VanReconciliationItemPayload = { product_id: 'p-1', quantity_actual: '1.000' };
    const body: VanReconciliationPayload = {
      reconciliation_date: '2026-04-27',
      notes: 'x',
      items: [line],
    };
    const item: StockSnapshotItem = {
      product_id: 'p-1',
      product_name: 'A',
      sku: null,
      unit: 'szt',
      quantity_available: '0',
    };
    const snap: StockSnapshot = { warehouse_id: 'w-1', warehouse_name: 'W', items: [item] };
    const res: VanReconciliationResult = {
      warehouse_id: 'w-1',
      warehouse_name: 'W',
      reconciliation_date: '2026-04-27',
      items: [],
      total_discrepancies: 0,
      has_discrepancies: false,
    };
    expect(body.items[0].quantity_actual).toBe('1.000');
    expect(snap.items[0].product_id).toBe('p-1');
    expect(res.has_discrepancies).toBe(false);
  });
});

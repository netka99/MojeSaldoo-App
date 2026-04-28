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
    const line: VanReconciliationItemPayload = {
      product_id: 'p-1',
      quantity_actual_remaining: '1.00',
    };
    const body: VanReconciliationPayload = {
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
      van_warehouse_id: 'w-1',
      reconciliation_id: null,
      reconciled_at: new Date().toISOString(),
      discrepancies: [],
      items_processed: 0,
    };
    expect(body.items[0].quantity_actual_remaining).toBe('1.00');
    expect(snap.items[0].product_id).toBe('p-1');
    expect(res.discrepancies.length).toBe(0);
  });
});

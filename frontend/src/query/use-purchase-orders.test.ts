import { describe, it, expect } from 'vitest';
import { supplierOrderKeys } from './keys';

// Query key shape tests — stable contracts consumed by cache invalidation.

describe('supplierOrderKeys', () => {
  it('all key is stable', () => {
    expect(supplierOrderKeys.all).toEqual(['supplier-orders']);
  });

  it('lists key nests under all', () => {
    expect(supplierOrderKeys.lists()).toEqual(['supplier-orders', 'list']);
  });

  it('list key includes page and companyId', () => {
    const key = supplierOrderKeys.list({ page: 2, companyId: 'co-123' });
    expect(key).toContain('supplier-orders');
    expect(JSON.stringify(key)).toContain('co-123');
    expect(JSON.stringify(key)).toContain('2');
  });

  it('detail key includes id', () => {
    const key = supplierOrderKeys.detail('zo-abc');
    expect(key).toContain('zo-abc');
    expect(key[0]).toBe('supplier-orders');
  });

  it('list and detail keys do not clash', () => {
    const list = supplierOrderKeys.lists().join('/');
    const detail = supplierOrderKeys.detail('zo-1').join('/');
    expect(list).not.toBe(detail);
  });

  it('two different list params produce different keys', () => {
    const k1 = supplierOrderKeys.list({ page: 1, companyId: 'co-1', status: 'draft' });
    const k2 = supplierOrderKeys.list({ page: 1, companyId: 'co-1', status: 'sent' });
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
  });
});

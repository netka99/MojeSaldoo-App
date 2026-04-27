import { describe, it, expect } from 'vitest';
import { stockSnapshotKeys } from './keys';

describe('stockSnapshotKeys', () => {
  it('builds stable keys for list and per-warehouse snapshots', () => {
    expect(stockSnapshotKeys.all).toEqual(['stock-snapshot']);
    expect(stockSnapshotKeys.byWarehouse('w-abc')).toEqual(['stock-snapshot', 'w-abc']);
  });
});

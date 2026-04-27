/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { stockSnapshotKeys } from './keys';
import { useStockSnapshotQuery } from './use-products';

const productServiceMock = vi.hoisted(() => ({
  fetchStockSnapshot: vi.fn(),
}));

vi.mock('@/services/product.service', () => ({
  productService: productServiceMock,
}));

describe('useStockSnapshotQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled and does not fetch when warehouseId is undefined', () => {
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useStockSnapshotQuery(undefined), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(productServiceMock.fetchStockSnapshot).not.toHaveBeenCalled();
  });

  it('fetches by warehouse and keys cache with stockSnapshotKeys', async () => {
    const snap = {
      warehouse_id: 'w-99',
      warehouse_name: 'Van A',
      items: [
        { product_id: 'p1', product_name: 'X', sku: null, unit: 'szt', quantity_available: '1.000' },
      ],
    };
    productServiceMock.fetchStockSnapshot.mockResolvedValue(snap);
    const queryClient = createTestQueryClient();
    const wid = 'w-99';

    const { result } = renderHook(() => useStockSnapshotQuery(wid), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(snap);
    expect(productServiceMock.fetchStockSnapshot).toHaveBeenCalledWith(wid);
    expect(
      queryClient.getQueryData(stockSnapshotKeys.byWarehouse(wid)),
    ).toEqual(snap);
  });
});

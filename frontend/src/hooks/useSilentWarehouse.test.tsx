/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { useSilentWarehouse } from './useSilentWarehouse';

const hoisted = vi.hoisted(() => ({
  warehousesOn: false,
  list: {
    data: { results: [{ id: 'wh-1', name: 'Magazyn główny', code: 'MGabcd' }] },
    isPending: false,
  },
}));

vi.mock('@/hooks/useModuleGuard', () => ({
  useModuleGuard: (m: string) => m === 'warehouses' && hoisted.warehousesOn,
}));

vi.mock('@/query/use-warehouses', () => ({
  useWarehouseListQuery: () => hoisted.list,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <TestQueryProvider>{children}</TestQueryProvider>;
}

describe('useSilentWarehouse', () => {
  beforeEach(() => {
    hoisted.warehousesOn = false;
    hoisted.list = {
      data: { results: [{ id: 'wh-1', name: 'Magazyn główny', code: 'MGabcd' }] },
      isPending: false,
    };
  });

  it('is silent when the warehouses module is off and uses the first MG', () => {
    const { result } = renderHook(() => useSilentWarehouse(), { wrapper });
    expect(result.current.silent).toBe(true);
    expect(result.current.warehouseId).toBe('wh-1');
    expect(result.current.warehouseName).toBe('Magazyn główny');
  });

  it('is not silent when the warehouses module is on', () => {
    hoisted.warehousesOn = true;
    const { result } = renderHook(() => useSilentWarehouse(), { wrapper });
    expect(result.current.silent).toBe(false);
    expect(result.current.warehouseId).toBe('wh-1');
  });
});

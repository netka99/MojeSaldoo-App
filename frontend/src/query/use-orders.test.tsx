/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { orderKeys } from './keys';
import {
  buildOrderListApiFilters,
  useCancelOrderMutation,
  useConfirmOrderMutation,
  useCreateOrderMutation,
  useDeleteOrderMutation,
  useOrderListQuery,
  useOrderQuery,
  useOrdersByDateQuery,
} from './use-orders';

const orderServiceMock = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchById: vi.fn(),
  createOrder: vi.fn(),
  confirmOrder: vi.fn(),
  cancelOrder: vi.fn(),
  deleteOrder: vi.fn(),
}));

vi.mock('@/services/order.service', () => ({
  orderService: orderServiceMock,
}));

const mockUser = { current_company: '550e8400-e29b-41d4-a716-446655440000' as string };

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

describe('use-orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildOrderListApiFilters builds filters only for non-empty fields', () => {
    expect(buildOrderListApiFilters('', '', '', '')).toEqual({});
    expect(buildOrderListApiFilters('  test ', 'confirmed' as const, '2026-01-10', '2026-01-20')).toEqual({
      search: 'test',
      status: 'confirmed',
      delivery_date_after: '2026-01-10',
      delivery_date_before: '2026-01-20',
    });
  });

  it('useOrderListQuery fetches with page, filters, and orderKeys.List', async () => {
    const pageData = { count: 0, next: null, previous: null, results: [] };
    orderServiceMock.fetchList.mockResolvedValue(pageData);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () =>
        useOrderListQuery(2, {
          status: 'draft',
          delivery_date_after: '2026-01-01',
        }),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderServiceMock.fetchList).toHaveBeenCalledWith({
      page: 2,
      status: 'draft',
      delivery_date_after: '2026-01-01',
    });
    expect(
      queryClient.getQueryData(
        orderKeys.list({
          page: 2,
          companyId: mockUser.current_company,
          status: 'draft',
          delivery_date_after: '2026-01-01',
        })
      )
    ).toEqual(pageData);
  });

  it('useOrdersByDateQuery with valid date calls fetchList with delivery_date and page 1', async () => {
    const pageData = { count: 0, next: null, previous: null, results: [] };
    orderServiceMock.fetchList.mockResolvedValue(pageData);
    const queryClient = createTestQueryClient();
    const date = '2026-05-13';

    const { result } = renderHook(() => useOrdersByDateQuery(date), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderServiceMock.fetchList).toHaveBeenCalledWith({
      delivery_date: date,
      page: 1,
      page_size: 100,
    });
  });

  it('useOrdersByDateQuery with empty date does not call fetchList', async () => {
    orderServiceMock.fetchList.mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    const queryClient = createTestQueryClient();

    renderHook(() => useOrdersByDateQuery(''), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(orderServiceMock.fetchList).not.toHaveBeenCalled());
  });

  it('useOrdersByDateQuery stores data under a key that includes date and companyId', async () => {
    const pageData = { count: 1, next: null, previous: null, results: [{ id: 'o1' }] };
    orderServiceMock.fetchList.mockResolvedValue(pageData);
    const queryClient = createTestQueryClient();
    const date = '2026-06-01';

    const { result } = renderHook(() => useOrdersByDateQuery(date), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderKeys.byDate(date, 'company-a')).not.toEqual(orderKeys.byDate(date, 'company-b'));
    expect(queryClient.getQueryData(orderKeys.byDate(date, mockUser.current_company))).toEqual(pageData);
  });

  it('useOrderQuery loads detail by id', async () => {
    const o = { id: 'o1' };
    orderServiceMock.fetchById.mockResolvedValue(o);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useOrderQuery('o1'), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(o);
    expect(orderServiceMock.fetchById).toHaveBeenCalledWith('o1');
  });

  it('useCreateOrderMutation calls API and invalidates order keys', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const created = { id: 'new' } as never;
    orderServiceMock.createOrder.mockResolvedValue(created);

    const { result } = renderHook(() => useCreateOrderMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({ customer_id: 'c1', delivery_date: '2026-05-01' });

    expect(orderServiceMock.createOrder).toHaveBeenCalledWith({
      customer_id: 'c1',
      delivery_date: '2026-05-01',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.all });
  });

  it('useConfirmOrderMutation calls API and invalidates list + detail', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const o = { id: 'o1' };
    orderServiceMock.confirmOrder.mockResolvedValue(o);

    const { result } = renderHook(() => useConfirmOrderMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('o1');
    expect(orderServiceMock.confirmOrder).toHaveBeenCalledWith('o1');
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.detail('o1') });
  });

  it('useCancelOrderMutation calls API and invalidates list + detail', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const o = { id: 'o2' };
    orderServiceMock.cancelOrder.mockResolvedValue(o);

    const { result } = renderHook(() => useCancelOrderMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('o2');
    expect(orderServiceMock.cancelOrder).toHaveBeenCalledWith('o2');
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.detail('o2') });
  });

  it('useDeleteOrderMutation removes detail and invalidates list', async () => {
    const queryClient = createTestQueryClient();
    const inv = vi.spyOn(queryClient, 'invalidateQueries');
    const remove = vi.spyOn(queryClient, 'removeQueries');
    orderServiceMock.deleteOrder.mockResolvedValue({} as never);

    const { result } = renderHook(() => useDeleteOrderMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('o-del');
    expect(orderServiceMock.deleteOrder).toHaveBeenCalledWith('o-del');
    expect(remove).toHaveBeenCalledWith({ queryKey: orderKeys.detail('o-del') });
    expect(inv).toHaveBeenCalledWith({ queryKey: orderKeys.all });
  });
});

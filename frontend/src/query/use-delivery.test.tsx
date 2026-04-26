/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { deliveryKeys, orderKeys } from './keys';
import {
  useCompleteDeliveryMutation,
  useCreateDeliveryMutation,
  useDeleteDeliveryMutation,
  useDeliveryListQuery,
  useDeliveryQuery,
  useGenerateDeliveryForOrderMutation,
  usePatchDeliveryMutation,
  useSaveDeliveryMutation,
  useStartDeliveryMutation,
} from './use-delivery';

const deliveryServiceMock = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchById: vi.fn(),
  createDocument: vi.fn(),
  patchDocument: vi.fn(),
  deleteDocument: vi.fn(),
  saveDocument: vi.fn(),
  startDelivery: vi.fn(),
  completeDelivery: vi.fn(),
  generateForOrder: vi.fn(),
}));

vi.mock('@/services/delivery.service', () => ({
  deliveryService: deliveryServiceMock,
}));

const mockUser = { current_company: '550e8400-e29b-41d4-a716-446655440000' as string };

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

describe('use-delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useDeliveryListQuery fetches with page, filters, and deliveryKeys.list', async () => {
    const pageData = { count: 0, next: null, previous: null, results: [] };
    deliveryServiceMock.fetchList.mockResolvedValue(pageData);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () =>
        useDeliveryListQuery(2, {
          status: 'draft',
          document_type: 'WZ',
          issue_date_after: '2026-01-01',
        }),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deliveryServiceMock.fetchList).toHaveBeenCalledWith({
      page: 2,
      status: 'draft',
      document_type: 'WZ',
      issue_date_after: '2026-01-01',
    });
    expect(
      queryClient.getQueryData(
        deliveryKeys.list({
          page: 2,
          companyId: mockUser.current_company,
          status: 'draft',
          document_type: 'WZ',
          issue_date_after: '2026-01-01',
        }),
      ),
    ).toEqual(pageData);
  });

  it('useDeliveryQuery loads detail by id', async () => {
    const d = { id: 'd1', items: [] } as never;
    deliveryServiceMock.fetchById.mockResolvedValue(d);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useDeliveryQuery('d1'), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(d);
    expect(deliveryServiceMock.fetchById).toHaveBeenCalledWith('d1');
  });

  it('useCreateDeliveryMutation invalidates delivery keys', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const created = { id: 'new', items: [] } as never;
    deliveryServiceMock.createDocument.mockResolvedValue(created);

    const { result } = renderHook(() => useCreateDeliveryMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({
      order_id: 'o1',
      document_type: 'WZ',
      issue_date: '2026-06-01',
    });

    expect(deliveryServiceMock.createDocument).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
  });

  it('usePatchDeliveryMutation invalidates list + detail', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const doc = { id: 'd1', items: [] } as never;
    deliveryServiceMock.patchDocument.mockResolvedValue(doc);

    const { result } = renderHook(() => usePatchDeliveryMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({ id: 'd1', data: { notes: 'x' } });
    expect(deliveryServiceMock.patchDocument).toHaveBeenCalledWith('d1', { notes: 'x' });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.detail('d1') });
  });

  it('useDeleteDeliveryMutation removes detail and invalidates list', async () => {
    const queryClient = createTestQueryClient();
    const inv = vi.spyOn(queryClient, 'invalidateQueries');
    const remove = vi.spyOn(queryClient, 'removeQueries');
    deliveryServiceMock.deleteDocument.mockResolvedValue({} as never);

    const { result } = renderHook(() => useDeleteDeliveryMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('d-del');
    expect(deliveryServiceMock.deleteDocument).toHaveBeenCalledWith('d-del');
    expect(remove).toHaveBeenCalledWith({ queryKey: deliveryKeys.detail('d-del') });
    expect(inv).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
  });

  it('useSaveDeliveryMutation invalidates list + detail', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const doc = { id: 'd1', items: [] } as never;
    deliveryServiceMock.saveDocument.mockResolvedValue(doc);

    const { result } = renderHook(() => useSaveDeliveryMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('d1');
    expect(deliveryServiceMock.saveDocument).toHaveBeenCalledWith('d1');
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.detail('d1') });
  });

  it('useStartDeliveryMutation invalidates list + detail', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const doc = { id: 'd1', items: [] } as never;
    deliveryServiceMock.startDelivery.mockResolvedValue(doc);

    const { result } = renderHook(() => useStartDeliveryMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('d1');
    expect(deliveryServiceMock.startDelivery).toHaveBeenCalledWith('d1');
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.detail('d1') });
  });

  it('useCompleteDeliveryMutation invalidates delivery + orders', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const doc = { id: 'd1', items: [] } as never;
    deliveryServiceMock.completeDelivery.mockResolvedValue(doc);

    const { result } = renderHook(() => useCompleteDeliveryMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({ id: 'd1', data: { receiver_name: 'A' } });
    expect(deliveryServiceMock.completeDelivery).toHaveBeenCalledWith('d1', { receiver_name: 'A' });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.detail('d1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.all });
  });

  it('useGenerateDeliveryForOrderMutation GETs and invalidates delivery + orders', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const doc = { id: 'd-new', items: [] } as never;
    deliveryServiceMock.generateForOrder.mockResolvedValue(doc);

    const { result } = renderHook(() => useGenerateDeliveryForOrderMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync('o1');
    expect(deliveryServiceMock.generateForOrder).toHaveBeenCalledWith('o1');
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: deliveryKeys.detail('d-new') });
    expect(spy).toHaveBeenCalledWith({ queryKey: orderKeys.all });
  });
});

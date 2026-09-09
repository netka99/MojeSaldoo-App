/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { purchaseDocumentKeys } from './keys';
import {
  usePurchaseDocumentListQuery,
  usePurchaseDocumentQuery,
  useCreatePurchaseDocumentMutation,
  usePatchPurchaseDocumentMutation,
  useDeletePurchaseDocumentMutation,
  useMarkPurchaseDocPaidMutation,
  useSetPurchaseDocCategoryMutation,
  useCreatePzFromPurchaseDocMutation,
  useLinkPzMutation,
  useUnlinkPzMutation,
} from './use-purchase-documents';

// ─── Mock service ─────────────────────────────────────────────────────────────

const svcMock = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchById: vi.fn(),
  create: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  markPaid: vi.fn(),
  setCategory: vi.fn(),
  createPz: vi.fn(),
  linkPz: vi.fn(),
  unlinkPz: vi.fn(),
  setLineCategories: vi.fn(),
  getFileUrl: vi.fn(),
}));

vi.mock('@/services/purchase-document.service', () => ({
  purchaseDocumentService: svcMock,
}));

const mockUser = { current_company: 'company-uuid-1' };

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stub = { id: 'doc1', pz_documents: [], pz_id: null, pz_number: null } as unknown as import('@/services/purchase-document.service').PurchaseDocument;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = createTestQueryClient();
  return <TestQueryProvider client={client}>{children}</TestQueryProvider>;
}

function wrapperWithClient() {
  const client = createTestQueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <TestQueryProvider client={client}>{children}</TestQueryProvider>
  );
  return { client, Wrapper };
}

import React from 'react';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('use-purchase-documents', () => {
  beforeEach(() => vi.clearAllMocks());

  // List query
  it('usePurchaseDocumentListQuery fetches with page and filters', async () => {
    const page = { count: 2, next: null, previous: null, results: [stub] };
    svcMock.fetchList.mockResolvedValue(page);
    const { client, Wrapper } = wrapperWithClient();

    const { result } = renderHook(
      () => usePurchaseDocumentListQuery(1, { doc_type: 'FZ' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svcMock.fetchList).toHaveBeenCalledWith({ page: 1, doc_type: 'FZ' });
    expect(
      client.getQueryData(purchaseDocumentKeys.list({ page: 1, companyId: mockUser.current_company, doc_type: 'FZ' })),
    ).toEqual(page);
  });

  // Detail query
  it('usePurchaseDocumentQuery fetches by id', async () => {
    svcMock.fetchById.mockResolvedValue(stub);
    const { result } = renderHook(() => usePurchaseDocumentQuery('doc1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svcMock.fetchById).toHaveBeenCalledWith('doc1');
    expect(result.current.data).toEqual(stub);
  });

  it('usePurchaseDocumentQuery is disabled when id is undefined', () => {
    const { result } = renderHook(() => usePurchaseDocumentQuery(undefined), { wrapper });
    expect(svcMock.fetchById).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  // Create
  it('useCreatePurchaseDocumentMutation invalidates all purchase-doc keys', async () => {
    svcMock.create.mockResolvedValue(stub);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreatePurchaseDocumentMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ doc_type: 'FZ', document_number: 'FV/001' });

    expect(svcMock.create).toHaveBeenCalledWith({ doc_type: 'FZ', document_number: 'FV/001' });
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  // Patch
  it('usePatchPurchaseDocumentMutation invalidates list and detail', async () => {
    svcMock.patch.mockResolvedValue(stub);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => usePatchPurchaseDocumentMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', data: { notes: 'upd' } });

    expect(svcMock.patch).toHaveBeenCalledWith('doc1', { notes: 'upd' });
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.detail('doc1') });
  });

  // Delete
  it('useDeletePurchaseDocumentMutation invalidates all keys', async () => {
    svcMock.delete.mockResolvedValue({});
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeletePurchaseDocumentMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync('doc1');

    expect(svcMock.delete).toHaveBeenCalledWith('doc1');
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  // markPaid
  it('useMarkPurchaseDocPaidMutation calls markPaid service', async () => {
    svcMock.markPaid.mockResolvedValue(stub);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useMarkPurchaseDocPaidMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', isPaid: true });

    expect(svcMock.markPaid).toHaveBeenCalledWith('doc1', true);
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  // setCategory
  it('useSetPurchaseDocCategoryMutation calls setCategory service', async () => {
    svcMock.setCategory.mockResolvedValue(stub);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSetPurchaseDocCategoryMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', category: 'transport' });

    expect(svcMock.setCategory).toHaveBeenCalledWith('doc1', 'transport');
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  // createPz
  it('useCreatePzFromPurchaseDocMutation calls createPz service and invalidates all', async () => {
    svcMock.createPz.mockResolvedValue(stub);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreatePzFromPurchaseDocMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', warehouseId: 'wh1' });

    expect(svcMock.createPz).toHaveBeenCalledWith('doc1', 'wh1');
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  // linkPz — M:M
  it('useLinkPzMutation calls linkPz service with correct args', async () => {
    svcMock.linkPz.mockResolvedValue({ ...stub, pz_documents: [{ id: 'pz1', document_number: 'PZ/001', status: 'draft', issue_date: '2026-01-01' }] } as never);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useLinkPzMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', pzId: 'pz1' });

    expect(svcMock.linkPz).toHaveBeenCalledWith('doc1', 'pz1');
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  it('useLinkPzMutation can be called twice for different PZ (M:M)', async () => {
    svcMock.linkPz.mockResolvedValue(stub);
    const { result } = renderHook(() => useLinkPzMutation(), { wrapper });

    await result.current.mutateAsync({ id: 'doc1', pzId: 'pz1' });
    await result.current.mutateAsync({ id: 'doc1', pzId: 'pz2' });

    expect(svcMock.linkPz).toHaveBeenCalledTimes(2);
    expect(svcMock.linkPz).toHaveBeenNthCalledWith(1, 'doc1', 'pz1');
    expect(svcMock.linkPz).toHaveBeenNthCalledWith(2, 'doc1', 'pz2');
  });

  // unlinkPz — M:M
  it('useUnlinkPzMutation calls unlinkPz service with correct args', async () => {
    svcMock.unlinkPz.mockResolvedValue({ ...stub, pz_documents: [] } as never);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUnlinkPzMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', pzId: 'pz1' });

    expect(svcMock.unlinkPz).toHaveBeenCalledWith('doc1', 'pz1');
    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  it('useUnlinkPzMutation invalidates all purchase-doc keys on success', async () => {
    svcMock.unlinkPz.mockResolvedValue(stub);
    const { client, Wrapper } = wrapperWithClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUnlinkPzMutation(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: 'doc1', pzId: 'pz-to-remove' });

    expect(spy).toHaveBeenCalledWith({ queryKey: purchaseDocumentKeys.all });
  });

  it('useUnlinkPzMutation can selectively remove one PZ while others remain', async () => {
    // Simulates the M:M scenario: doc has 2 PZ, remove one
    const afterUnlink = {
      ...stub,
      pz_documents: [{ id: 'pz2', document_number: 'PZ/002', status: 'draft', issue_date: '2026-01-01' }],
      pz_id: 'pz2',
      pz_number: 'PZ/002',
    } as unknown as import('@/services/purchase-document.service').PurchaseDocument;
    svcMock.unlinkPz.mockResolvedValue(afterUnlink);

    const { result } = renderHook(() => useUnlinkPzMutation(), { wrapper });
    const response = await result.current.mutateAsync({ id: 'doc1', pzId: 'pz1' });

    expect(svcMock.unlinkPz).toHaveBeenCalledWith('doc1', 'pz1');
    // API returns doc with pz2 still present
    expect(response.pz_documents).toHaveLength(1);
    expect(response.pz_documents[0].id).toBe('pz2');
  });
});

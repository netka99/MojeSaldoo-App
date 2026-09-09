import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
  API_BASE_URL: 'http://localhost:8000/api',
}));

import { purchaseDocumentService } from './purchase-document.service';

const stub = { id: 'doc1', pz_documents: [], pz_id: null, pz_number: null } as never;

describe('purchaseDocumentService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetchList calls GET /purchase-documents/ with params', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);
    const result = await purchaseDocumentService.fetchList({ page: 1, doc_type: 'FZ' });
    expect(result).toBe(page);
    expect(mocks.get).toHaveBeenCalledWith('/purchase-documents/', {
      params: { page: 1, doc_type: 'FZ' },
    });
  });

  it('fetchById calls GET /purchase-documents/:id/', async () => {
    mocks.get.mockResolvedValue(stub);
    await purchaseDocumentService.fetchById('doc1');
    expect(mocks.get).toHaveBeenCalledWith('/purchase-documents/doc1/');
  });

  it('create posts to /purchase-documents/', async () => {
    mocks.post.mockResolvedValue(stub);
    const data = { doc_type: 'FZ' as const, document_number: 'FV/001' };
    await purchaseDocumentService.create(data);
    expect(mocks.post).toHaveBeenCalledWith('/purchase-documents/', data);
  });

  it('patch sends PATCH /purchase-documents/:id/', async () => {
    mocks.patch.mockResolvedValue(stub);
    await purchaseDocumentService.patch('doc1', { notes: 'test' });
    expect(mocks.patch).toHaveBeenCalledWith('/purchase-documents/doc1/', { notes: 'test' });
  });

  it('delete sends DELETE /purchase-documents/:id/', async () => {
    mocks.delete.mockResolvedValue({});
    await purchaseDocumentService.delete('doc1');
    expect(mocks.delete).toHaveBeenCalledWith('/purchase-documents/doc1/');
  });

  it('markPaid posts to /purchase-documents/:id/mark-paid/', async () => {
    mocks.patch.mockResolvedValue(stub);
    await purchaseDocumentService.markPaid('doc1', true);
    expect(mocks.patch).toHaveBeenCalledWith('/purchase-documents/doc1/mark-paid/', { is_paid: true });
  });

  it('setCategory posts to /purchase-documents/:id/set-category/', async () => {
    mocks.patch.mockResolvedValue(stub);
    await purchaseDocumentService.setCategory('doc1', 'koszty-transportu');
    expect(mocks.patch).toHaveBeenCalledWith('/purchase-documents/doc1/set-category/', {
      opex_category: 'koszty-transportu',
    });
  });

  it('createPz posts to /purchase-documents/:id/create-pz/', async () => {
    mocks.post.mockResolvedValue(stub);
    await purchaseDocumentService.createPz('doc1', 'wh1');
    expect(mocks.post).toHaveBeenCalledWith('/purchase-documents/doc1/create-pz/', {
      to_warehouse_id: 'wh1',
    });
  });

  it('linkPz posts to /purchase-documents/:id/link-pz/ with pz_id', async () => {
    mocks.post.mockResolvedValue(stub);
    await purchaseDocumentService.linkPz('doc1', 'pz-uuid-1');
    expect(mocks.post).toHaveBeenCalledWith('/purchase-documents/doc1/link-pz/', {
      pz_id: 'pz-uuid-1',
    });
  });

  it('unlinkPz posts to /purchase-documents/:id/unlink-pz/ with pz_id', async () => {
    mocks.post.mockResolvedValue(stub);
    await purchaseDocumentService.unlinkPz('doc1', 'pz-uuid-1');
    expect(mocks.post).toHaveBeenCalledWith('/purchase-documents/doc1/unlink-pz/', {
      pz_id: 'pz-uuid-1',
    });
  });

  it('setLineCategories patches /purchase-documents/:id/set-line-categories/', async () => {
    mocks.patch.mockResolvedValue({ line_categories: { '0': 'transport' } });
    await purchaseDocumentService.setLineCategories('doc1', { '0': 'transport' });
    expect(mocks.patch).toHaveBeenCalledWith('/purchase-documents/doc1/set-line-categories/', {
      line_categories: { '0': 'transport' },
    });
  });

  it('getFileUrl returns correct URL', () => {
    const url = purchaseDocumentService.getFileUrl('doc1');
    expect(url).toBe('http://localhost:8000/api/purchase-documents/doc1/file/');
  });
});

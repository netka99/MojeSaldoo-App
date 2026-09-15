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
}));

import { purchaseOrderService } from './purchase-order.service';

const stubOrder = {
  id: 'zo-1',
  document_number: 'ZD/2026/0001',
  status: 'draft',
  supplier_id: null,
  supplier_name: '',
  issue_date: '2026-09-15',
  expected_delivery_date: null,
  source_order_id: null,
  notes: '',
  items: [],
  pz_count: 0,
  created_at: '2026-09-15T10:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
} as never;

const stubPage = { count: 1, next: null, previous: null, results: [stubOrder] };

describe('purchaseOrderService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetchList calls GET /purchase-orders/ with params', async () => {
    mocks.get.mockResolvedValue(stubPage);
    const result = await purchaseOrderService.fetchList({ page: 1, status: 'draft' });
    expect(result).toBe(stubPage);
    expect(mocks.get).toHaveBeenCalledWith('/purchase-orders/', {
      params: { page: 1, status: 'draft' },
    });
  });

  it('fetchById calls GET /purchase-orders/:id/', async () => {
    mocks.get.mockResolvedValue(stubOrder);
    await purchaseOrderService.fetchById('zo-1');
    expect(mocks.get).toHaveBeenCalledWith('/purchase-orders/zo-1/');
  });

  it('create calls POST /purchase-orders/', async () => {
    mocks.post.mockResolvedValue(stubOrder);
    const body = {
      items: [{ product_id: 'p1', quantity_ordered: '10.00' }],
    };
    await purchaseOrderService.create(body);
    expect(mocks.post).toHaveBeenCalledWith('/purchase-orders/', body);
  });

  it('patch calls PATCH /purchase-orders/:id/', async () => {
    mocks.patch.mockResolvedValue(stubOrder);
    await purchaseOrderService.patch('zo-1', { notes: 'Updated' });
    expect(mocks.patch).toHaveBeenCalledWith('/purchase-orders/zo-1/', { notes: 'Updated' });
  });

  it('cancel calls DELETE /purchase-orders/:id/', async () => {
    mocks.delete.mockResolvedValue(undefined);
    await purchaseOrderService.cancel('zo-1');
    expect(mocks.delete).toHaveBeenCalledWith('/purchase-orders/zo-1/');
  });

  it('send calls POST /purchase-orders/:id/send/', async () => {
    mocks.post.mockResolvedValue({ ...stubOrder, status: 'sent' });
    await purchaseOrderService.send('zo-1');
    expect(mocks.post).toHaveBeenCalledWith('/purchase-orders/zo-1/send/');
  });

  it('createPz calls POST /purchase-orders/:id/create-pz/ with body', async () => {
    const pz = { id: 'pz-1', document_type: 'PZ' };
    mocks.post.mockResolvedValue(pz);
    const body = { to_warehouse_id: 'wh-1', external_document_number: 'WZ/001' };
    const result = await purchaseOrderService.createPz('zo-1', body);
    expect(result).toBe(pz);
    expect(mocks.post).toHaveBeenCalledWith('/purchase-orders/zo-1/create-pz/', body);
  });
});

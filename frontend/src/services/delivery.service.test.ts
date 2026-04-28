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

import { deliveryService } from './delivery.service';

describe('deliveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchList calls GET /delivery/ with params', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);

    const result = await deliveryService.fetchList({
      page: 1,
      status: 'draft',
      order: 'order-uuid',
      document_type: 'WZ',
      issue_date_after: '2026-04-01',
      issue_date_before: '2026-04-30',
      ordering: '-created_at',
    });

    expect(result).toBe(page);
    expect(mocks.get).toHaveBeenCalledWith('/delivery/', {
      params: {
        page: 1,
        status: 'draft',
        order: 'order-uuid',
        document_type: 'WZ',
        issue_date_after: '2026-04-01',
        issue_date_before: '2026-04-30',
        ordering: '-created_at',
      },
    });
  });

  it('fetchPreview calls GET /delivery/:id/preview/', async () => {
    mocks.get.mockResolvedValue({ document: {}, company: {}, customer: {}, from_warehouse: null, items: [] });
    await deliveryService.fetchPreview('d1');
    expect(mocks.get).toHaveBeenCalledWith('/delivery/d1/preview/');
  });

  it('fetchById calls GET /delivery/:id/', async () => {
    mocks.get.mockResolvedValue({ id: 'd1' });
    await deliveryService.fetchById('d1');
    expect(mocks.get).toHaveBeenCalledWith('/delivery/d1/');
  });

  it('createDocument posts to /delivery/', async () => {
    const body = {
      order_id: 'o1',
      document_type: 'WZ' as const,
      issue_date: '2026-05-01',
    };
    mocks.post.mockResolvedValue({ id: 'new' });
    await deliveryService.createDocument(body);
    expect(mocks.post).toHaveBeenCalledWith('/delivery/', body);
  });

  it('patchDocument patches /delivery/:id/', async () => {
    mocks.patch.mockResolvedValue({ id: 'd1' });
    await deliveryService.patchDocument('d1', { driver_name: 'Jan' });
    expect(mocks.patch).toHaveBeenCalledWith('/delivery/d1/', { driver_name: 'Jan' });
  });

  it('deleteDocument sends DELETE /delivery/:id/', async () => {
    mocks.delete.mockResolvedValue({});
    await deliveryService.deleteDocument('d1');
    expect(mocks.delete).toHaveBeenCalledWith('/delivery/d1/');
  });

  it('saveDocument posts to /delivery/:id/save/', async () => {
    mocks.post.mockResolvedValue({ id: 'd1', status: 'saved' });
    await deliveryService.saveDocument('d1');
    expect(mocks.post).toHaveBeenCalledWith('/delivery/d1/save/', {});
  });

  it('startDelivery posts to /delivery/:id/start-delivery/', async () => {
    mocks.post.mockResolvedValue({ id: 'd1' });
    await deliveryService.startDelivery('d1');
    expect(mocks.post).toHaveBeenCalledWith('/delivery/d1/start-delivery/', {});
  });

  it('completeDelivery posts body to /delivery/:id/complete/', async () => {
    const payload = { items: [{ id: 'line-1', quantity_actual: '2' }] };
    mocks.post.mockResolvedValue({ id: 'd1' });
    await deliveryService.completeDelivery('d1', payload);
    expect(mocks.post).toHaveBeenCalledWith('/delivery/d1/complete/', payload);
  });

  it('completeDelivery posts empty object when no payload', async () => {
    mocks.post.mockResolvedValue({ id: 'd1' });
    await deliveryService.completeDelivery('d1');
    expect(mocks.post).toHaveBeenCalledWith('/delivery/d1/complete/', {});
  });

  it('updateLines posts to /delivery/:id/update-lines/', async () => {
    const payload = {
      items: [{ id: 'li-1', quantity_planned: '2', quantity_returned: '0' }],
    };
    mocks.post.mockResolvedValue({ id: 'd1' });
    await deliveryService.updateLines('d1', payload);
    expect(mocks.post).toHaveBeenCalledWith('/delivery/d1/update-lines/', payload);
  });

  it('generateForOrder GETs /delivery/generate-for-order/:orderId/', async () => {
    mocks.get.mockResolvedValue({ id: 'd-new' });
    await deliveryService.generateForOrder('o-99');
    expect(mocks.get).toHaveBeenCalledWith('/delivery/generate-for-order/o-99/');
  });

  it('vanLoading posts to /delivery/van-loading/', async () => {
    const body = {
      from_warehouse_id: 'w1',
      to_warehouse_id: 'w2',
      issue_date: '2026-04-27',
      items: [{ product_id: 'p1', quantity: '2.00' }],
    };
    mocks.post.mockResolvedValue({ id: 'mm1' });
    await deliveryService.vanLoading(body);
    expect(mocks.post).toHaveBeenCalledWith('/delivery/van-loading/', body);
  });

  it('vanReconciliation posts to /delivery/van-reconciliation/:warehouseId/', async () => {
    const data = {
      reconciliation_date: '2026-04-27',
      notes: 'end of route',
      items: [{ product_id: 'p1', quantity_actual: '5.000' }],
    };
    const res = { warehouse_id: 'w1', has_discrepancies: false, items: [] } as never;
    mocks.post.mockResolvedValue(res);
    const out = await deliveryService.vanReconciliation('w-van-1', data);
    expect(out).toBe(res);
    expect(mocks.post).toHaveBeenCalledWith('/delivery/van-reconciliation/w-van-1/', data);
  });
});

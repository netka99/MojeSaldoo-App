import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    patch: mocks.patch,
    delete: mocks.delete,
  },
}));

import { orderService } from './order.service';

describe('orderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchList calls GET /orders/ with params', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);

    const result = await orderService.fetchList({
      page: 1,
      status: 'draft',
      delivery_date_after: '2026-04-01',
      delivery_date_before: '2026-04-30',
      ordering: '-created_at',
    });

    expect(result).toBe(page);
    expect(mocks.get).toHaveBeenCalledWith('/orders/', {
      params: {
        page: 1,
        status: 'draft',
        delivery_date_after: '2026-04-01',
        delivery_date_before: '2026-04-30',
        ordering: '-created_at',
      },
    });
  });

  it('fetchList calls GET /orders/ without config when no params', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);

    await orderService.fetchList();

    expect(mocks.get).toHaveBeenCalledWith('/orders/', {
      params: undefined,
    });
  });

  it('fetchById calls GET /orders/:id/', async () => {
    mocks.get.mockResolvedValue({ id: 'o1' });
    await orderService.fetchById('o1');
    expect(mocks.get).toHaveBeenCalledWith('/orders/o1/');
  });

  it('createOrder posts body to /orders/', async () => {
    const body = {
      customer_id: 'c1',
      delivery_date: '2026-05-01',
      items: [
        {
          product_id: 'p1',
          quantity: '2',
          unit_price_net: '10.00',
          unit_price_gross: '12.30',
          vat_rate: '23.00',
          discount_percent: '0.00',
        },
      ],
    };
    mocks.post.mockResolvedValue({ id: 'new' });
    const result = await orderService.createOrder(body);

    expect(result).toEqual({ id: 'new' });
    expect(mocks.post).toHaveBeenCalledWith('/orders/', body);
  });

  it('updateOrder puts body to /orders/:id/', async () => {
    const body = {
      customer_id: 'c1',
      delivery_date: '2026-05-02',
      items: [],
    };
    mocks.put.mockResolvedValue({ id: 'o1' });
    await orderService.updateOrder('o1', body);
    expect(mocks.put).toHaveBeenCalledWith('/orders/o1/', body);
  });

  it('confirmOrder posts empty object to /orders/:id/confirm/', async () => {
    mocks.post.mockResolvedValue({ id: 'o1', status: 'confirmed' });
    await orderService.confirmOrder('o1');
    expect(mocks.post).toHaveBeenCalledWith('/orders/o1/confirm/', {});
  });

  it('cancelOrder posts empty object to /orders/:id/cancel/', async () => {
    mocks.post.mockResolvedValue({ id: 'o1', status: 'cancelled' });
    await orderService.cancelOrder('o1');
    expect(mocks.post).toHaveBeenCalledWith('/orders/o1/cancel/', {});
  });

  it('deleteOrder sends DELETE /orders/:id/', async () => {
    mocks.delete.mockResolvedValue({});
    await orderService.deleteOrder('o1');
    expect(mocks.delete).toHaveBeenCalledWith('/orders/o1/');
  });
});

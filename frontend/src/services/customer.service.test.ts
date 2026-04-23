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

import { customerService } from './customer.service';

describe('customerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchList calls GET /customers/ with params', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);

    const result = await customerService.fetchList({ page: 1, city: 'Kraków', distance_km: 10 });

    expect(result).toBe(page);
    expect(mocks.get).toHaveBeenCalledWith('/customers/', {
      params: { page: 1, city: 'Kraków', distance_km: 10 },
    });
  });

  it('fetchById calls GET /customers/:id/', async () => {
    mocks.get.mockResolvedValue({ id: 'c1' });
    await customerService.fetchById('c1');
    expect(mocks.get).toHaveBeenCalledWith('/customers/c1/');
  });

  it('createItem posts body to /customers/', async () => {
    const body = {
      name: 'ACME',
      country: 'PL',
      payment_terms: 14,
      credit_limit: '0',
      is_active: true,
    } as never;
    mocks.post.mockResolvedValue({ id: 'new' });
    await customerService.createItem(body);
    expect(mocks.post).toHaveBeenCalledWith('/customers/', body);
  });

  it('updateItem puts body to /customers/:id/', async () => {
    const body = { name: 'ACME 2' } as never;
    mocks.put.mockResolvedValue({ id: 'c1' });
    await customerService.updateItem('c1', body);
    expect(mocks.put).toHaveBeenCalledWith('/customers/c1/', body);
  });

  it('deleteItem sends DELETE /customers/:id/', async () => {
    mocks.delete.mockResolvedValue({});
    await customerService.deleteItem('c1');
    expect(mocks.delete).toHaveBeenCalledWith('/customers/c1/');
  });

  it('partialUpdateItem patches /customers/:id/', async () => {
    mocks.patch.mockResolvedValue({ id: 'c1' });
    await customerService.partialUpdateItem('c1', { phone: '123456789' });
    expect(mocks.patch).toHaveBeenCalledWith('/customers/c1/', { phone: '123456789' });
  });
});

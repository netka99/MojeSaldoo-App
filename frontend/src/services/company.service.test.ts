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

import { companyService } from './company.service';

describe('companyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getMyCompanies calls GET /companies/me/', async () => {
    const list = [{ id: 'c1', name: 'Acme' }];
    mocks.get.mockResolvedValue(list);

    const result = await companyService.getMyCompanies();

    expect(result).toBe(list);
    expect(mocks.get).toHaveBeenCalledWith('/companies/me/');
  });

  it('createCompany maps CompanyWrite to snake_case and POST /companies/', async () => {
    mocks.post.mockResolvedValue({ id: 'new' });

    await companyService.createCompany({
      name: 'New Co',
      nip: '123',
      postalCode: '00-001',
      city: 'Warsaw',
    });

    expect(mocks.post).toHaveBeenCalledWith('/companies/', {
      name: 'New Co',
      nip: '123',
      postal_code: '00-001',
      city: 'Warsaw',
    });
  });

  it('createCompany omits undefined optionals', async () => {
    mocks.post.mockResolvedValue({ id: 'new' });
    await companyService.createCompany({ name: 'Only' });
    expect(mocks.post).toHaveBeenCalledWith('/companies/', { name: 'Only' });
  });

  it('updateCompany PATCHes /companies/:id/ with snake_case body', async () => {
    mocks.patch.mockResolvedValue({ id: 'c1' });
    await companyService.updateCompany('c1', {
      name: 'X',
      nip: '5260250274',
      postalCode: '00-001',
      city: 'Warszawa',
    });
    expect(mocks.patch).toHaveBeenCalledWith('/companies/c1/', {
      name: 'X',
      nip: '5260250274',
      postal_code: '00-001',
      city: 'Warszawa',
    });
  });

  it('switchCompany posts { company } to /companies/switch/', async () => {
    const user = { id: 1, username: 'u', email: '', first_name: '', last_name: '', is_active: true };
    mocks.post.mockResolvedValue({ user });

    const result = await companyService.switchCompany('550e8400-e29b-41d4-a716-446655440000');

    expect(result.user).toBe(user);
    expect(mocks.post).toHaveBeenCalledWith('/companies/switch/', {
      company: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('getModules maps API rows to CompanyModule', async () => {
    mocks.get.mockResolvedValue([
      {
        id: 'm1',
        company: 'c1',
        module: 'products',
        is_enabled: true,
        enabled_at: '2024-01-01T00:00:00Z',
      },
    ]);

    const rows = await companyService.getModules('c1');

    expect(mocks.get).toHaveBeenCalledWith('/companies/c1/modules/');
    expect(rows).toEqual([
      {
        module: 'products',
        isEnabled: true,
        enabledAt: '2024-01-01T00:00:00Z',
      },
    ]);
  });

  it('toggleModule PATCHes is_enabled and maps response', async () => {
    mocks.patch.mockResolvedValue({
      id: 'm1',
      company: 'c1',
      module: 'orders',
      is_enabled: false,
      enabled_at: null,
    });

    const row = await companyService.toggleModule('c1', 'orders', false);

    expect(mocks.patch).toHaveBeenCalledWith('/companies/c1/modules/orders/', { is_enabled: false });
    expect(row).toEqual({
      module: 'orders',
      isEnabled: false,
      enabledAt: null,
    });
  });
});

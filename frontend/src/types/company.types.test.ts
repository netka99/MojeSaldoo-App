import { describe, it, expect } from 'vitest';
import type {
  Company,
  CompanyMembership,
  CompanyModule,
  CompanyWrite,
  CompanyRole,
  ModuleName,
} from './company.types';

describe('company.types', () => {
  it('exemplar values satisfy exported interfaces (regression guard)', () => {
    const company = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'ACME',
      nip: '1234567890',
      address: '',
      city: '',
      postalCode: '',
      phone: '',
      email: 'a@b.c',
      isActive: true,
      createdAt: '2020-01-01T00:00:00Z',
    } satisfies Company;

    const write = { name: 'New', nip: '1' } satisfies CompanyWrite;

    const mod: CompanyModule = {
      module: 'products',
      isEnabled: true,
      enabledAt: null,
    };

    const membership: CompanyMembership = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      company,
      role: 'admin' satisfies CompanyRole,
      isActive: true,
      joinedAt: '2020-01-01T00:00:00Z',
    };

    const modules: ModuleName[] = [
      'products',
      'customers',
      'warehouses',
      'orders',
      'delivery',
      'invoicing',
      'ksef',
      'reporting',
    ];

    expect(company.name).toBe('ACME');
    expect(write.name).toBe('New');
    expect(mod.module).toBe('products');
    expect(membership.role).toBe('admin');
    expect(modules).toHaveLength(8);
  });
});

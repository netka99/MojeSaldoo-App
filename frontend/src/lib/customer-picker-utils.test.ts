import { describe, it, expect } from 'vitest';
import { resolveCustomerIdFromSearch } from './customer-picker-utils';

describe('resolveCustomerIdFromSearch', () => {
  const customers = [
    { id: 'c1', name: 'Sklep 1' },
    { id: 'c2', name: 'Sklep Kowalskiego' },
  ];

  it('returns explicit id when set', () => {
    expect(resolveCustomerIdFromSearch('c2', 'Sklep 1', customers)).toBe('c2');
  });

  it('matches one customer by exact search text', () => {
    expect(resolveCustomerIdFromSearch('', 'Sklep 1', customers)).toBe('c1');
  });

  it('returns null when ambiguous or no match', () => {
    expect(resolveCustomerIdFromSearch('', 'Sklep', customers)).toBeNull();
    expect(resolveCustomerIdFromSearch('', 'Unknown', customers)).toBeNull();
  });
});

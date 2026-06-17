import { describe, it, expect } from 'vitest';
import { costAllocationKeys } from './use-cost-allocation';

// Query key shape tests — these are stable contracts consumed by cache invalidation.
// Kept minimal: no React rendering needed, just key-shape verification.

describe('costAllocationKeys', () => {
  it('projects key includes companyId', () => {
    const key = costAllocationKeys.projects('company-123');
    expect(key).toContain('company-123');
    expect(key[0]).toBe('cost-allocation');
  });

  it('annotation key includes ksefNumber', () => {
    const key = costAllocationKeys.annotation('KSEF-001');
    expect(key).toContain('KSEF-001');
    expect(key[0]).toBe('cost-allocation');
  });

  it('projects and annotation keys do not clash', () => {
    const p = costAllocationKeys.projects('c1').join('/');
    const a = costAllocationKeys.annotation('KSEF-001').join('/');
    expect(p).not.toBe(a);
  });
});

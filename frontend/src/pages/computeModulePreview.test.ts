/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { computeModulePreview } from './OnboardingPage';

describe('computeModulePreview', () => {
  it('does not enable warehouses for the production tile', () => {
    const modules = computeModulePreview(['production'], 'docs_only', 'kpir', null);
    expect(modules.production).toBe(true);
    expect(modules.products).toBe(true);
    expect(modules.warehouses).toBe(false);
  });

  it('enables warehouses only when the warehouses tile is selected', () => {
    const modules = computeModulePreview(['warehouses'], 'docs_only', 'kpir', null);
    expect(modules.warehouses).toBe(true);
    expect(modules.products).toBe(true);
    expect(modules.production).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { MODULE_DISPLAY_ORDER, MODULE_CARD_COPY } from './companyModuleLabels';
import type { ModuleName } from '@/types';

describe('companyModuleLabels', () => {
  it('includes every module key exactly once in display order', () => {
    const all: ModuleName[] = [
      'products',
      'warehouses',
      'customers',
      'orders',
      'delivery',
      'invoicing',
      'ksef',
      'reporting',
    ];
    expect(MODULE_DISPLAY_ORDER).toEqual(all);
    expect(new Set(MODULE_DISPLAY_ORDER).size).toBe(8);
  });

  it('has copy for every ModuleName', () => {
    for (const m of MODULE_DISPLAY_ORDER) {
      expect(MODULE_CARD_COPY[m].title).toBeTruthy();
      expect(MODULE_CARD_COPY[m].description).toBeTruthy();
      expect(MODULE_CARD_COPY[m].statusOn).toBeTruthy();
      expect(MODULE_CARD_COPY[m].statusOff).toBeTruthy();
    }
  });
});

import { describe, it, expect } from 'vitest';
import { DELIVERY_STATUS_LABELS_PL } from './deliveryStatusPl';
import type { DeliveryDocumentStatus } from '@/types';

const ALL_STATUSES: DeliveryDocumentStatus[] = [
  'draft',
  'saved',
  'in_transit',
  'delivered',
  'cancelled',
];

describe('deliveryStatusPl', () => {
  it('defines a non-empty Polish label for every delivery status', () => {
    for (const s of ALL_STATUSES) {
      expect(DELIVERY_STATUS_LABELS_PL[s].length).toBeGreaterThan(0);
    }
  });
});

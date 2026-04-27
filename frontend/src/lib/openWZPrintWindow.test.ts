/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryDocumentPreviewPayload } from '@/types';

const { openPrintFrameMock } = vi.hoisted(() => ({
  openPrintFrameMock: vi.fn(() => true),
}));

vi.mock('@/lib/printFrame', () => ({
  openPrintFrame: (opts: unknown) => openPrintFrameMock(opts),
}));

import { openWZPrintWindow } from './openWZPrintWindow';

function minimalPreview(): DeliveryDocumentPreviewPayload {
  return {
    document: {
      id: 'd1',
      company: 'c1',
      order: null,
      user: null,
      document_type: 'WZ',
      document_number: 'WZ/1',
      issue_date: '2026-01-01',
      from_warehouse: null,
      to_warehouse: null,
      to_customer: null,
      status: 'draft',
      has_returns: false,
      returns_notes: '',
      driver_name: '',
      receiver_name: '',
      delivered_at: null,
      notes: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    company: { name: 'Co', nip: '', address: '' },
    customer: { name: '', nip: '', address: '' },
    from_warehouse: null,
    items: [],
  };
}

describe('openWZPrintWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openPrintFrameMock.mockReturnValue(true);
  });

  it('returns false when openPrintFrame fails', () => {
    openPrintFrameMock.mockReturnValue(false);
    expect(openWZPrintWindow(minimalPreview())).toBe(false);
  });

  it('delegates to openPrintFrame with title, rootId and element', () => {
    expect(openWZPrintWindow(minimalPreview(), { title: 'Test WZ' })).toBe(true);
    expect(openPrintFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test WZ',
        rootId: 'wz-print-root',
      }),
    );
    const arg = openPrintFrameMock.mock.calls[0][0] as { element: unknown };
    expect(arg.element).toBeDefined();
  });
});

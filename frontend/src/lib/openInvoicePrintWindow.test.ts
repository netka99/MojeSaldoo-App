/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoicePreviewPayload } from '@/types';

const { openPrintFrameMock } = vi.hoisted(() => ({
  openPrintFrameMock: vi.fn(() => true),
}));

vi.mock('@/lib/printFrame', () => ({
  openPrintFrame: (opts: unknown) => openPrintFrameMock(opts),
}));

import { openInvoicePrintWindow } from './openInvoicePrintWindow';

function minimalPreview(): InvoicePreviewPayload {
  return {
    meta: { title: 'x', currency: 'PLN', locale: 'pl-PL' },
    seller: { name: 'S', nip: '', address_lines: [] },
    buyer: { name: 'B', nip: '', address_lines: [] },
    invoice: {
      id: 'i1',
      invoice_number: 'FV/1',
      issue_date: '2026-01-01',
      sale_date: '2026-01-01',
      due_date: '2026-01-15',
      payment_method: 'transfer',
      payment_method_label: 'Przelew',
      status: 'draft',
      notes: '',
      order_number: '',
      delivery_document_number: '',
    },
    totals: {
      subtotal_net: '0.00',
      vat_amount: '0.00',
      subtotal_gross: '0.00',
      total_gross: '0.00',
    },
    lines: [],
  };
}

describe('openInvoicePrintWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openPrintFrameMock.mockReturnValue(true);
  });

  it('returns false when openPrintFrame fails', () => {
    openPrintFrameMock.mockReturnValue(false);
    expect(openInvoicePrintWindow(minimalPreview())).toBe(false);
  });

  it('delegates to openPrintFrame with title, rootId and element', () => {
    const p = minimalPreview();
    expect(openInvoicePrintWindow(p, { title: 'Test FV' })).toBe(true);
    expect(openPrintFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test FV',
        rootId: 'invoice-print-root',
      }),
    );
    const arg = openPrintFrameMock.mock.calls[0][0] as { element: unknown };
    expect(arg.element).toBeDefined();
  });
});

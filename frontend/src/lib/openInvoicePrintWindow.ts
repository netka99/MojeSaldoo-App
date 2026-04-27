import { createElement } from 'react';
import { InvoicePrintView } from '@/components/print/InvoicePrintView';
import { openPrintFrame } from '@/lib/printFrame';
import type { InvoicePreviewPayload } from '@/types';

export type OpenInvoicePrintWindowOptions = {
  /** Optional bank account string for the print view. */
  bankAccount?: string;
  /** Print view / document title; defaults from invoice number. */
  title?: string;
};

const ROOT_ID = 'invoice-print-root';

/**
 * Renders the invoice in a same-origin print iframe, copies app styles, then
 * {@link Window.print}. Unmounts and removes the iframe after `afterprint`.
 */
export function openInvoicePrintWindow(
  preview: InvoicePreviewPayload,
  options?: OpenInvoicePrintWindowOptions,
): boolean {
  const titleText =
    options?.title?.trim() ||
    (preview.invoice?.invoice_number
      ? `Faktura ${preview.invoice.invoice_number}`.trim()
      : 'Faktura');

  return openPrintFrame({
    title: titleText,
    rootId: ROOT_ID,
    element: createElement(InvoicePrintView, { bankAccount: options?.bankAccount, preview }),
  });
}

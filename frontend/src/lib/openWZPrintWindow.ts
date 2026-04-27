import { createElement } from 'react';
import { WZPrintView } from '@/components/print/WZPrintView';
import { openPrintFrame } from '@/lib/printFrame';
import type { DeliveryDocumentPreviewPayload } from '@/types';

export type OpenWZPrintWindowOptions = {
  /** `<title>` of the print view; defaults from document number and type. */
  title?: string;
  /** Value for the „Wystawił:” line (optional). */
  issuedByName?: string;
};

const ROOT_ID = 'wz-print-root';

/**
 * Renders the WZ in a same-origin print iframe, copies app styles, then
 * {@link Window.print}. Unmounts and removes the iframe after `afterprint`.
 */
export function openWZPrintWindow(
  preview: DeliveryDocumentPreviewPayload,
  options?: OpenWZPrintWindowOptions,
): boolean {
  const doc = preview.document;
  const titleText =
    options?.title?.trim() ||
    (doc.document_number?.trim()
      ? `${doc.document_type} ${doc.document_number}`.trim()
      : 'Dokument magazynowy');

  return openPrintFrame({
    title: titleText,
    rootId: ROOT_ID,
    element: createElement(WZPrintView, {
      issuedByName: options?.issuedByName,
      preview,
    }),
  });
}

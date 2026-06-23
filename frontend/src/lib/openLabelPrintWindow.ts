import { createElement } from 'react';
import { LabelPrintView } from '@/components/print/LabelPrintView';
import { openPrintFrame } from '@/lib/printFrame';
import type { LabelProduct } from '@/components/print/LabelPrintView';

export type { LabelProduct };

/**
 * Opens a same-origin print iframe, renders the product label(s) and calls
 * {@link Window.print}. Returns `false` when the iframe cannot be mounted
 * (e.g., CSP or headless test env).
 */
export function openLabelPrintWindow(
  product: LabelProduct,
  options?: { copies?: number; subtitle?: string },
): boolean {
  const title = `Etykieta — ${product.name}`;

  return openPrintFrame({
    title,
    rootId: 'label-print-root',
    element: createElement(LabelPrintView, {
      product,
      copies: options?.copies ?? 1,
      subtitle: options?.subtitle,
    }),
  });
}

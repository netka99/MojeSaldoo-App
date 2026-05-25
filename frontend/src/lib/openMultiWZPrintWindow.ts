import { createElement } from 'react';
import { WZPrintView } from '@/components/print/WZPrintView';
import { openPrintFrame } from '@/lib/printFrame';
import type { DeliveryDocumentPreviewPayload } from '@/types';

const ROOT_ID = 'wz-multi-print-root';

const EXTRA_STYLES = `
  @media print {
    /* In multi-doc mode, each wz-print-scope must flow normally (not position:absolute) */
    .wz-print-scope { position: relative !important; left: auto !important; top: auto !important; width: 100% !important; }
    .wz-multi-page-break { page-break-after: always; break-after: page; }
  }
`;

export function openMultiWZPrintWindow(previews: DeliveryDocumentPreviewPayload[]): boolean {
  if (previews.length === 0) return false;

  const title =
    previews.length === 1
      ? `WZ ${previews[0]!.document.document_number?.trim() || previews[0]!.document.id.slice(0, 8)}`
      : `WZ — ${previews.length} dokumentów`;

  const element = createElement(
    'div',
    null,
    ...previews.map((preview, i) =>
      createElement(
        'div',
        {
          key: preview.document.id,
          className: i < previews.length - 1 ? 'wz-multi-page-break' : undefined,
        },
        createElement(WZPrintView, { preview }),
      ),
    ),
  );

  return openPrintFrame({ title, rootId: ROOT_ID, element, extraStyles: EXTRA_STYLES });
}

import { createElement } from 'react';
import { INWPrintView } from '@/components/print/INWPrintView';
import { openPrintFrame } from '@/lib/printFrame';
import type { InventoryCount } from '@/types/inventory.types';

const ROOT_ID = 'inw-print-root';

export function openINWPrintWindow(count: InventoryCount): boolean {
  const title = `${count.document_number || 'INW'} — Arkusz inwentaryzacyjny`;
  return openPrintFrame({
    title,
    rootId: ROOT_ID,
    element: createElement(INWPrintView, { count }),
  });
}

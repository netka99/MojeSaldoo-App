import { createElement } from 'react';
import { OrderPrintView } from '@/components/print/OrderPrintView';
import { openPrintFrame } from '@/lib/printFrame';
import type { Order } from '@/types';

const ROOT_ID = 'order-print-root';

export function openOrderPrintWindow(order: Order, companyName?: string): boolean {
  const title = order.order_number
    ? `Zamówienie ${order.order_number}`
    : `Zamówienie ${order.id.slice(0, 8)}`;

  return openPrintFrame({
    title,
    rootId: ROOT_ID,
    element: createElement(OrderPrintView, { order, companyName }),
  });
}

import { useMemo, useState } from 'react';
import { formatMoneyGross, formatOrderLineQuantityWithUnit, sumOrdersGross } from '@/lib/order-utils';
import { cn } from '@/lib/utils';
import type { Order, OrderItem } from '@/types';

export interface OrdersDaySummaryProps {
  orders: Order[];
}

/** Collapsed bar label: count of distinct products after aggregation (PL plural rules). */
function distinctProductCountLabel(n: number): string {
  if (n === 0) return 'Brak produktów';
  if (n === 1) return '1 produkt';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${n} produkty`;
  }
  return `${n} produktów`;
}

function parseDecimal(value: string | number | undefined | null): number {
  const num = typeof value === 'string' ? Number.parseFloat(value) : Number(value ?? Number.NaN);
  return Number.isFinite(num) ? num : 0;
}

/** Gross value of returned qty (prorated from line total). */
function lineReturnGross(it: OrderItem): number {
  const q = parseDecimal(it.quantity);
  const qr = parseDecimal(it.quantity_returned);
  if (q <= 0 || qr <= 0) return 0;
  const lineGross = parseDecimal(it.line_total_gross);
  return (lineGross * qr) / q;
}

/** Sum quantities & line totals for the same catalogue product across all orders on this day. */
function aggregateProductsFromOrders(orders: Order[]): {
  key: string;
  product_name: string;
  product_unit: string;
  quantityTotal: number;
  lineTotalGrossSum: number;
}[] {
  const map = new Map<
    string,
    { product_name: string; product_unit: string; quantityTotal: number; lineTotalGrossSum: number }
  >();

  for (const order of orders) {
    const items = order.items ?? [];
    for (const it of items) {
      const trimmedId = typeof it.product_id === 'string' ? it.product_id.trim() : '';
      const mergeKey =
        trimmedId ||
        `${(it.product_name ?? '').trim() || '—'}\u0000${(it.product_unit || 'szt.').trim()}`;
      const prev = map.get(mergeKey);
      const qty = parseDecimal(it.quantity);
      const lineGross = parseDecimal(it.line_total_gross);
      if (!prev) {
        map.set(mergeKey, {
          product_name: (it.product_name ?? '').trim() || '—',
          product_unit: (it.product_unit || 'szt.').trim(),
          quantityTotal: qty,
          lineTotalGrossSum: lineGross,
        });
      } else {
        prev.quantityTotal += qty;
        prev.lineTotalGrossSum += lineGross;
      }
    }
  }

  return [...map.entries()]
    .map(([key, row]) => ({ key, ...row }))
    .sort((a, b) =>
      a.product_name.localeCompare(b.product_name, 'pl', { sensitivity: 'base' }),
    );
}

/** Aggregate return quantities & prorated gross per product. */
function aggregateReturnsFromOrders(orders: Order[]): {
  key: string;
  product_name: string;
  product_unit: string;
  quantityReturned: number;
  returnGrossSum: number;
}[] {
  const map = new Map<
    string,
    { product_name: string; product_unit: string; quantityReturned: number; returnGrossSum: number }
  >();

  for (const order of orders) {
    for (const it of order.items ?? []) {
      const qr = parseDecimal(it.quantity_returned);
      if (qr <= 0) continue;
      const trimmedId = typeof it.product_id === 'string' ? it.product_id.trim() : '';
      const mergeKey =
        trimmedId ||
        `${(it.product_name ?? '').trim() || '—'}\u0000${(it.product_unit || 'szt.').trim()}`;
      const g = lineReturnGross(it);
      const prev = map.get(mergeKey);
      if (!prev) {
        map.set(mergeKey, {
          product_name: (it.product_name ?? '').trim() || '—',
          product_unit: (it.product_unit || 'szt.').trim(),
          quantityReturned: qr,
          returnGrossSum: g,
        });
      } else {
        prev.quantityReturned += qr;
        prev.returnGrossSum += g;
      }
    }
  }

  return [...map.entries()]
    .map(([key, row]) => ({ key, ...row }))
    .sort((a, b) =>
      a.product_name.localeCompare(b.product_name, 'pl', { sensitivity: 'base' }),
    );
}

function sumOrderLinesGross(orders: Order[]): number {
  let s = 0;
  for (const o of orders) {
    for (const it of o.items ?? []) {
      s += parseDecimal(it.line_total_gross);
    }
  }
  return s;
}

function sumReturnsGross(orders: Order[]): number {
  let s = 0;
  for (const o of orders) {
    for (const it of o.items ?? []) {
      s += lineReturnGross(it);
    }
  }
  return s;
}

/** Chevron: `open` when panel is expanded (points up to collapse). */
function SummaryChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={cn(
        'h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300',
        !open && 'rotate-180',
        className,
      )}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

export function OrdersDaySummary({ orders }: OrdersDaySummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const ordersDayTotal = useMemo(() => sumOrdersGross(orders), [orders]);
  const linesSubtotal = useMemo(() => sumOrderLinesGross(orders), [orders]);
  const returnsGross = useMemo(() => sumReturnsGross(orders), [orders]);
  const productLines = useMemo(() => aggregateProductsFromOrders(orders), [orders]);
  const returnLines = useMemo(() => aggregateReturnsFromOrders(orders), [orders]);

  const toggleExpanded = () => setExpanded((v) => !v);

  const summaryToggleLabel = `Podsumowanie, ${distinctProductCountLabel(productLines.length)}`;

  const subtotalFmt = formatMoneyGross(linesSubtotal);
  const returnsFmt = formatMoneyGross(returnsGross);
  const dayTotalFmt = formatMoneyGross(ordersDayTotal);

  return (
    <div
      className={cn(
        'fixed bottom-[calc(83px+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-3',
        'md:bottom-0 md:left-64 md:pb-[max(0.35rem,env(safe-area-inset-bottom))]',
      )}
    >
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-t-2xl border border-b-0 border-border/45 bg-card shadow-[0_-6px_24px_rgba(0,0,0,0.08)]">
        {/* Expands upward */}
        <div
          className={cn(
            'overflow-hidden transition-[max-height] duration-300 ease-in-out',
            expanded ? 'max-h-[min(55vh,24rem)]' : 'max-h-0',
          )}
          id="orders-day-summary-panel"
          aria-hidden={!expanded}
        >
          <div className="max-h-[min(55vh,24rem)] overflow-auto px-3 pb-2 pt-3">
            {productLines.length === 0 ? (
              <p className="py-2 text-center text-[13px] text-muted-foreground">Brak pozycji w zamówieniach.</p>
            ) : (
              <>
                <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
                  <caption className="sr-only">Pozycje sprzedaży złączone wg produktu</caption>
                  <colgroup>
                    <col />
                    <col className="w-[5rem]" />
                    <col className="w-[36%]" />
                  </colgroup>
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Produkt</th>
                      <th scope="col">Ilość</th>
                      <th scope="col">Wartość</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/35">
                    {productLines.map((line) => (
                      <tr key={line.key}>
                        <td className="max-w-[1px] py-1.5 pr-2 text-left text-foreground">
                          <span className="block truncate" title={line.product_name}>
                            {line.product_name}
                          </span>
                        </td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums text-foreground align-baseline">
                          {formatOrderLineQuantityWithUnit(line.quantityTotal, line.product_unit)}
                        </td>
                        <td className="py-1.5 pl-1.5 text-right tabular-nums font-medium text-foreground align-baseline">
                          {formatMoneyGross(line.lineTotalGrossSum)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="my-2 border-t border-border/55" />
                <div className="flex items-baseline justify-between gap-2 text-[13px] font-semibold">
                  <span className="text-foreground">Suma</span>
                  <span className="tabular-nums text-foreground">{subtotalFmt}</span>
                </div>
              </>
            )}

            {returnLines.length > 0 ? (
              <>
                <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                  Zwrot
                </p>
                <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
                  <caption className="sr-only">Pozycje zwrotów</caption>
                  <colgroup>
                    <col />
                    <col className="w-[5rem]" />
                    <col className="w-[36%]" />
                  </colgroup>
                  <tbody className="divide-y divide-border/35">
                    {returnLines.map((line) => (
                      <tr key={line.key}>
                        <td className="max-w-[1px] py-1.5 pr-2 text-left text-amber-700 dark:text-amber-400">
                          <span className="block truncate" title={line.product_name}>
                            {line.product_name}
                          </span>
                        </td>
                        <td className="py-1.5 px-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400 align-baseline">
                          {formatOrderLineQuantityWithUnit(line.quantityReturned, line.product_unit)}
                        </td>
                        <td className="py-1.5 pl-1.5 text-right tabular-nums font-medium text-amber-700 dark:text-amber-400 align-baseline">
                          −{formatMoneyGross(line.returnGrossSum)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="my-2 border-t border-border/55" />
                <div className="flex items-baseline justify-between gap-2 text-[13px] font-semibold text-amber-700 dark:text-amber-400">
                  <span>Suma</span>
                  <span className="tabular-nums">−{returnsFmt}</span>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* Compact strip — always visible */}
        <div className="space-y-1 px-3 pt-2.5 pb-1">
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Suma pozycji</span>
            <span className="tabular-nums text-foreground">{subtotalFmt}</span>
          </div>
          {returnsGross > 0.005 ? (
            <div className="flex justify-between text-[13px] text-amber-600 dark:text-amber-500">
              <span>Zwrot</span>
              <span className="tabular-nums">−{returnsFmt}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border/50 pt-1.5 text-[14px] font-semibold text-foreground">
            <span>Suma</span>
            <span className="tabular-nums">{dayTotalFmt}</span>
          </div>
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 border-t border-border/50 px-3 py-2.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-expanded={expanded}
          aria-controls="orders-day-summary-panel"
          onClick={toggleExpanded}
          aria-label={summaryToggleLabel}
        >
          Podsumowanie
          <SummaryChevron open={expanded} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

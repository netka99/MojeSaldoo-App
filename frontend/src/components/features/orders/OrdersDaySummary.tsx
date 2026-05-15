import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { formatMoneyGross, sumOrdersGross } from '@/lib/order-utils';
import { cn } from '@/lib/utils';
import type { Order } from '@/types';

export interface OrdersDaySummaryProps {
  orders: Order[];
  onGenerateWz?: () => void;
  onLoadVan?: () => void;
  deliveryEnabled: boolean;
  /** When true, user is selecting confirmed orders before batch WZ generation. */
  wzSelectionMode: boolean;
  /** Currently selected order IDs (WZ selection). */
  selectedIds?: string[];
  selectedCount: number;
  confirmedCount: number;
  onConfirmWzSelection: () => void;
  onCancelWzSelection: () => void;
  generateWzPending: boolean;
  /** 1-based progress while generating WZ sequentially (e.g. 2 of 5). */
  wzProgress?: { current: number; total: number } | null;
}

function shopCountLabel(n: number): string {
  if (n === 1) return '1 sklep';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${n} sklepy`;
  }
  return `${n} sklepów`;
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300', expanded && 'rotate-180', className)}
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

export function OrdersDaySummary({
  orders,
  onGenerateWz,
  onLoadVan,
  deliveryEnabled,
  wzSelectionMode,
  selectedIds = [],
  selectedCount,
  confirmedCount,
  onConfirmWzSelection,
  onCancelWzSelection,
  generateWzPending,
  wzProgress = null,
}: OrdersDaySummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const totalGross = useMemo(() => sumOrdersGross(orders), [orders]);
  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'pl')),
    [orders],
  );

  const summaryLine = (
    <>
      <span className="font-medium text-foreground">
        {shopCountLabel(orders.length)}
        <span className="text-muted-foreground"> · </span>
        <span className="tabular-nums">{formatMoneyGross(totalGross)}</span>
      </span>
    </>
  );

  const toggleExpanded = () => setExpanded((v) => !v);

  return (
    <div
      className={cn(
        'fixed left-0 right-0 z-40 px-4',
        'bottom-[calc(83px+env(safe-area-inset-bottom))] md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      )}
    >
      <div
        className={cn(
          'mx-auto max-w-3xl overflow-hidden border border-border/50 bg-surface-card/98 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-xl',
          deliveryEnabled ? 'rounded-t-2xl border-b-0' : 'rounded-2xl',
        )}
      >

        {/* Expands upward — max-height transition */}
        <div
          className={cn(
            'overflow-hidden transition-[max-height] duration-300 ease-in-out',
            expanded ? 'max-h-[min(50vh,22rem)]' : 'max-h-0',
          )}
          id="orders-day-summary-panel"
          aria-hidden={!expanded}
        >
          <div className="max-h-[min(50vh,22rem)] overflow-auto px-4 pt-3">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border/40">
                {sortedOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2 pr-3 text-left text-foreground">{o.customer_name}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-foreground">
                      {formatMoneyGross(o.total_gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="my-2 border-t border-border/60" />
            <div className="flex items-baseline justify-between gap-3 pb-1 text-sm font-semibold">
              <span className="text-foreground">Razem</span>
              <span className="tabular-nums text-foreground">{formatMoneyGross(totalGross)}</span>
            </div>
          </div>
        </div>

        {/* Summary toggle — always visible */}
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={expanded}
          aria-controls="orders-day-summary-panel"
          onClick={toggleExpanded}
        >
          {summaryLine}
          <ChevronIcon expanded={expanded} />
        </button>

        {/* Actions — not inside expanding area */}
        {deliveryEnabled ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 px-4 py-3">
            {wzSelectionMode ? (
              <>
                {selectedIds.length > 0 ? (
                  <span id="orders-day-wz-selected-ids" className="sr-only">
                    Wybrane zamówienia: {selectedIds.join(', ')}
                  </span>
                ) : null}
                {wzProgress && generateWzPending ? (
                  <p
                    className="mr-auto w-full text-xs text-muted-foreground sm:w-auto"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    WZ ({wzProgress.current}/{wzProgress.total})…
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={generateWzPending}
                  onClick={() => onCancelWzSelection()}
                >
                  Anuluj
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={selectedCount === 0 || generateWzPending}
                  loading={generateWzPending && !wzProgress}
                  onClick={() => void onConfirmWzSelection()}
                  aria-describedby={selectedIds.length > 0 ? 'orders-day-wz-selected-ids' : undefined}
                >
                  Utwórz WZ ({selectedCount})
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => onLoadVan?.()}>
                  Załaduj Van
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={confirmedCount === 0}
                  onClick={() => onGenerateWz?.()}
                >
                  Generuj WZ
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

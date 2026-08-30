import { Link } from 'react-router-dom';
import { useStockMovementsQuery } from '@/query/use-products';
import { useWarehouseBatchesQuery } from '@/query/use-warehouses';
import { cn } from '@/lib/utils';
import {
  MOVEMENT_LABELS,
  MOVEMENT_COLORS,
  DOC_LABELS,
  docLink,
  fmtQty,
} from './stockHistory.shared';
import type { WarehouseStockItem } from '@/types';

const PREVIEW_SIZE = 5;

interface Props {
  item: WarehouseStockItem;
  warehouseId: string;
  colSpan: number;
  onOpenDrawer: () => void;
}

export function StockRowExpanded({ item, warehouseId, colSpan, onOpenDrawer }: Props) {
  const movementsQ = useStockMovementsQuery({
    product: item.product_id,
    warehouse: warehouseId,
    page: 1,
    page_size: PREVIEW_SIZE,
  });

  const batchesQ = useWarehouseBatchesQuery(warehouseId, item.product_id);

  const movements = movementsQ.data?.results ?? [];
  const total = movementsQ.data?.count ?? 0;
  const batches = batchesQ.data ?? [];
  const hasBatches = batches.length > 0;

  return (
    <tr className="bg-muted/20">
      <td colSpan={colSpan} className="px-5 pb-3 pt-0">
        <div className="flex gap-0 rounded-xl border border-border bg-background shadow-sm overflow-hidden">

          {/* Movements */}
          <div className={cn('min-w-0 flex-1 px-4 py-3', hasBatches && movements.length === 0 && 'flex-none w-1/2')}>
            <div className="mb-1.5 flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ostatnie ruchy
              </p>
              {total > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {total} łącznie
                </span>
              )}
            </div>

            {movementsQ.isLoading && (
              <p className="py-2 text-xs text-muted-foreground">Ładowanie…</p>
            )}
            {!movementsQ.isLoading && movements.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">Brak historii ruchów.</p>
            )}
            {movements.length > 0 && (
              <div className="divide-y divide-border/50">
                {movements.map((m) => {
                  const qty = typeof m.quantity === 'string' ? parseFloat(m.quantity) : m.quantity;
                  const isPositive = qty >= 0;
                  const typeKey = m.movement_type.toUpperCase();
                  const refType = m.reference_type?.toLowerCase() ?? '';
                  const isTransfer = typeKey === 'TRANSFER';
                  const resolvedDocLabel = isTransfer && (refType === 'delivery' || refType === 'delivery_document')
                    ? 'MM'
                    : (DOC_LABELS[refType] ?? m.reference_type ?? '');
                  const docLabel = m.reference_type && m.reference_id
                    ? m.reference_number ?? `${resolvedDocLabel} ${m.reference_id.slice(0, 8)}…`
                    : null;
                  const docHref = m.reference_type && m.reference_id
                    ? docLink(m.reference_type, m.reference_id)
                    : null;

                  return (
                    <div key={m.id} className="flex items-center gap-3 py-1.5 text-xs">
                      {/* date */}
                      <span className="w-[76px] shrink-0 tabular-nums text-muted-foreground">
                        {new Date(m.created_at).toLocaleString('pl-PL', {
                          day: '2-digit', month: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      {/* type */}
                      <span className={cn('w-[100px] shrink-0 truncate font-medium', MOVEMENT_COLORS[typeKey] ?? 'text-foreground')}>
                        {MOVEMENT_LABELS[typeKey] ?? m.movement_type}
                      </span>
                      {/* qty change */}
                      <span className={cn('shrink-0 font-semibold tabular-nums', isPositive ? 'text-green-700' : 'text-red-600')}>
                        {isPositive ? '+' : ''}{qty}
                      </span>
                      {/* arrow + state after */}
                      <span className="shrink-0 text-muted-foreground">→</span>
                      <span className="shrink-0 font-medium tabular-nums text-foreground">
                        {fmtQty(m.quantity_after)}
                      </span>
                      {/* doc */}
                      {docLabel && (
                        <span className="ml-auto shrink-0">
                          {docHref
                            ? <Link to={docHref} className="text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>{docLabel}</Link>
                            : <span className="text-muted-foreground">{docLabel}</span>}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Batches — only rendered when present */}
          {hasBatches && (
            <div className={cn(
              'shrink-0 border-l border-border px-4 py-3',
              movements.length === 0 ? 'flex-1' : 'w-60',
            )}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Partie (FIFO)
              </p>
              <div className="divide-y divide-border/50">
                {batches.map((b) => {
                  const isExpiringSoon = b.expiry_date
                    ? (new Date(b.expiry_date).getTime() - Date.now()) / 86400000 < 30
                    : false;
                  return (
                    <div key={b.id} className="flex items-start justify-between gap-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{b.batch_number ?? '—'}</div>
                        <div className="text-[10px] text-muted-foreground">
                          przyjęcie: {new Date(b.received_date).toLocaleDateString('pl-PL')}
                        </div>
                        {b.expiry_date && (
                          <div className={cn('text-[10px]', isExpiringSoon ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                            {isExpiringSoon ? '⚠ ' : ''}wg. {new Date(b.expiry_date).toLocaleDateString('pl-PL')}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">
                        {fmtQty(b.quantity_remaining)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-1.5 flex justify-end pr-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenDrawer(); }}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Pełna historia
            <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden>
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

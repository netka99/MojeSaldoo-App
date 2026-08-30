import { useState } from 'react';
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
import type { StockBatch, WarehouseStockItem } from '@/types';

const PAGE_SIZE = 25;

function BatchRow({ batch }: { batch: StockBatch }) {
  const isExpiringSoon = batch.expiry_date
    ? (new Date(batch.expiry_date).getTime() - Date.now()) / 86400000 < 30
    : false;

  return (
    <tr className="hover:bg-muted/20">
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
        {batch.batch_number ?? '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
        {new Date(batch.received_date).toLocaleDateString('pl-PL')}
      </td>
      <td className={cn('whitespace-nowrap px-3 py-2.5 text-xs', isExpiringSoon ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
        {batch.expiry_date ? new Date(batch.expiry_date).toLocaleDateString('pl-PL') : '—'}
        {isExpiringSoon && <span className="ml-1 text-[10px]">⚠</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
        {fmtQty(batch.quantity_initial)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">
        {fmtQty(batch.quantity_remaining)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
        {batch.unit_cost ? `${fmtQty(batch.unit_cost)} zł` : '—'}
      </td>
    </tr>
  );
}

interface Props {
  item: WarehouseStockItem;
  warehouseId: string;
  warehouseName: string;
  onClose: () => void;
}

type Tab = 'history' | 'batches';

export function ProductHistoryDrawer({ item, warehouseId, warehouseName, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('history');
  const [page, setPage] = useState(1);

  const movementsQ = useStockMovementsQuery({
    product: item.product_id,
    warehouse: warehouseId,
    page,
    page_size: PAGE_SIZE,
  });

  const batchesQ = useWarehouseBatchesQuery(warehouseId, item.product_id);

  const movements = movementsQ.data?.results ?? [];
  const total = movementsQ.data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const batches = batchesQ.data ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{item.product_name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{warehouseName}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Dostępne: <span className="font-medium text-foreground">{fmtQty(item.quantity_available)} {item.product_unit}</span></span>
              <span>Zarezerwowane: <span className="font-medium text-foreground">{fmtQty(item.quantity_reserved)} {item.product_unit}</span></span>
              <span>Razem: <span className="font-semibold text-foreground">{fmtQty(item.quantity_total)} {item.product_unit}</span></span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Zamknij"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5">
          <button
            type="button"
            onClick={() => setTab('history')}
            className={cn(
              'py-3 pr-4 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === 'history'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            Historia ruchów
            {total > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {total}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('batches')}
            className={cn(
              'py-3 pr-4 pl-4 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === 'batches'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            Partie (FIFO)
            {batches.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {batches.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'history' && (
            <>
              {movementsQ.isLoading && (
                <p className="py-10 text-center text-sm text-muted-foreground">Ładowanie historii…</p>
              )}
              {movementsQ.isError && (
                <p className="py-10 text-center text-sm text-destructive">Nie udało się wczytać historii.</p>
              )}
              {!movementsQ.isLoading && !movementsQ.isError && movements.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">Brak ruchów dla tego produktu w tym magazynie.</p>
              )}
              {movements.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Data</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Typ</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Ilość</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Stan przed</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Stan po</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Dokument</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
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
                          <tr key={m.id} className="hover:bg-muted/30">
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                              {new Date(m.created_at).toLocaleString('pl-PL', {
                                day: '2-digit', month: '2-digit', year: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={cn('block whitespace-nowrap text-xs font-medium', MOVEMENT_COLORS[typeKey] ?? 'text-foreground')}>
                                {MOVEMENT_LABELS[typeKey] ?? m.movement_type}
                              </span>
                              {m.notes && (
                                <span className="block max-w-[160px] truncate text-[11px] leading-tight text-muted-foreground">
                                  {m.notes}
                                </span>
                              )}
                            </td>
                            <td className={cn('whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold tabular-nums', isPositive ? 'text-green-700' : 'text-red-600')}>
                              {isPositive ? '+' : ''}{qty}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                              {m.quantity_before}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                              {m.quantity_after}
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {docLabel
                                ? docHref
                                  ? <Link to={docHref} className="text-primary underline-offset-2 hover:underline">{docLabel}</Link>
                                  : <span className="text-muted-foreground">{docLabel}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Strona {page} z {totalPages} ({total} ruchów)</p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded border border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
                    >‹</button>
                    <button
                      type="button"
                      disabled={page === totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded border border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
                    >›</button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'batches' && (
            <>
              {batchesQ.isLoading && (
                <p className="py-10 text-center text-sm text-muted-foreground">Ładowanie partii…</p>
              )}
              {batchesQ.isError && (
                <p className="py-10 text-center text-sm text-destructive">Nie udało się wczytać partii.</p>
              )}
              {!batchesQ.isLoading && !batchesQ.isError && batches.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">Brak aktywnych partii (FIFO) dla tego produktu.</p>
              )}
              {batches.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Nr partii</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Przyjęcie</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Ważność</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Ilość pocz.</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Pozostało</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Koszt jedn.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {batches.map((b) => <BatchRow key={b.id} batch={b} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

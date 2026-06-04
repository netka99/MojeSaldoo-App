import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useProductQuery, useStockMovementsQuery } from '@/query/use-products';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { StockMovementListItem } from '@/types';

const PAGE_SIZE = 25;

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: 'Zakup / Przyjęcie',
  SALE: 'Sprzedaż / Wydanie',
  RETURN: 'Zwrot',
  ADJUSTMENT: 'Korekta ręczna',
  TRANSFER: 'Przesunięcie MM',
  DAMAGE: 'Uszkodzenie',
  RESERVATION: 'Rezerwacja',
  UNRESERVATION: 'Zwolnienie rez.',
};

const MOVEMENT_TYPE_OPTIONS = [
  { value: '', label: 'Wszystkie typy' },
  { value: 'SALE', label: 'Sprzedaż / Wydanie' },
  { value: 'PURCHASE', label: 'Zakup / Przyjęcie' },
  { value: 'RETURN', label: 'Zwrot' },
  { value: 'TRANSFER', label: 'Przesunięcie MM' },
  { value: 'ADJUSTMENT', label: 'Korekta ręczna' },
  { value: 'DAMAGE', label: 'Uszkodzenie' },
  { value: 'RESERVATION', label: 'Rezerwacja' },
  { value: 'UNRESERVATION', label: 'Zwolnienie rez.' },
];

const MOVEMENT_COLORS: Record<string, string> = {
  PURCHASE: 'text-green-700',
  SALE: 'text-red-600',
  RETURN: 'text-blue-600',
  ADJUSTMENT: 'text-orange-600',
  TRANSFER: 'text-violet-600',
  DAMAGE: 'text-red-900',
  RESERVATION: 'text-yellow-700',
  UNRESERVATION: 'text-muted-foreground',
};

const DOC_LABELS: Record<string, string> = {
  delivery: 'WZ',
  delivery_document: 'WZ',
  order: 'ZAM',
  purchase: 'PZ',
  purchase_document: 'PZ',
  van_route: 'Trasa',
  inventory_count: 'Inwentaryzacja',
};

function docLink(referenceType: string, referenceId: string): string | null {
  const type = referenceType.toLowerCase();
  if (type === 'delivery' || type === 'delivery_document') return `/delivery/${referenceId}`;
  if (type === 'order') return `/orders/${referenceId}`;
  return null;
}

function MovementRow({ m }: { m: StockMovementListItem }) {
  const qty = typeof m.quantity === 'string' ? parseFloat(m.quantity) : m.quantity;
  const isPositive = qty >= 0;
  const typeKey = m.movement_type.toUpperCase();
  const refType = m.reference_type?.toLowerCase() ?? '';
  const isTransfer = typeKey === 'TRANSFER';

  const dateStr = new Date(m.created_at).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

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
    <tr className="hover:bg-muted/30">
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{dateStr}</td>
      <td className="px-3 py-2.5">
        <span className={cn('block whitespace-nowrap text-xs font-medium', MOVEMENT_COLORS[typeKey] ?? 'text-foreground')}>
          {MOVEMENT_LABELS[typeKey] ?? m.movement_type}
        </span>
        {m.notes && (
          <span className="block whitespace-nowrap text-[11px] leading-tight text-muted-foreground">
            {m.notes}
          </span>
        )}
      </td>
      <td className="max-w-[140px] truncate px-3 py-2.5 text-xs text-muted-foreground">{m.warehouse_name}</td>
      <td className={cn('whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold tabular-nums', isPositive ? 'text-green-700' : 'text-red-600')}>
        {isPositive ? '+' : ''}{qty}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">{m.quantity_before}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">{m.quantity_after}</td>
      <td className="px-3 py-2.5 text-xs">
        {docLabel
          ? docHref
            ? <Link to={docHref} className="text-primary underline-offset-2 hover:underline">{docLabel}</Link>
            : <span className="text-muted-foreground">{docLabel}</span>
          : <span className="text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}

const selectCn = cn(
  'h-9 rounded-lg border border-input bg-background px-3 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

const inputCn = cn(
  'h-9 rounded-lg border border-input bg-background px-3 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  );
}

export function ProductMovementsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) return <Navigate to="/products" replace />;

  const productQ = useProductQuery(id);
  const warehousesQ = useWarehouseListQuery(1);

  const movementsQ = useStockMovementsQuery({
    product: id,
    warehouse: warehouseFilter || undefined,
    type: typeFilter || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  const total = movementsQ.data?.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function resetFilters() {
    setTypeFilter('');
    setWarehouseFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  function handleFilterChange(fn: () => void) {
    fn();
    setPage(1);
  }

  const hasActiveFilters = typeFilter || warehouseFilter || dateFrom || dateTo;

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-4xl space-y-4 px-4 pb-8 pt-4 sm:px-6">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shadow-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-card text-on-surface transition-colors hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Wróć"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]">
            Historia ruchów
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {productQ.data?.name ?? (productQ.isLoading ? 'Ładowanie…' : '')}
          </p>
        </div>
        {total > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {total}
          </span>
        )}
      </header>

      {/* Filters */}
      <div className="shadow-soft rounded-2xl bg-surface-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <select
            value={typeFilter}
            onChange={(e) => handleFilterChange(() => setTypeFilter(e.target.value))}
            className={selectCn}
            aria-label="Typ ruchu"
          >
            {MOVEMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            value={warehouseFilter}
            onChange={(e) => handleFilterChange(() => setWarehouseFilter(e.target.value))}
            className={selectCn}
            aria-label="Magazyn"
          >
            <option value="">Wszystkie magazyny</option>
            {(warehousesQ.data?.results ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => handleFilterChange(() => setDateFrom(e.target.value))}
            className={inputCn}
            aria-label="Data od"
            placeholder="Data od"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => handleFilterChange(() => setDateTo(e.target.value))}
            className={inputCn}
            aria-label="Data do"
            placeholder="Data do"
          />
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Wyczyść filtry
          </button>
        )}
      </div>

      {/* Table */}
      <div className="shadow-soft rounded-2xl bg-surface-card">
        {movementsQ.isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">Ładowanie historii…</p>
        )}
        {movementsQ.isError && (
          <p className="py-10 text-center text-sm text-destructive">Nie udało się wczytać historii ruchów.</p>
        )}
        {!movementsQ.isLoading && !movementsQ.isError && (
          <>
            {(movementsQ.data?.results ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {hasActiveFilters ? 'Brak ruchów spełniających filtry.' : 'Brak ruchów dla tego produktu.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Data</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Typ</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Magazyn</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Ilość</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Stan przed</th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Stan po</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Dokument</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {(movementsQ.data?.results ?? []).map((m) => (
                      <MovementRow key={m.id} m={m} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Strona {page} z {totalPages} ({total} ruchów)
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    aria-label="Poprzednia strona"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const pageNum = totalPages <= 5
                      ? i + 1
                      : page <= 3
                        ? i + 1
                        : page >= totalPages - 2
                          ? totalPages - 4 + i
                          : page - 2 + i;
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setPage(pageNum)}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-colors',
                          pageNum === page
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'border border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    aria-label="Następna strona"
                  >
                    <ChevronIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState, useCallback } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useVanRouteQuery, useCloseVanRouteMutation, useConfirmLoadingMutation } from '@/query/use-van-routes';
import {
  useVanWZListQuery,
  useCreateStandaloneWzMutation,
  useDeliveryQuery,
  useGenerateDeliveryForOrderMutation,
  useAddReturnsMutation,
} from '@/query/use-delivery';
import { useStockSnapshotQuery } from '@/query/use-products';
import { useOrderQuery } from '@/query/use-orders';
import { cn } from '@/lib/utils';
import type { DeliveryDocument, DeliveryItem, RouteOrder, VanRouteStatus } from '@/types';

/* ─── Helpers ────────────────────────────────────────────────────── */

function formatDatePl(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatQty(qty: string | number, unit?: string): string {
  const n = typeof qty === 'string' ? parseFloat(qty) : qty;
  if (!Number.isFinite(n)) return '—';
  const f = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return unit ? `${f} ${unit}` : f;
}

const STATUS_LABEL: Record<VanRouteStatus, string> = {
  planned: 'Zaplanowana',
  loading: 'Załadunek',
  in_progress: 'W trasie',
  settling: 'Rozliczanie',
  closed: 'Zamknięta',
};

const STATUS_COLOR: Record<VanRouteStatus, string> = {
  planned: 'bg-gray-100 text-gray-600',
  loading: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-emerald-100 text-emerald-700',
  settling: 'bg-amber-100 text-amber-700',
  closed: 'bg-gray-100 text-gray-500',
};

/* ─── Icons ──────────────────────────────────────────────────────── */

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={2}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={2.5}>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── Inline return form ─────────────────────────────────────────── */

function ReturnForm({
  wzId,
  onClose,
}: {
  wzId: string;
  onClose: () => void;
}) {
  const { data: wzDoc, isLoading } = useDeliveryQuery(wzId, true);
  const addReturns = useAddReturnsMutation();
  const [qtys, setQtys] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successZwNumber, setSuccessZwNumber] = useState<string | null>(null);

  const items: DeliveryItem[] = wzDoc?.items ?? [];
  const filtered = search.trim()
    ? items.filter((i) => (i.product_name ?? '').toLowerCase().includes(search.toLowerCase()))
    : items;

  function setQty(productId: string, val: string) {
    setQtys((prev) => {
      const next = new Map(prev);
      if (!val || val === '0') next.delete(productId);
      else next.set(productId, val);
      return next;
    });
  }

  const activeItems = items.filter((i) => {
    const q = parseFloat(qtys.get(i.product_id) ?? '0');
    return q > 0;
  });

  async function handleSubmit() {
    if (activeItems.length === 0) return;
    setError(null);
    try {
      const updatedWz = await addReturns.mutateAsync({
        id: wzId,
        returnItems: activeItems.map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name ?? undefined,
          quantity: parseFloat(qtys.get(i.product_id) ?? '0').toFixed(2),
        })),
      });
      // Find the newest ZW from the response
      const zwDocs = updatedWz.return_documents ?? [];
      const newestZw = zwDocs[zwDocs.length - 1];
      setSuccessZwNumber(newestZw?.document_number ?? 'ZW');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się dodać zwrotu');
    }
  }

  // ── Success state ──────────────────────────────────────────────
  if (successZwNumber) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
        <div className="flex items-start gap-2">
          <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" stroke="currentColor" strokeWidth={2.5}>
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Zwrot zarejestrowany
            </p>
            <p className="text-[12px] text-emerald-600 dark:text-emerald-500">
              Utworzono dokument {successZwNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            aria-label="Zamknij"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background p-3">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Zwrot produktów
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label="Zamknij"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Search */}
      {items.length > 4 && (
        <input
          type="text"
          placeholder="Szukaj produktu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
      )}

      {isLoading && (
        <p className="py-3 text-center text-xs text-muted-foreground">Ładowanie pozycji…</p>
      )}

      {/* Items */}
      <div className="flex flex-col gap-1.5">
        {filtered.map((item) => {
          const qtyStr = qtys.get(item.product_id) ?? '';
          const active = parseFloat(qtyStr) > 0;
          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors',
                active && 'bg-destructive/5',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {item.product_name ?? item.product_id}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="0"
                value={qtyStr}
                onChange={(e) => setQty(item.product_id, e.target.value)}
                className={cn(
                  'h-8 w-20 rounded-lg border border-input bg-background px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/25',
                  active && 'border-destructive/40',
                )}
              />
            </div>
          );
        })}
        {filtered.length === 0 && !isLoading && (
          <p className="py-2 text-center text-xs text-muted-foreground">Brak pozycji</p>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={addReturns.isPending || activeItems.length === 0}
        className={cn(
          'mt-2 w-full rounded-xl py-2 text-sm font-semibold transition-colors',
          activeItems.length > 0 && !addReturns.isPending
            ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'bg-muted text-muted-foreground cursor-not-allowed',
        )}
      >
        {addReturns.isPending
          ? 'Zapisywanie…'
          : activeItems.length === 0
            ? 'Wybierz produkty'
            : `Zarejestruj zwrot (${activeItems.length} poz.)`}
      </button>
    </div>
  );
}

/* ─── Stop card ──────────────────────────────────────────────────── */

function StopCard({
  index,
  order,
  wz,
  locked,
  vanWarehouseId,
  onCreateWz,
  isCreatingWz,
  onNavigate,
}: {
  index: number;
  order: RouteOrder;
  wz: DeliveryDocument | null;
  locked: boolean;
  vanWarehouseId: string | undefined;
  onCreateWz: (orderId: string) => Promise<void>;
  isCreatingWz: boolean;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [wzError, setWzError] = useState<string | null>(null);

  const { data: orderDetail, isLoading: orderLoading } = useOrderQuery(order.id, expanded);
  // Fetch full WZ detail when expanded so we have return_documents
  const { data: wzDetail } = useDeliveryQuery(wz?.id, expanded && wz !== null);

  const done = wz !== null;
  const zwDocs = wzDetail?.return_documents ?? [];

  async function handleCreateWz() {
    setWzError(null);
    try {
      await onCreateWz(order.id);
    } catch (e) {
      setWzError(e instanceof Error ? e.message : 'Nie udało się utworzyć WZ');
    }
  }

  return (
    <div className={cn(
      'shadow-soft w-full overflow-hidden rounded-2xl bg-surface-card text-left transition-colors',
      done && 'border-l-4 border-l-emerald-400',
      locked && 'opacity-40',
    )}>
      {/* Main clickable row — navigates on click */}
      <div
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-label={`${order.customer_name}, ${done ? (wz!.document_number ?? 'WZ wystawiona') : order.order_number ?? 'brak WZ'}`}
        onClick={() => { if (!locked) onNavigate(); }}
        onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNavigate(); } }}
        className={cn(
          'flex w-full cursor-pointer gap-3 p-3.5 transition-colors hover:bg-surface-low/40 active:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
          locked && 'cursor-not-allowed',
        )}
      >
        {/* Index / check */}
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            done ? 'bg-emerald-100 text-emerald-700' : 'bg-primary/10 text-primary',
            locked && 'bg-gray-100 text-gray-400',
          )}
          aria-hidden
        >
          {done ? <CheckIcon className="h-5 w-5" /> : index + 1}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{order.customer_name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px]">
            {done ? (
              <>
                <span className="font-medium text-emerald-600">{wz!.document_number ?? 'WZ wystawiona'}</span>
                {zwDocs.map((zw) => (
                  <span
                    key={zw.id}
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  >
                    {zw.document_number ?? 'ZW'}
                  </span>
                ))}
              </>
            ) : locked ? (
              <span className="text-amber-600 font-medium">Załaduj van, aby wystawić WZ</span>
            ) : (
              <span className="text-muted-foreground">
                {order.order_number ?? '—'} · {order.item_count}{' '}
                {order.item_count === 1 ? 'produkt' : order.item_count < 5 ? 'produkty' : 'produktów'}
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron — stops propagation so it only expands, doesn't navigate */}
        {!locked && (
          <button
            type="button"
            aria-label={expanded ? 'Zwiń' : 'Rozwiń'}
            aria-expanded={expanded}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setExpanded((v) => !v); } }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronDownIcon
              className={cn('h-5 w-5 transition-transform duration-200', expanded && 'rotate-180')}
            />
          </button>
        )}
      </div>

      {/* Expandable section — smooth max-h transition like OrdersPage */}
      <div
        className={cn(
          'overflow-hidden transition-[max-height] duration-300 ease-in-out',
          expanded ? 'max-h-[48rem]' : 'max-h-0',
        )}
        aria-hidden={!expanded}
      >
        <div className="border-t border-border/40 px-4 pb-3 pt-2">
          {/* Order items */}
          {orderLoading && (
            <div className="flex items-center justify-center py-3">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {orderDetail && orderDetail.items.length > 0 && (
            <ul className="mb-3 space-y-1">
              {orderDetail.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-foreground">{item.product_name}</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                    {formatQty(item.quantity, item.product_unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {orderDetail && orderDetail.items.length === 0 && (
            <p className="mb-3 text-xs text-muted-foreground">Brak pozycji w zamówieniu</p>
          )}

          {/* ZW return documents */}
          {zwDocs.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/20">
              {zwDocs.map((zw) => (
                <div key={zw.id}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Zwrot — {zw.document_number ?? 'ZW'}
                  </p>
                  {zw.items.map((item) => (
                    <div key={item.id} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] text-amber-800 dark:text-amber-300">
                        {item.product_name ?? item.product_id}
                      </span>
                      <span className="shrink-0 text-[12px] font-medium tabular-nums text-amber-800 dark:text-amber-300">
                        {formatQty(item.quantity_planned)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {wzError && (
            <p className="mb-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              {wzError}
            </p>
          )}

          {/* Action buttons */}
          {!showReturn && (
            <div className="flex gap-2">
              {!done && (
                <button
                  type="button"
                  onClick={() => void handleCreateWz()}
                  disabled={isCreatingWz}
                  className={cn(
                    'flex-1 rounded-xl py-2 text-sm font-semibold transition-colors',
                    !isCreatingWz
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed',
                  )}
                >
                  {isCreatingWz ? 'Tworzenie WZ…' : 'Utwórz WZ'}
                </button>
              )}
              {done && (
                <button
                  type="button"
                  onClick={() => setShowReturn(true)}
                  className="flex-1 rounded-xl border border-destructive/30 bg-destructive/5 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
                >
                  Dodaj zwrot
                </button>
              )}
            </div>
          )}

          {/* Inline return form */}
          {showReturn && wz && (
            <ReturnForm
              wzId={wz.id}
              onClose={() => setShowReturn(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Additional WZ sheet ────────────────────────────────────────── */

interface StockItem {
  product_id: string;
  product_name: string;
  quantity_available: string;
  unit: string;
}

function AdditionalWzSheet({
  stockItems,
  onSubmit,
  onClose,
  isPending,
  error,
}: {
  stockItems: StockItem[];
  onSubmit: (items: Array<{ product_id: string; quantity_planned: string }>) => void;
  onClose: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [qtys, setQtys] = useState<Map<string, number>>(new Map());

  const activeItems = stockItems.filter((i) => (qtys.get(i.product_id) ?? 0) > 0);

  function updateQty(productId: string, qty: number) {
    setQtys((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  function handleSubmit() {
    const items = activeItems.map((i) => ({
      product_id: i.product_id,
      quantity_planned: (qtys.get(i.product_id) ?? 0).toFixed(3),
    }));
    onSubmit(items);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          aria-label="Anuluj"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Dodatkowe WZ</h1>
          <p className="text-[12px] text-muted-foreground">Produkty bez przypisanego klienta</p>
        </div>
        {activeItems.length > 0 && (
          <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground">
            {activeItems.length} poz.
          </span>
        )}
      </div>

      {/* Product list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4 pb-[calc(76px+env(safe-area-inset-bottom))]">
        {stockItems.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">Brak towaru w vanie</p>
        )}
        {stockItems.map((item) => {
          const qty = qtys.get(item.product_id) ?? 0;
          return (
            <div
              key={item.product_id}
              className={cn(
                'flex items-center gap-3 rounded-2xl bg-surface-card px-4 py-3 shadow-soft',
                qty > 0 && 'ring-2 ring-primary/20',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{item.product_name}</p>
                <p className="text-[12px] text-muted-foreground">
                  Stan: {formatQty(item.quantity_available, item.unit)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateQty(item.product_id, qty - 1)}
                  disabled={qty === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M5 12h14" strokeLinecap="round" />
                  </svg>
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={qty}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    updateQty(item.product_id, Number.isFinite(v) && v >= 0 ? v : 0);
                  }}
                  className={cn(
                    'h-9 w-12 rounded-lg border-0 bg-transparent text-center text-[18px] font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30',
                    qty > 0 ? 'text-foreground' : 'text-muted-foreground',
                  )}
                />
                <button
                  type="button"
                  onClick={() => updateQty(item.product_id, qty + 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {error && (
          <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Bottom bar */}
      <div className="fixed left-0 right-0 bottom-0 z-10 border-t border-border/40 bg-background/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || activeItems.length === 0}
          className={cn(
            'w-full rounded-xl py-3 text-base font-semibold transition-colors',
            activeItems.length > 0 && !isPending
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {isPending ? 'Tworzenie WZ…' : activeItems.length === 0 ? 'Wybierz produkty' : `Utwórz WZ (${activeItems.length} poz.)`}
        </button>
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */

export function VanRouteDashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { routeId } = useParams<{ routeId: string }>();

  const { data: route, isLoading: routeLoading, isError } = useVanRouteQuery(routeId);
  const closeRoute = useCloseVanRouteMutation();
  const confirmLoading = useConfirmLoadingMutation();
  const createStandaloneWz = useCreateStandaloneWzMutation();
  const generateWz = useGenerateDeliveryForOrderMutation();

  const vanWarehouseId = route?.van_warehouse_id;
  const date = route?.date ?? '';

  /* ── WZ docs issued from this van on this date ── */
  const { data: vanWZDocs, isLoading: wzLoading } = useVanWZListQuery(vanWarehouseId, date);

  /* ── Live van stock ── */
  const { data: stockSnapshot, isLoading: stockLoading } = useStockSnapshotQuery(vanWarehouseId);

  /* ── MM document items — what was loaded THIS route ── */
  const mmDocId = route?.mm_document?.id;
  const { data: mmDoc } = useDeliveryQuery(mmDocId);

  /* ── Additional WZ sheet state ── */
  const [showAdditionalWz, setShowAdditionalWz] = useState(false);
  const [additionalWzError, setAdditionalWzError] = useState<string | null>(null);

  /* ── Map order_id → WZ ── */
  const wzByOrderId = useMemo(() => {
    const m = new Map<string, DeliveryDocument>();
    for (const wz of vanWZDocs ?? []) {
      if (wz.order_id) m.set(wz.order_id, wz);
    }
    return m;
  }, [vanWZDocs]);

  const stops = useMemo(
    () => (route?.orders ?? []).map((o) => ({ order: o, wz: wzByOrderId.get(o.id) ?? null })),
    [route?.orders, wzByOrderId],
  );

  const doneCount = stops.filter((s) => s.wz !== null).length;
  const allDone = stops.length > 0 && doneCount === stops.length;

  const stockItems = useMemo(
    () => (stockSnapshot?.items ?? []).filter((i) => parseFloat(i.quantity_available) > 0),
    [stockSnapshot],
  );

  // Split stock into loaded-by-this-route vs carry-over from previous routes
  const { thisRouteStock, carryOverStock } = useMemo(() => {
    const loadedIds = new Set((mmDoc?.items ?? []).map((i) => i.product_id));
    const thisRoute = stockItems.filter((i) => loadedIds.has(i.product_id));
    const carryOver = stockItems.filter((i) => !loadedIds.has(i.product_id));
    return { thisRouteStock: thisRoute, carryOverStock: carryOver };
  }, [stockItems, mmDoc]);

  const isClosed = route?.status === 'closed';
  const isPlanned = route?.status === 'planned';
  // Stops are locked until the van is loaded (MM must exist first).
  const stopsLocked = isPlanned;

  const canClose = allDone && !isClosed && !isPlanned;

  const handleCreateWz = useCallback(
    async (orderId: string) => {
      const doc = await generateWz.mutateAsync({ orderId, vanWarehouseId });
      navigate(`/delivery/${doc.id}`);
    },
    [generateWz, vanWarehouseId, navigate],
  );

  const handleStopNavigate = useCallback(
    (order: RouteOrder, wz: DeliveryDocument | null) => {
      if (wz) {
        navigate(`/delivery/${wz.id}`);
        return;
      }
      navigate(`/orders/${order.id}`, { state: { fromVanRoute: routeId, vanWarehouseId } });
    },
    [navigate, routeId, vanWarehouseId],
  );

  const handleAdditionalWzSubmit = useCallback(
    async (items: Array<{ product_id: string; quantity_planned: string }>) => {
      if (!vanWarehouseId) return;
      setAdditionalWzError(null);
      try {
        const doc = await createStandaloneWz.mutateAsync({
          from_warehouse_id: vanWarehouseId,
          items,
        });
        setShowAdditionalWz(false);
        navigate(`/delivery/${doc.id}`);
      } catch (e) {
        setAdditionalWzError(e instanceof Error ? e.message : 'Nie udało się utworzyć WZ');
      }
    },
    [vanWarehouseId, createStandaloneWz, navigate],
  );

  async function handleClose() {
    if (!routeId) return;
    try {
      if (route?.status === 'loading') {
        await confirmLoading.mutateAsync(routeId);
      }
      await closeRoute.mutateAsync(routeId);
      navigate(
        `/delivery/van-reconciliation?warehouse_id=${vanWarehouseId}&route_id=${routeId}`,
      );
    } catch (e) {
      console.error(e);
    }
  }

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (isError) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">Nie udało się załadować trasy.</p>
        <button type="button" onClick={() => navigate(-1)} className="text-sm text-primary underline">
          Wróć do list tras
        </button>
      </div>
    );
  }

  const isLoading = routeLoading || wzLoading;

  // Show additional WZ sheet
  if (showAdditionalWz) {
    return (
      <AdditionalWzSheet
        stockItems={stockItems}
        onSubmit={(items) => void handleAdditionalWzSubmit(items)}
        onClose={() => { setShowAdditionalWz(false); setAdditionalWzError(null); }}
        isPending={createStandaloneWz.isPending}
        error={additionalWzError}
      />
    );
  }

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Wróć"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
              <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[17px] font-semibold tracking-tight text-foreground">
                {route ? (route.van_name || route.van_warehouse_code) : 'Trasa Vana'}
              </h1>
              {route && (
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_COLOR[route.status])}>
                  {STATUS_LABEL[route.status]}
                </span>
              )}
            </div>
            {route && (
              <p className="text-[12px] text-muted-foreground">
                {formatDatePl(date)}
                {route.driver_name ? ` · ${route.driver_name}` : ''}
                {route.mm_document?.document_number ? ` · ${route.mm_document.document_number}` : ''}
              </p>
            )}
          </div>
          {!isLoading && stops.length > 0 && (
            <span className={cn('shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold', allDone ? 'bg-emerald-100 text-emerald-700' : 'bg-primary/10 text-primary')}>
              {doneCount}/{stops.length}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-4 px-4 pt-4 pb-[calc(76px+83px+env(safe-area-inset-bottom))] md:pb-[calc(76px+env(safe-area-inset-bottom))]">

        {/* MM doc link */}
        {route?.mm_document && (
          <button
            type="button"
            onClick={() => navigate(`/delivery/${route.mm_document!.id}`)}
            className="flex items-center gap-2 rounded-2xl bg-surface-card px-4 py-3 shadow-soft text-left transition-colors hover:bg-surface-low/40"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-semibold text-foreground">{route.mm_document.document_number}</span>
            <span className="text-xs text-muted-foreground">Dokument MM załadunku</span>
            <svg viewBox="0 0 24 24" fill="none" className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Van stock */}
        {vanWarehouseId && (
          <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 px-4 py-3 shadow-soft">
            <div className="mb-2 flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-primary" stroke="currentColor" strokeWidth={2}>
                <path d="M1 3h15v13H1zM16 8l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">Stan Vana</span>
              {stockLoading && (
                <span className="ml-auto h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
              )}
              {!isPlanned && !isClosed && stockItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAdditionalWz(true)}
                  className="ml-auto flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  WZ dodatkowe
                </button>
              )}
            </div>
            {!stockLoading && stockItems.length === 0 && (
              <p className="text-sm text-muted-foreground">Brak towaru w vanie</p>
            )}
            {/* This-route stock */}
            {thisRouteStock.length > 0 && (
              <div className="flex flex-col gap-1">
                {thisRouteStock.map((item) => (
                  <div key={item.product_id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-foreground">{item.product_name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {formatQty(item.quantity_available, item.unit)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Carry-over stock from previous routes */}
            {carryOverStock.length > 0 && (
              <div className={cn('mt-2 rounded-xl bg-amber-100/70 dark:bg-amber-900/20 px-3 py-2', thisRouteStock.length > 0 && 'mt-2')}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Z poprzedniej trasy
                </p>
                {carryOverStock.map((item) => (
                  <div key={item.product_id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-amber-800 dark:text-amber-300">{item.product_name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                      {formatQty(item.quantity_available, item.unit)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-10" role="status" aria-busy>
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            <span className="text-sm text-muted-foreground">Ładowanie…</span>
          </div>
        )}

        {/* Stops */}
        {!isLoading && (
          <div>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Przystanki ({stops.length})
            </h2>
            {isPlanned && (
              <p className="mb-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                Załaduj van, aby móc wystawiać dokumenty WZ dla przystanków.
              </p>
            )}
            {stops.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Brak zamówień w tej trasie</p>
            ) : (
              <div className="flex flex-col gap-2">
                {stops.map(({ order, wz }, i) => (
                  <StopCard
                    key={order.id}
                    index={i}
                    order={order}
                    wz={wz}
                    locked={stopsLocked}
                    vanWarehouseId={vanWarehouseId}
                    onCreateWz={handleCreateWz}
                    isCreatingWz={generateWz.isPending}
                    onNavigate={() => handleStopNavigate(order, wz)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fixed bottom bar */}
      {!isClosed && (
        <div className="fixed left-0 right-0 z-30 bottom-[83px] md:bottom-0 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
          {isPlanned ? (
            <button
              type="button"
              onClick={() => navigate(`/van-routes/${routeId}/load`)}
              className="w-full rounded-xl py-3 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Załaduj Van
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleClose()}
              disabled={!canClose || closeRoute.isPending}
              className={cn(
                'w-full rounded-xl py-3 text-base font-semibold transition-colors',
                canClose && !closeRoute.isPending
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              {closeRoute.isPending
                ? 'Zamykanie trasy…'
                : canClose
                  ? 'Rozlicz Van'
                  : `Dostarcz wszystkie przystanki (${doneCount}/${stops.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

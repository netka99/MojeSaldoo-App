import { useMemo, useState, useCallback, useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authStorage } from '@/services/api';
import { useVanRouteQuery, useConfirmLoadingMutation, useAddOrdersToRouteMutation, useRemoveOrdersFromRouteMutation } from '@/query/use-van-routes';
import {
  useVanRouteWZListQuery,
  useVanRouteAllDocsQuery,
  useDeliveryByOrdersQuery,
  useCreateStandaloneWzMutation,
  useDeliveryQuery,
  useGenerateDeliveryForOrderMutation,
  useAddReturnsMutation,
  useSaveDeliveryMutation,
  useStartDeliveryMutation,
  useCompleteDeliveryMutation,
} from '@/query/use-delivery';
import { useStockSnapshotQuery } from '@/query/use-products';
import { useOrderQuery } from '@/query/use-orders';
import { orderService } from '@/services/order.service';
import { customerService } from '@/services/customer.service';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { resolveCustomerIdFromSearch } from '@/lib/customer-picker-utils';
import { countPendingWzDocs } from '@/lib/van-wz-utils';
import type { DeliveryDocument, DeliveryItem, Order, RouteOrder, VanRoute, VanRouteStatus } from '@/types';
import type { Customer } from '@/types/customer.types';

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

/* ─── Add orders sheet ───────────────────────────────────────────── */

function AddOrdersSheet({
  routeId,
  date,
  existingOrderIds,
  onClose,
}: {
  routeId: string;
  date: string;
  existingOrderIds: Set<string>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const addOrders = useAddOrdersToRouteMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'add-to-route', date, companyId],
    queryFn: () =>
      orderService.fetchList({
        delivery_date: date,
        status: 'confirmed',
        exclude_routed: true,
        page_size: 100,
        page: 1,
      }),
    enabled: Boolean(date) && Boolean(companyId),
  });

  const available = useMemo(
    () => (data?.results ?? []).filter((o: Order) => !existingOrderIds.has(o.id)),
    [data, existingOrderIds],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setError(null);
    try {
      await addOrders.mutateAsync({ id: routeId, orderIds: [...selected] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się dodać zamówień');
    }
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3">
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
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Dodaj zamówienia</h1>
          <p className="text-[12px] text-muted-foreground">Potwierdzone na {date}</p>
        </div>
        {selected.size > 0 && (
          <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground">
            {selected.size} zam.
          </span>
        )}
      </div>

      {/* List */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
        {!isLoading && available.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Brak dostępnych zamówień na ten dzień
          </p>
        )}
        {available.map((order: Order) => {
          const sel = selected.has(order.id);
          return (
            <button
              key={order.id}
              type="button"
              onClick={() => toggle(order.id)}
              className={cn(
                'flex items-center gap-3 rounded-2xl px-4 py-3 text-left shadow-soft transition-colors',
                sel ? 'bg-primary/10 ring-2 ring-primary/30' : 'bg-surface-card',
              )}
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  sel ? 'border-primary bg-primary' : 'border-border bg-background',
                )}
              >
                {sel && (
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-primary-foreground" stroke="currentColor" strokeWidth={3}>
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{order.customer_name ?? '—'}</p>
                <p className="text-[12px] text-muted-foreground">
                  {order.order_number ?? '—'} · {order.items.length}{' '}
                  {order.items.length === 1 ? 'produkt' : order.items.length < 5 ? 'produkty' : 'produktów'}
                </p>
              </div>
            </button>
          );
        })}
        {error && (
          <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-border/40 bg-background/95 px-4 pb-[calc(12px+83px+env(safe-area-inset-bottom))] pt-3 md:pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={addOrders.isPending || selected.size === 0}
          className={cn(
            'w-full rounded-xl py-3 text-base font-semibold transition-colors',
            selected.size > 0 && !addOrders.isPending
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {addOrders.isPending
            ? 'Dodawanie…'
            : selected.size === 0
              ? 'Wybierz zamówienia'
              : `Dodaj ${selected.size} zamówień`}
        </button>
      </div>
    </div>
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

/* ─── Additional (standalone) WZ card ────────────────────────────── */

function AdditionalWzCard({
  wz,
  onNavigate,
}: {
  wz: DeliveryDocument;
  onNavigate: () => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [wzError, setWzError] = useState<string | null>(null);
  const saveDelivery = useSaveDeliveryMutation();
  const startDelivery = useStartDeliveryMutation();
  const completeDelivery = useCompleteDeliveryMutation();

  const label = wz.customer_name || wz.document_number || 'WZ dodatkowe';
  const itemSummary = (wz.items ?? [])
    .map((i) => `${i.product_name ?? '—'} × ${formatQty(i.quantity_planned)}`)
    .join(', ');

  async function handleComplete() {
    setWzError(null);
    setCompleting(true);
    try {
      if (wz.status === 'draft') await saveDelivery.mutateAsync({ id: wz.id });
      if (wz.status === 'draft' || wz.status === 'saved') {
        await startDelivery.mutateAsync(wz.id);
      }
      await completeDelivery.mutateAsync({ id: wz.id, data: {} });
    } catch (e) {
      setWzError(e instanceof Error ? e.message : 'Nie udało się zakończyć dostawy');
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="shadow-soft w-full overflow-hidden rounded-2xl border-l-4 border-l-amber-400 bg-surface-card">
      <div className="flex flex-col gap-2 p-3.5">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{label}</p>
          <p className="text-[12px] text-amber-600 font-medium">
            {wz.document_number ?? 'WZ'} · do potwierdzenia
          </p>
          {itemSummary && (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{itemSummary}</p>
          )}
        </div>
        {wzError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
            {wzError}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleComplete()}
            disabled={completing}
            className={cn(
              'flex-1 rounded-xl py-2 text-sm font-semibold transition-colors',
              !completing
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {completing ? 'Potwierdzanie…' : 'Potwierdź dostawę'}
          </button>
          <button
            type="button"
            onClick={onNavigate}
            className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Szczegóły
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Stop card ──────────────────────────────────────────────────── */

function StopCard({
  index,
  order,
  wz,
  locked,
  vanWarehouseId: _vanWarehouseId,
  routeId,
  onCreateWz,
  isCreatingWz,
  onNavigate,
}: {
  index: number;
  order: RouteOrder;
  wz: DeliveryDocument | null;
  locked: boolean;
  vanWarehouseId: string | undefined;
  routeId: string | undefined;
  onCreateWz: (orderId: string) => Promise<void>;
  isCreatingWz: boolean;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [wzError, setWzError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const startDelivery = useStartDeliveryMutation();
  const completeDelivery = useCompleteDeliveryMutation();
  const removeOrders = useRemoveOrdersFromRouteMutation();

  async function handleRemove() {
    if (!routeId) return;
    setRemoving(true);
    try {
      await removeOrders.mutateAsync({ id: routeId, orderIds: [order.id] });
    } finally {
      setRemoving(false);
    }
  }

  const { data: orderDetail, isLoading: orderLoading } = useOrderQuery(order.id, expanded);
  // Fetch full WZ detail when expanded so we have return_documents
  const { data: wzDetail } = useDeliveryQuery(wz?.id, expanded && wz !== null);

  const delivered = wz?.status === 'delivered';
  const wzIssued = wz !== null && !delivered; // WZ created but not yet completed
  const done = delivered;
  const zwDocs = wzDetail?.return_documents ?? [];

  async function handleCreateWz() {
    setWzError(null);
    try {
      await onCreateWz(order.id);
    } catch (e) {
      setWzError(e instanceof Error ? e.message : 'Nie udało się utworzyć WZ');
    }
  }

  async function handleCompleteWz() {
    if (!wz) return;
    setWzError(null);
    setCompleting(true);
    try {
      if (wz.status === 'saved') await startDelivery.mutateAsync(wz.id);
      await completeDelivery.mutateAsync({ id: wz.id, data: {} });
    } catch (e) {
      setWzError(e instanceof Error ? e.message : 'Nie udało się zakończyć dostawy');
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
    <div className={cn(
      'shadow-soft min-w-0 flex-1 overflow-hidden rounded-2xl bg-surface-card text-left transition-colors',
      done && 'border-l-4 border-l-emerald-400',
      wzIssued && 'border-l-4 border-l-amber-400',
    )}>
      {/* Main clickable row — navigates on click */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${order.customer_name}, ${done ? (wz!.document_number ?? 'WZ wystawiona') : order.order_number ?? 'brak WZ'}`}
        onClick={() => { if (!locked) onNavigate(); else setExpanded((v) => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!locked) onNavigate(); else setExpanded((v) => !v); } }}
        className="flex w-full cursor-pointer gap-3 p-3.5 transition-colors hover:bg-surface-low/40 active:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        {/* Index / check */}
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            done ? 'bg-emerald-100 text-emerald-700' : wzIssued ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary',
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
            ) : wzIssued ? (
              <span className="font-medium text-amber-600">{wz!.document_number ?? 'WZ wystawiona'} · do potwierdzenia</span>
            ) : locked ? (
              <span className="text-muted-foreground">
                {order.order_number ?? '—'} · {order.item_count}{' '}
                {order.item_count === 1 ? 'produkt' : order.item_count < 5 ? 'produkty' : 'produktów'}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {order.order_number ?? '—'} · {order.item_count}{' '}
                {order.item_count === 1 ? 'produkt' : order.item_count < 5 ? 'produkty' : 'produktów'}
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron — always visible */}
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
              {!done && !wzIssued && (
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
              {wzIssued && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleCompleteWz()}
                    disabled={completing}
                    className={cn(
                      'flex-1 rounded-xl py-2 text-sm font-semibold transition-colors',
                      !completing
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-muted text-muted-foreground cursor-not-allowed',
                    )}
                  >
                    {completing ? 'Potwierdzanie…' : 'Zakończ dostawę'}
                  </button>
                  <button
                    type="button"
                    onClick={onNavigate}
                    className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Edytuj
                  </button>
                </>
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
    {/* Trash button — outside card, only on planned routes */}
    {locked && (
      <button
        type="button"
        aria-label={`Usuń ${order.customer_name} z trasy`}
        disabled={removing}
        onClick={() => void handleRemove()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        {removing ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    )}
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
  onSubmit: (items: Array<{ product_id: string; quantity_planned: string }>, customerId: string | null) => void;
  onClose: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const [qtys, setQtys] = useState<Map<string, number>>(new Map());
  const [customerId, setCustomerId] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');

  const { data: customerData } = useQuery({
    queryKey: ['customers', 'list', companyId, customerSearch],
    queryFn: () => customerService.fetchList({ search: customerSearch || undefined, page_size: 50 }),
    enabled: Boolean(companyId),
  });
  const customers: Customer[] = customerData?.results ?? [];

  const activeItems = stockItems.filter((i) => (qtys.get(i.product_id) ?? 0) > 0);

  function updateQty(productId: string, qty: number) {
    setQtys((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, qty);
      return next;
    });
  }

  // Auto-select when search text matches exactly one customer name
  useEffect(() => {
    if (customerId) return;
    const resolved = resolveCustomerIdFromSearch('', customerSearch, customers);
    if (resolved) setCustomerId(resolved);
  }, [customerSearch, customers, customerId]);

  function handleSubmit() {
    const items = activeItems.map((i) => ({
      product_id: i.product_id,
      quantity_planned: (qtys.get(i.product_id) ?? 0).toFixed(3),
    }));
    const resolvedCustomerId = resolveCustomerIdFromSearch(customerId, customerSearch, customers);
    onSubmit(items, resolvedCustomerId);
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3">
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
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4">
        {/* Customer picker */}
        <div className="rounded-2xl bg-surface-card px-4 py-3 shadow-soft">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Klient (opcjonalnie)
          </label>
          <input
            type="text"
            placeholder="Szukaj klienta…"
            value={customerSearch}
            onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(''); }}
            className="mb-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          {customerId && (
            <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
              Wybrany klient: {customers.find((c) => c.id === customerId)?.name ?? customerSearch}
              <button
                type="button"
                onClick={() => { setCustomerId(''); setCustomerSearch(''); }}
                className="ml-2 text-xs font-medium text-muted-foreground underline"
              >
                zmień
              </button>
            </p>
          )}
          {!customerId && customers.length > 0 && (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCustomerId(c.id); setCustomerSearch(c.name); }}
                  className="rounded-xl px-3 py-3 text-left text-sm font-medium text-foreground hover:bg-muted transition-colors border border-border/40 shrink-0"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {!customerId && customerSearch && customers.length === 0 && (
            <p className="text-xs text-muted-foreground">Nie znaleziono klienta</p>
          )}
        </div>

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
      <div className="shrink-0 border-t border-border/40 bg-background/95 px-4 pb-[calc(12px+83px+env(safe-area-inset-bottom))] pt-3 md:pb-[calc(12px+env(safe-area-inset-bottom))]">
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

/* ─── Route document trail ───────────────────────────────────────── */

const DOC_TYPE_LABEL: Record<string, string> = {
  MM: 'MM',
  WZ: 'WZ',
  ZW: 'ZW',
  RW: 'RW',
  PZ: 'PZ',
};

const DOC_TYPE_COLOR: Record<string, string> = {
  MM: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  WZ: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  ZW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  RW: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  PZ: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

const DOC_STATUS_LABEL: Record<string, string> = {
  draft: 'szkic',
  saved: 'zapisano',
  in_transit: 'w drodze',
  delivered: 'dostarczono',
  cancelled: 'anulowano',
};

function RouteDocumentTrail({
  route,
  allDocs,
  extraWzDocs,
  onDocClick,
  onOrderClick,
}: {
  route: VanRoute;
  allDocs: DeliveryDocument[];
  extraWzDocs: DeliveryDocument[];
  onDocClick: (id: string) => void;
  onOrderClick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Split docs by type; exclude the loading MM (shown separately in route header)
  const loadingMmId = route.mm_document?.id;
  const mmReturn = allDocs.filter((d) => d.document_type === 'MM' && d.id !== loadingMmId);
  const rwDocs   = allDocs.filter((d) => d.document_type === 'RW');
  const zwDocs   = allDocs.filter((d) => d.document_type === 'ZW');

  // WZ: merge route-tagged + order-tagged, deduplicate by id
  const wzDocMap = new Map<string, DeliveryDocument>();
  for (const d of allDocs.filter((d) => d.document_type === 'WZ')) wzDocMap.set(d.id, d);
  for (const d of extraWzDocs) wzDocMap.set(d.id, d);
  const wzDocs = Array.from(wzDocMap.values()).sort((a, b) =>
    (a.document_number ?? '').localeCompare(b.document_number ?? '', 'pl'),
  );
  const orders   = route.orders ?? [];

  const carryOverItems = route.carry_over_items ?? [];

  const totalCount =
    (carryOverItems.length > 0 ? 1 : 0) +
    (route.mm_document ? 1 : 0) +
    orders.length +
    wzDocs.length +
    mmReturn.length +
    rwDocs.length +
    zwDocs.length;

  if (totalCount === 0) return null;

  function DocRow({ doc }: { doc: DeliveryDocument }) {
    const colorCls = DOC_TYPE_COLOR[doc.document_type] ?? 'bg-muted text-muted-foreground';
    return (
      <button
        type="button"
        onClick={() => onDocClick(doc.id)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', colorCls)}>
          {DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {doc.document_number ?? doc.id.slice(0, 8)}
          {doc.customer_name ? ` · ${doc.customer_name}` : ''}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {DOC_STATUS_LABEL[doc.status] ?? doc.status}
        </span>
      </button>
    );
  }

  function Section({ label, children }: { label: string; children: import('react').ReactNode }) {
    return (
      <div className="mb-1">
        <p className="mb-0.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface-card shadow-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Dokumenty trasy
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {totalCount}
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/40 pb-2 pt-1">
          {/* Carry-over from previous route */}
          {carryOverItems.length > 0 && (
            <Section label={`Stan otwarcia vana (z ${carryOverItems[0]!.from_route_number})`}>
              <div className="mx-3 mb-1 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                {carryOverItems.map((item) => (
                  <div key={item.product_id} className="flex items-baseline justify-between gap-2 py-0.5">
                    <span className="truncate text-sm text-amber-900 dark:text-amber-200">{item.product_name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {parseFloat(item.quantity) % 1 === 0 ? parseInt(item.quantity) : parseFloat(item.quantity).toFixed(2)} {item.unit}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Orders */}
          {orders.length > 0 && (
            <Section label="Zamówienia">
              {orders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onOrderClick(o.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    ZAM
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {o.order_number ?? o.id.slice(0, 8)}
                    {o.customer_name ? ` · ${o.customer_name}` : ''}
                  </span>
                </button>
              ))}
            </Section>
          )}

          {/* Loading MM */}
          {route.mm_document && (
            <Section label="Załadunek">
              <button
                type="button"
                onClick={() => onDocClick(route.mm_document!.id)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              >
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', DOC_TYPE_COLOR.MM)}>
                  MM
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {route.mm_document.document_number ?? route.mm_document.id.slice(0, 8)}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {DOC_STATUS_LABEL[route.mm_document.status] ?? route.mm_document.status}
                </span>
              </button>
            </Section>
          )}

          {/* WZ deliveries */}
          {wzDocs.length > 0 && (
            <Section label={`Dostawy (${wzDocs.length})`}>
              {wzDocs.map((d) => <DocRow key={d.id} doc={d} />)}
            </Section>
          )}

          {/* ZW customer returns */}
          {zwDocs.length > 0 && (
            <Section label="Zwroty od klientów">
              {zwDocs.map((d) => <DocRow key={d.id} doc={d} />)}
            </Section>
          )}

          {/* MM-P return to warehouse */}
          {mmReturn.length > 0 && (
            <Section label="Zwrot do magazynu">
              {mmReturn.map((d) => <DocRow key={d.id} doc={d} />)}
            </Section>
          )}

          {/* RW writeoff */}
          {rwDocs.length > 0 && (
            <Section label="Odpisy">
              {rwDocs.map((d) => <DocRow key={d.id} doc={d} />)}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */

export function VanRouteDashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { routeId } = useParams<{ routeId: string }>();

  const { data: route, isLoading: routeLoading, isError } = useVanRouteQuery(routeId);
  const confirmLoading = useConfirmLoadingMutation();
  const createStandaloneWz = useCreateStandaloneWzMutation();
  const generateWz = useGenerateDeliveryForOrderMutation();
  const startDeliveryPage = useStartDeliveryMutation();
  const completeDeliveryPage = useCompleteDeliveryMutation();

  const vanWarehouseId = route?.van_warehouse_id;
  const date = route?.date ?? '';

  /* ── WZ docs linked to this van route ── */
  const { data: vanWZDocs, isLoading: wzLoading } = useVanRouteWZListQuery(routeId);

  /* ── All documents linked to this van route (WZ + MM-P + RW) ── */
  const { data: allRouteDocs } = useVanRouteAllDocsQuery(routeId);

  /* ── WZ docs linked to the route's orders (fallback for WZ not tagged with van_route) ── */
  const routeOrderIds = useMemo(() => (route?.orders ?? []).map((o) => o.id), [route?.orders]);
  const { data: orderWZDocs } = useDeliveryByOrdersQuery(routeOrderIds, routeOrderIds.length > 0);

  /* ── Live van stock ── */
  const { data: stockSnapshot, isLoading: stockLoading } = useStockSnapshotQuery(vanWarehouseId);

  /* ── MM document items — what was loaded THIS route ── */
  const mmDocId = route?.mm_document?.id;
  const { data: mmDoc } = useDeliveryQuery(mmDocId);

  /* ── Additional WZ sheet state ── */
  const [showAdditionalWz, setShowAdditionalWz] = useState(false);
  const [additionalWzError, setAdditionalWzError] = useState<string | null>(null);
  const [showAddOrders, setShowAddOrders] = useState(false);

  /* ── Map order_id → WZ ──
     Merges two sources:
     1. Order-linked WZ docs (fallback — covers WZ created outside the van route context)
     2. Van-route-linked WZ docs (higher priority — these are the "official" ones)
  ── */
  const wzByOrderId = useMemo(() => {
    const m = new Map<string, DeliveryDocument>();
    // Fallback: WZ docs linked to orders (regardless of van_route FK)
    for (const wz of orderWZDocs ?? []) {
      if (wz.order_id && wz.document_type === 'WZ') m.set(wz.order_id, wz);
    }
    // Override: WZ docs explicitly linked to this van route
    for (const wz of vanWZDocs ?? []) {
      if (wz.order_id) m.set(wz.order_id, wz);
    }
    return m;
  }, [vanWZDocs, orderWZDocs]);

  const stops = useMemo(
    () => (route?.orders ?? []).map((o) => ({ order: o, wz: wzByOrderId.get(o.id) ?? null })),
    [route?.orders, wzByOrderId],
  );

  const doneCount = stops.filter((s) => s.wz?.status === 'delivered').length;
  const allStopsDone = stops.length === 0 || doneCount === stops.length;

  const pendingWzDocs = useMemo(
    () =>
      (vanWZDocs ?? []).filter(
        (wz) => wz.status !== 'delivered' && wz.status !== 'cancelled',
      ),
    [vanWZDocs],
  );
  const additionalWzPending = useMemo(
    () => pendingWzDocs.filter((wz) => !wz.order_id),
    [pendingWzDocs],
  );
  const additionalWzDelivered = useMemo(
    () =>
      (vanWZDocs ?? []).filter((wz) => !wz.order_id && wz.status === 'delivered'),
    [vanWZDocs],
  );
  const pendingWzCount = countPendingWzDocs(vanWZDocs);
  const allDone = allStopsDone && pendingWzCount === 0;

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

  const reconciliationSummary = isClosed ? route?.reconciliation_summary ?? null : null;
  const summaryReturned = reconciliationSummary?.items.filter((i) => i.action === 'returned') ?? [];
  const summaryKept = reconciliationSummary?.items.filter((i) => i.action === 'kept') ?? [];
  const summaryWrittenOff = reconciliationSummary?.items.filter((i) => i.action === 'written_off') ?? [];


  const handleCreateWz = useCallback(
    async (orderId: string) => {
      const doc = await generateWz.mutateAsync({ orderId, vanWarehouseId, vanRouteId: routeId });
      // Auto-complete: assume full delivery with planned quantities.
      // If this fails (e.g. stock issue), fall back to the detail page for manual completion.
      try {
        await startDeliveryPage.mutateAsync(doc.id);
        await completeDeliveryPage.mutateAsync({ id: doc.id, data: {} });
        // Stay on dashboard — stop will turn green after cache invalidation
      } catch {
        // Completion failed — navigate to WZ detail so driver can resolve manually
        navigate(`/delivery/${doc.id}`);
      }
    },
    [generateWz, vanWarehouseId, routeId, navigate, startDeliveryPage, completeDeliveryPage],
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
    async (items: Array<{ product_id: string; quantity_planned: string }>, customerId: string | null) => {
      if (!vanWarehouseId) return;
      setAdditionalWzError(null);
      try {
        await createStandaloneWz.mutateAsync({
          from_warehouse_id: vanWarehouseId,
          van_route_id: routeId,
          to_customer_id: customerId ?? undefined,
          items,
        });
        setShowAdditionalWz(false);
      } catch (e) {
        setAdditionalWzError(e instanceof Error ? e.message : 'Nie udało się utworzyć WZ');
      }
    },
    [vanWarehouseId, routeId, createStandaloneWz],
  );

  async function handleClose() {
    if (!routeId) return;
    try {
      if (route?.status === 'loading') {
        await confirmLoading.mutateAsync(routeId);
      }
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

  // Show add orders sheet (planned routes only)
  if (showAddOrders) {
    return (
      <AddOrdersSheet
        routeId={routeId!}
        date={date}
        existingOrderIds={new Set((route?.orders ?? []).map((o) => o.id))}
        onClose={() => setShowAddOrders(false)}
      />
    );
  }

  // Show additional WZ sheet
  if (showAdditionalWz) {
    return (
      <AdditionalWzSheet
        stockItems={stockItems}
        onSubmit={(items, customerId) => void handleAdditionalWzSubmit(items, customerId)}
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
                {route.route_number && <span className="font-semibold text-foreground">{route.route_number} · </span>}
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

        {/* Van stock — only shown on active routes; closed routes show reconciliation summary instead */}
        {vanWarehouseId && !isClosed && (
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

        {/* Reconciliation summary (closed routes only) */}
        {reconciliationSummary && (
          <div className="rounded-2xl bg-surface-card px-4 py-3 shadow-soft">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rozliczenie trasy
            </h2>
            {summaryReturned.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Zwrot do MG</p>
                {summaryReturned.map((item) => (
                  <div key={item.product_id} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.product_name}</span>
                    <span className="tabular-nums font-semibold text-foreground">{formatQty(parseFloat(item.quantity), item.unit)}</span>
                  </div>
                ))}
                {reconciliationSummary.mm_return_number && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{reconciliationSummary.mm_return_number}</p>
                )}
              </div>
            )}
            {summaryKept.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Zostaje w vanie</p>
                {summaryKept.map((item) => (
                  <div key={item.product_id} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.product_name}</span>
                    <span className="tabular-nums font-semibold text-foreground">{formatQty(parseFloat(item.quantity), item.unit)}</span>
                  </div>
                ))}
              </div>
            )}
            {summaryWrittenOff.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">Odpisano</p>
                {summaryWrittenOff.map((item) => (
                  <div key={item.product_id} className="flex justify-between text-sm">
                    <span className="text-foreground">{item.product_name}</span>
                    <span className="tabular-nums font-semibold text-destructive">{formatQty(parseFloat(item.quantity), item.unit)}</span>
                  </div>
                ))}
                {reconciliationSummary.rw_writeoff_number && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{reconciliationSummary.rw_writeoff_number}</p>
                )}
              </div>
            )}
            {summaryReturned.length === 0 && summaryKept.length === 0 && summaryWrittenOff.length === 0 && (
              <p className="text-sm text-muted-foreground">Brak towaru do rozliczenia.</p>
            )}
          </div>
        )}

        {/* Route document trail */}
        {route && (
          <RouteDocumentTrail
            route={route}
            allDocs={allRouteDocs ?? []}
            extraWzDocs={[...(vanWZDocs ?? []), ...(orderWZDocs ?? [])]}
            onDocClick={(id) => navigate(`/delivery/${id}`)}
            onOrderClick={(id) => navigate(`/orders/${id}`)}
          />
        )}

        {/* Open WZ blocking route close */}
        {!isLoading && pendingWzDocs.length > 0 && (
          <div className="rounded-2xl border border-amber-300/50 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Otwarte WZ na tej trasie ({pendingWzDocs.length})
            </p>
            <ul className="mt-2 space-y-1">
              {pendingWzDocs.map((wz) => (
                <li key={wz.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/delivery/${wz.id}`)}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {wz.document_number ?? wz.id.slice(0, 8)}
                    {wz.customer_name ? ` · ${wz.customer_name}` : ''}
                    {' '}
                    <span className="text-amber-700 dark:text-amber-400">— {wz.status === 'draft' ? 'szkic' : wz.status === 'saved' ? 'zapisane' : 'w drodze'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Delivered additional WZ */}
        {!isLoading && additionalWzDelivered.length > 0 && (
          <div>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              WZ dodatkowe — dostarczone ({additionalWzDelivered.length})
            </h2>
            <div className="flex flex-col gap-2">
              {additionalWzDelivered.map((wz) => (
                <button
                  key={wz.id}
                  type="button"
                  onClick={() => navigate(`/delivery/${wz.id}`)}
                  className="flex items-center gap-3 rounded-2xl border-l-4 border-l-emerald-400 bg-surface-card px-4 py-3 text-left shadow-soft transition-colors hover:bg-surface-low/40"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">
                      {wz.customer_name || 'WZ dodatkowe'}
                    </p>
                    <p className="text-[12px] text-emerald-600">
                      {wz.document_number ?? 'WZ'} · dostarczono
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pending additional WZ */}
        {!isLoading && additionalWzPending.length > 0 && (
          <div>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              WZ dodatkowe ({additionalWzPending.length})
            </h2>
            <div className="flex flex-col gap-2">
              {additionalWzPending.map((wz) => (
                <AdditionalWzCard
                  key={wz.id}
                  wz={wz}
                  onNavigate={() => navigate(`/delivery/${wz.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Stops */}
        {!isLoading && (
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Przystanki ({stops.length})
              </h2>
              {isPlanned && (
                <button
                  type="button"
                  onClick={() => setShowAddOrders(true)}
                  className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  Dodaj zamówienie
                </button>
              )}
            </div>
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
                    routeId={routeId}
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
      {(!isClosed || (isClosed && stockItems.length > 0)) && (
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
              disabled={!canClose && !isClosed}
              className={cn(
                'w-full rounded-xl py-3 text-base font-semibold transition-colors',
                (canClose || isClosed) && !confirmLoading.isPending
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              {confirmLoading.isPending
                ? 'Trwa potwierdzanie…'
                : (canClose || isClosed)
                  ? 'Rozlicz Van'
                  : !allStopsDone
                    ? `Dostarcz wszystkie przystanki (${doneCount}/${stops.length})`
                    : `Potwierdź WZ (${pendingWzCount}) przed rozliczeniem`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

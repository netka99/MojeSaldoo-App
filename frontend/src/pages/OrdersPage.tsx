import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { OrderDayDateNav } from '@/components/features/orders/OrderDayDateNav';

import { OrdersDaySummary } from '@/components/features/orders/OrdersDaySummary';
import { Button } from '@/components/ui/Button';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { formatOrderLineQuantityWithUnit } from '@/lib/order-utils';
import { cn } from '@/lib/utils';
import { useGenerateDeliveryForOrderMutation, useDeliveryByOrdersQuery } from '@/query/use-delivery';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useOrdersByDateQuery } from '@/query/use-orders';
import { authStorage } from '@/services/api';
import type { Customer, Order, OrderItem, DeliveryDocument } from '@/types';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstLetter(name: string): string {
  const t = name.trim();
  if (!t) return '#';
  return t.charAt(0).toUpperCase();
}

type FilterPill = 'all' | 'has_order' | 'confirmed' | 'no_order' | 'has_wz' | 'no_wz';

const PILLS: { key: FilterPill; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'has_order', label: 'Z zamówieniem' },
  { key: 'confirmed', label: 'Potwierdzone' },
  { key: 'no_order', label: 'Bez zamówienia' },
  { key: 'has_wz', label: 'Z WZ' },
  { key: 'no_wz', label: 'Bez WZ' },
];

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 380, damping: 28 } },
};
const listVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};


export function OrdersPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <OrdersPageContent />;
}

function OrdersPageContent() {
  const navigate = useNavigate();
  const canOrders = usePermission('can_manage_orders');
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get('date') ?? todayIso();

  const [search, setSearch] = useState('');
  const [pill, setPill] = useState<FilterPill>('all');

  const [wzSelectionMode, setWzSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const [wzProgress, setWzProgress] = useState<{ current: number; total: number } | null>(null);
  const [wzError, setWzError] = useState<string | null>(null);

  const deliveryEnabled = useModuleGuard('delivery');
  const generateWzM = useGenerateDeliveryForOrderMutation();

  const handleDateChange = useCallback(
    (d: string) => setSearchParams({ date: d }, { replace: true }),
    [setSearchParams],
  );

  // All active customers — base list (independent of date)
  const {
    data: customerData,
    isPending: customersPending,
    isError: customersError,
    refetch: customersRefetch,
  } = useAllActiveCustomersQuery(search);
  const customers = customerData?.results ?? [];

  // Orders for the selected date — overlay on the customer list
  const { data: orderData, isPending: ordersPending, refetch: ordersRefetch } = useOrdersByDateQuery(date);
  const orders = orderData?.results ?? [];

  const showLoading = customersPending || (ordersPending && orderData === undefined);

  // Index orders by customer id — supports multiple orders per customer per day
  const ordersByCustomerId = useMemo(() => {
    const map = new Map<string, Order[]>();
    orders.forEach((o) => {
      if (o.customer_id) {
        const list = map.get(o.customer_id) ?? [];
        list.push(o);
        map.set(o.customer_id, list);
      }
    });
    return map;
  }, [orders]);

  // Delivery docs for all orders on this date — one request for WZ badges
  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const { data: deliveryDocs = [] } = useDeliveryByOrdersQuery(orderIds, orderIds.length > 0);
  // Index WZ docs by order_id (all non-cancelled)
  const wzByOrderId = useMemo(() => {
    const map = new Map<string, DeliveryDocument[]>();
    for (const doc of deliveryDocs) {
      if (doc.document_type !== 'WZ' || doc.status === 'cancelled' || !doc.order_id) continue;
      const list = map.get(doc.order_id) ?? [];
      list.push(doc);
      map.set(doc.order_id, list);
    }
    return map;
  }, [deliveryDocs]);

  // Orders that already have an active WZ (draft/saved/in_transit) — no new WZ should be created
  const activeWzByOrderId = useMemo(() => {
    const map = new Map<string, DeliveryDocument[]>();
    for (const doc of deliveryDocs) {
      if (doc.document_type !== 'WZ' || !doc.order_id) continue;
      if (!['draft', 'saved', 'in_transit'].includes(doc.status)) continue;
      const list = map.get(doc.order_id) ?? [];
      list.push(doc);
      map.set(doc.order_id, list);
    }
    return map;
  }, [deliveryDocs]);

  // Index ZW docs by the order_id of their parent WZ
  const zwByOrderId = useMemo(() => {
    // Build wzId → orderId lookup from WZ docs
    const wzIdToOrderId = new Map<string, string>();
    for (const doc of deliveryDocs) {
      if (doc.document_type === 'WZ' && doc.order_id) wzIdToOrderId.set(doc.id, doc.order_id);
    }
    const map = new Map<string, DeliveryDocument[]>();
    for (const doc of deliveryDocs) {
      if (doc.document_type !== 'ZW' || doc.status === 'cancelled' || !doc.linked_wz_id) continue;
      const orderId = wzIdToOrderId.get(doc.linked_wz_id);
      if (!orderId) continue;
      const list = map.get(orderId) ?? [];
      list.push(doc);
      map.set(orderId, list);
    }
    return map;
  }, [deliveryDocs]);

  const confirmedOrders = useMemo(() => orders.filter((o) => o.status === 'confirmed'), [orders]);

  // WZ-eligible: confirmed orders that have no active (draft/saved/in_transit) WZ yet
  const wzEligibleOrders = useMemo(
    () => confirmedOrders.filter((o) => !activeWzByOrderId.has(o.id)),
    [confirmedOrders, activeWzByOrderId],
  );
  const wzEligibleIdSet = useMemo(() => new Set(wzEligibleOrders.map((o) => o.id)), [wzEligibleOrders]);

  // Merged + filtered customer list
  const filtered = useMemo(() => {
    let result = customers;
    if (pill === 'has_order') result = result.filter((c) => ordersByCustomerId.has(c.id));
    if (pill === 'no_order') result = result.filter((c) => !ordersByCustomerId.has(c.id));
    if (pill === 'confirmed') {
      result = result.filter((c) =>
        (ordersByCustomerId.get(c.id) ?? []).some((o) => o.status === 'confirmed'),
      );
    }
    if (pill === 'has_wz') {
      result = result.filter((c) =>
        (ordersByCustomerId.get(c.id) ?? []).some((o) => (wzByOrderId.get(o.id) ?? []).length > 0),
      );
    }
    if (pill === 'no_wz') {
      // Customers with at least one non-draft/non-cancelled order that has no WZ
      result = result.filter((c) =>
        (ordersByCustomerId.get(c.id) ?? []).some(
          (o) => o.status !== 'draft' && o.status !== 'cancelled' && (wzByOrderId.get(o.id) ?? []).length === 0,
        ),
      );
    }
    return result;
  }, [customers, pill, ordersByCustomerId, wzByOrderId]);

  const grouped = useMemo(() => {
    const sorted = [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }),
    );
    const groups: Record<string, Customer[]> = {};
    sorted.forEach((c) => {
      const letter = firstLetter(c.name);
      if (!groups[letter]) groups[letter] = [];
      groups[letter]!.push(c);
    });
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' }))
      .map((letter) => [letter, groups[letter]!] as const);
  }, [filtered]);

  // WZ selection — operates on orders, not customers
  const toggleSelect = useCallback(
    (id: string) => {
      if (!wzEligibleIdSet.has(id)) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [wzEligibleIdSet],
  );

  const onEnterWzSelection = useCallback(() => {
    setWzError(null);
    setWzSelectionMode(true);
    setSelectedIds(new Set(wzEligibleOrders.map((o) => o.id)));
  }, [wzEligibleOrders]);

  const onCancelWzSelection = useCallback(() => {
    setWzSelectionMode(false);
    setSelectedIds(new Set());
    setWzError(null);
    setWzProgress(null);
    setGeneratingIds(new Set());
  }, []);

  const onConfirmWzSelection = useCallback(async () => {
    setWzError(null);
    const idsToRun = [...selectedIds].filter((id) => wzEligibleIdSet.has(id));
    if (idsToRun.length === 0) return;

    setGeneratingIds(new Set(idsToRun));
    const errors: string[] = [];
    let successCount = 0;

    for (let i = 0; i < idsToRun.length; i += 1) {
      const id = idsToRun[i]!;
      setWzProgress({ current: i + 1, total: idsToRun.length });
      try {
        await generateWzM.mutateAsync({ orderId: id });
        successCount += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Nieznany błąd');
      }
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }

    setWzProgress(null);
    setGeneratingIds(new Set());

    if (successCount === idsToRun.length) {
      setWzSelectionMode(false);
      setSelectedIds(new Set());
      navigate('/delivery');
      return;
    }
    if (successCount > 0) {
      setWzError(`Wygenerowano ${successCount} z ${idsToRun.length} WZ. ${errors.join(' · ')}`.trim());
      return;
    }
    setWzError(errors.join(' · ') || 'Nie udało się wygenerować WZ');
  }, [selectedIds, wzEligibleIdSet, generateWzM, navigate]);

  const handleCardClick = useCallback(
    (customer: Customer) => {
      const customerOrders = ordersByCustomerId.get(customer.id) ?? [];
      // In WZ mode toggle all eligible orders for this customer
      if (wzSelectionMode && customerOrders.length > 0) {
        customerOrders.forEach((o) => { if (wzEligibleIdSet.has(o.id)) toggleSelect(o.id); });
        return;
      }
      // Single order → go directly to it; multiple or none → go to customer page
      if (customerOrders.length === 1) {
        navigate(`/orders/${customerOrders[0]!.id}`);
      } else if (customerOrders.length > 1) {
        navigate(`/customers/${customer.id}?date=${encodeURIComponent(date)}`);
      } else if (canOrders) {
        navigate(`/orders/new?date=${encodeURIComponent(date)}&customer_id=${customer.id}`);
      }
    },
    [wzSelectionMode, ordersByCustomerId, wzEligibleIdSet, toggleSelect, navigate, date],
  );

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-4',
        'pb-[calc(83px+11.5rem+env(safe-area-inset-bottom))] md:pb-[calc(10.5rem+env(safe-area-inset-bottom))]',
      )}
    >
      <OrderDayDateNav date={date} onChange={handleDateChange} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Wybierz sklep</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Wybierz lokalizację do sprzedaży</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          {deliveryEnabled && wzSelectionMode ? (
            <>
              {wzProgress && generatingIds.size > 0 ? (
                <span className="w-full text-right text-[11px] text-muted-foreground sm:w-auto" role="status" aria-live="polite">
                  WZ ({wzProgress.current}/{wzProgress.total})…
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full"
                disabled={generatingIds.size > 0}
                onClick={onCancelWzSelection}
              >
                Anuluj
              </Button>
              <Button
                type="button"
                size="sm"
                className="shrink-0 rounded-full"
                disabled={selectedIds.size === 0 || generatingIds.size > 0}
                loading={generatingIds.size > 0 && !wzProgress}
                onClick={() => void onConfirmWzSelection()}
              >
                Utwórz WZ ({selectedIds.size})
              </Button>
            </>
          ) : null}
          {deliveryEnabled && !wzSelectionMode ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={() => navigate('/van-routes')}
              >
                Trasy Vana
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full"
                disabled={wzEligibleOrders.length === 0}
                onClick={onEnterWzSelection}
              >
                Generuj WZ
              </Button>
            </>
          ) : null}
          {canOrders && (
            <Button
              type="button"
              size="sm"
              className="shrink-0 rounded-full"
              onClick={() => navigate(`/orders/new?date=${encodeURIComponent(date)}`)}
            >
              + Nowe zamówienie
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Szukaj sklepu…"
          aria-label="Szukaj sklepu po nazwie"
          className="shadow-soft h-11 w-full rounded-xl border-0 bg-surface-card pl-11 pr-4 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
      </div>

      {/* Pills */}
      <div className="-mx-1 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {PILLS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPill(p.key)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              pill === p.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-card text-foreground shadow-soft',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {wzError && (
        <div className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {wzError}
        </div>
      )}

      {customersError && (
        <div className="flex flex-col gap-3 rounded-2xl bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm text-destructive">Nie udało się załadować listy sklepów</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void customersRefetch(); void ordersRefetch(); }}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {showLoading && (
        <div className="flex flex-col items-center gap-3 py-10" aria-busy="true" role="status">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
          <span className="text-sm text-muted-foreground">Ładowanie…</span>
        </div>
      )}

      {!showLoading && !customersError && customers.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">Brak aktywnych sklepów.</p>
      )}

      {!showLoading && !customersError && customers.length > 0 && filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">Brak sklepów dla wybranego filtra.</p>
      )}

      {!showLoading && !customersError && grouped.length > 0 && (
        <motion.div
          className="space-y-5"
          variants={listVariants}
          initial="hidden"
          animate="show"
          key={`${date}-${pill}-${search}`}
        >
          {grouped.map(([letter, rows]) => (
            <section key={letter} aria-label={`Sklepy — ${letter}`}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {letter}
              </h2>
              <ul className="flex flex-col gap-2">
                {rows.map((customer) => {
                  const customerOrders = ordersByCustomerId.get(customer.id) ?? [];
                  const primaryOrder = customerOrders[0] ?? null;
                  const isSelected = customerOrders.some((o) => selectedIds.has(o.id));
                  const isGenerating = customerOrders.some((o) => generatingIds.has(o.id));
                  return (
                    <motion.li key={customer.id} variants={rowVariants}>
                      <CustomerShopRow
                        customer={customer}
                        orders={customerOrders}
                        primaryOrder={primaryOrder}
                        wzByOrderId={wzByOrderId}
                        zwByOrderId={zwByOrderId}
                        wzSelectionMode={wzSelectionMode}
                        wzEligibleIdSet={wzEligibleIdSet}
                        isSelected={isSelected}
                        isGenerating={isGenerating}
                        onSelect={primaryOrder ? () => customerOrders.forEach((o) => { if (wzEligibleIdSet.has(o.id)) toggleSelect(o.id); }) : undefined}
                        onClick={() => handleCardClick(customer)}
                      />
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          ))}
        </motion.div>
      )}

      <OrdersDaySummary orders={orders} />

    </div>
  );
}

/* ─── Shared item row ───────────────────────────────────────────── */

function ItemRow({ item }: { item: OrderItem }) {
  const unit = (item.product_unit || 'szt.').trim();
  return (
    <li
      className={cn(
        'min-w-0 py-1 text-sm flex flex-nowrap items-baseline gap-2',
        'sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_8rem] sm:gap-x-4',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-foreground">{item.product_name}</span>
      <div className="flex shrink-0 items-baseline justify-end gap-2 sm:contents">
        <span className="w-[4rem] shrink-0 text-right tabular-nums text-foreground sm:w-auto">
          {formatOrderLineQuantityWithUnit(item.quantity, unit)}
        </span>
        <span className="min-w-[4.875rem] shrink-0 text-right tabular-nums font-medium text-foreground sm:min-w-0">
          {formatMoneyGrossLocal(item.line_total_gross)}
        </span>
      </div>
    </li>
  );
}

/* ─── Multi-order product list with per-order groups + totals ───── */

function MultiOrderItemList({ orders }: { orders: Order[] }) {
  // Aggregate all items across orders by product_id for the totals row
  const totalsMap = new Map<string, { name: string; unit: string; qty: number; gross: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const existing = totalsMap.get(item.product_id);
      const qty = parseFloat(String(item.quantity)) || 0;
      const gross = parseFloat(String(item.line_total_gross)) || 0;
      if (existing) {
        existing.qty += qty;
        existing.gross += gross;
      } else {
        totalsMap.set(item.product_id, {
          name: item.product_name,
          unit: (item.product_unit || 'szt.').trim(),
          qty,
          gross,
        });
      }
    }
  }
  const totals = [...totalsMap.values()];
  const grandTotal = totals.reduce((s, t) => s + t.gross, 0);

  return (
    <div className="space-y-2">
      {orders.map((order, idx) => (
        <div key={order.id}>
          {/* Order header */}
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {order.order_number ?? `Zamówienie ${idx + 1}`}
          </p>
          <ul className="space-y-1">
            {order.items.map((item, i) => (
              <ItemRow key={item.id ?? `${item.product_id}-${i}`} item={item} />
            ))}
          </ul>
          {/* Divider between orders */}
          {idx < orders.length - 1 && (
            <div className="mt-2 border-t border-border/40" aria-hidden />
          )}
        </div>
      ))}

      {/* Aggregated totals row */}
      <div className="border-t border-border pt-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Łącznie
        </p>
        <ul className="space-y-1">
          {totals.map((t) => (
            <li
              key={t.name}
              className={cn(
                'min-w-0 py-0.5 text-sm flex flex-nowrap items-baseline gap-2',
                'sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_8rem] sm:gap-x-4',
              )}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{t.name}</span>
              <div className="flex shrink-0 items-baseline justify-end gap-2 sm:contents">
                <span className="w-[4rem] shrink-0 text-right tabular-nums text-foreground sm:w-auto">
                  {Number.isInteger(t.qty) ? t.qty : t.qty.toFixed(2)} {t.unit}
                </span>
                <span className="min-w-[4.875rem] shrink-0 text-right tabular-nums font-semibold text-foreground sm:min-w-0">
                  {formatMoneyGrossLocal(t.gross)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex justify-between border-t border-border/60 pt-1.5 text-[13px]">
          <span className="font-semibold text-foreground">Suma</span>
          <span className="tabular-nums font-bold text-foreground">{formatMoneyGrossLocal(grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Customer row card ─────────────────────────────────────────── */

import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { orderStatusBadgeClassName } from '@/lib/order-utils';

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 21V8l8-4 8 4v13M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CustomerShopRow({
  customer,
  orders,
  primaryOrder,
  wzByOrderId,
  zwByOrderId,
  wzSelectionMode,
  wzEligibleIdSet,
  isSelected,
  isGenerating,
  onSelect,
  onClick,
}: CustomerShopRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasOrder = orders.length > 0;
  const multipleOrders = orders.length > 1;
  const items = primaryOrder?.items ?? [];
  const isCompany = Boolean(customer.company_name?.trim() || customer.nip?.trim());
  const selectable = wzSelectionMode && hasOrder && orders.some((o) => wzEligibleIdSet.has(o.id));

  // WZ + ZW badge data
  const wzBadges = useMemo(() => {
    if (!hasOrder) return null;
    if (!multipleOrders && primaryOrder) {
      const wzDocs = wzByOrderId.get(primaryOrder.id) ?? [];
      const zwDocs = zwByOrderId.get(primaryOrder.id) ?? [];
      const showMissing = wzDocs.length === 0 && primaryOrder.status !== 'draft' && primaryOrder.status !== 'cancelled';
      return { type: 'single' as const, wzDocs, zwDocs, showMissing };
    }
    // Multiple orders — aggregate
    let totalWz = 0;
    let totalZw = 0;
    let missingWz = 0;
    for (const o of orders) {
      const wzDocs = wzByOrderId.get(o.id) ?? [];
      const zwDocs = zwByOrderId.get(o.id) ?? [];
      if (wzDocs.length > 0) totalWz += wzDocs.length;
      else if (o.status !== 'draft' && o.status !== 'cancelled') missingWz += 1;
      totalZw += zwDocs.length;
    }
    return { type: 'multi' as const, totalWz, totalZw, missingWz };
  }, [hasOrder, multipleOrders, primaryOrder, orders, wzByOrderId, zwByOrderId]);

  const toggleExpand = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (items.length > 0) setExpanded((v) => !v);
  };

  return (
    <div
      className={cn(
        'shadow-soft w-full overflow-hidden rounded-2xl bg-surface-card text-left transition-colors',
        hasOrder && 'border-l-4 border-solid',
        hasOrder && orderStatusLeftBorderClass(primaryOrder!.status),
      )}
    >
      {/* Main clickable row */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${customer.name}${hasOrder ? `, ${orders.length === 1 ? `zamówienie ${primaryOrder!.order_number}` : `${orders.length} zamówienia`}` : ', brak zamówienia'}`}
        className="flex w-full cursor-pointer gap-3 p-3.5 transition-colors hover:bg-surface-low/40 active:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      >
        {/* Icon */}
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            isCompany ? 'bg-primary/10 text-primary' : 'bg-surface-low text-on-surface-variant',
          )}
          aria-hidden
        >
          <BuildingIcon className="h-5 w-5" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{customer.name}</p>
            {hasOrder && !multipleOrders && (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', orderStatusBadgeClassName(primaryOrder!.status))}>
                {ORDER_STATUS_LABELS_PL[primaryOrder!.status]}
              </span>
            )}
            {multipleOrders && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {orders.length} zamówienia
              </span>
            )}
          </div>

          {/* WZ badges */}
          {wzBadges && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {wzBadges.type === 'single' && (
                <>
                  {wzBadges.showMissing && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      Brak WZ
                    </span>
                  )}
                  {wzBadges.wzDocs.map((wz) => (
                    <span key={wz.id} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {wz.document_number ?? 'WZ'}
                    </span>
                  ))}
                  {wzBadges.zwDocs.map((zw) => (
                    <span key={zw.id} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {zw.document_number ?? 'ZW'}
                    </span>
                  ))}
                </>
              )}
              {wzBadges.type === 'multi' && (
                <>
                  {wzBadges.missingWz > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {wzBadges.missingWz} bez WZ
                    </span>
                  )}
                  {wzBadges.totalWz > 0 && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {wzBadges.totalWz} WZ
                    </span>
                  )}
                  {wzBadges.totalZw > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {wzBadges.totalZw} ZW
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {customer.city?.trim() && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{customer.city}</p>
          )}

          {hasOrder && (
            <div className="mt-2 flex items-center gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dziś</p>
                <p className="text-[15px] font-semibold tabular-nums text-foreground">
                  {formatMoneyGrossLocal(
                    multipleOrders
                      ? orders.reduce((sum, o) => sum + (parseFloat(String(o.total_gross)) || 0), 0)
                      : primaryOrder!.total_gross,
                  )}
                </p>
              </div>
              <div className="h-8 w-px bg-border" aria-hidden />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {multipleOrders ? 'Zamówienia' : 'Pozycje'}
                </p>
                <p className="text-[15px] font-semibold tabular-nums text-foreground">
                  {multipleOrders ? orders.length : items.length}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right: checkbox / spinner / expand toggle */}
        <div className="flex shrink-0 items-start gap-1 pt-0.5">
          {selectable ? (
            <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded border-input text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                checked={isSelected}
                aria-checked={isSelected}
                aria-label={`Zaznacz zamówienie ${primaryOrder?.order_number ?? ''}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); onSelect?.(); }}
              />
            </span>
          ) : isGenerating ? (
            <span
              className="mt-1 inline-flex h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              role="status"
              aria-label="Generowanie WZ…"
            />
          ) : orders.some((o) => o.items.length > 0) ? (
            <button
              type="button"
              aria-label={expanded ? 'Zwiń produkty' : 'Rozwiń produkty'}
              aria-expanded={expanded}
              onClick={toggleExpand}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(e); }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <svg
                className={cn('h-5 w-5 transition-transform duration-200', expanded && 'rotate-180')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Expandable product list */}
      <div
        className={cn(
          'overflow-hidden transition-[max-height] duration-300 ease-in-out',
          expanded ? 'max-h-[48rem]' : 'max-h-0',
        )}
        aria-hidden={!expanded}
      >
        <div className="border-t border-border/40 pb-3 pt-2 pl-2 pr-2 min-[425px]:pl-5 sm:px-3.5">
          <div className="flex gap-2 min-[425px]:gap-3 sm:gap-3">
            <div className="hidden w-11 shrink-0 self-stretch sm:block" aria-hidden />
            <div className="min-w-0 flex-1">
              {multipleOrders ? (
                <MultiOrderItemList orders={orders} />
              ) : (
                <ul className="space-y-1">
                  {items.map((item, i) => (
                    <ItemRow key={item.id ?? `${item.product_id}-${i}`} item={item} />
                  ))}
                </ul>
              )}
            </div>
            <div className="hidden w-11 shrink-0 self-stretch sm:block" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}

interface CustomerShopRowProps {
  customer: Customer;
  orders: Order[];
  primaryOrder: Order | null;
  wzByOrderId: Map<string, DeliveryDocument[]>;
  zwByOrderId: Map<string, DeliveryDocument[]>;
  wzSelectionMode: boolean;
  wzEligibleIdSet: Set<string>;
  isSelected: boolean;
  isGenerating: boolean;
  onSelect?: () => void;
  onClick: () => void;
}

function orderStatusLeftBorderClass(status: Order['status']): string {
  switch (status) {
    case 'confirmed':
    case 'delivered': return 'border-l-emerald-500';
    case 'draft': return 'border-l-amber-500';
    case 'in_preparation':
    case 'loaded':
    case 'in_delivery': return 'border-l-amber-500';
    case 'invoiced': return 'border-l-violet-500';
    case 'cancelled': return 'border-l-red-500';
    default: return 'border-l-muted-foreground/35';
  }
}

const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
function formatMoneyGrossLocal(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(n) ? plnFmt.format(n) : '—';
}

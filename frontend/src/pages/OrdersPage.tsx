import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { OrderDayDateNav } from '@/components/features/orders/OrderDayDateNav';

import { OrdersDaySummary } from '@/components/features/orders/OrdersDaySummary';
import { Button } from '@/components/ui/Button';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { cn } from '@/lib/utils';
import { useGenerateDeliveryForOrderMutation } from '@/query/use-delivery';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useOrdersByDateQuery } from '@/query/use-orders';
import { authStorage } from '@/services/api';
import type { Customer, Order } from '@/types';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstLetter(name: string): string {
  const t = name.trim();
  if (!t) return '#';
  return t.charAt(0).toUpperCase();
}

type FilterPill = 'all' | 'has_order' | 'confirmed' | 'no_order';

const PILLS: { key: FilterPill; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'has_order', label: 'Z zamówieniem' },
  { key: 'confirmed', label: 'Potwierdzone' },
  { key: 'no_order', label: 'Bez zamówienia' },
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

  // Index orders by customer id for O(1) lookup
  const orderByCustomerId = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach((o) => {
      if (o.customer_id) map.set(o.customer_id, o);
    });
    return map;
  }, [orders]);

  const confirmedOrders = useMemo(() => orders.filter((o) => o.status === 'confirmed'), [orders]);
  const confirmedCount = confirmedOrders.length;
  const confirmedIdSet = useMemo(() => new Set(confirmedOrders.map((o) => o.id)), [confirmedOrders]);

  // Merged + filtered customer list
  const filtered = useMemo(() => {
    let result = customers;
    if (pill === 'has_order') result = result.filter((c) => orderByCustomerId.has(c.id));
    if (pill === 'no_order') result = result.filter((c) => !orderByCustomerId.has(c.id));
    if (pill === 'confirmed') {
      result = result.filter((c) => {
        const o = orderByCustomerId.get(c.id);
        return o?.status === 'confirmed';
      });
    }
    return result;
  }, [customers, pill, orderByCustomerId]);

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
      if (!confirmedIdSet.has(id)) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [confirmedIdSet],
  );

  const onEnterWzSelection = useCallback(() => {
    setWzError(null);
    setWzSelectionMode(true);
    setSelectedIds(new Set(confirmedOrders.map((o) => o.id)));
  }, [confirmedOrders]);

  const onCancelWzSelection = useCallback(() => {
    setWzSelectionMode(false);
    setSelectedIds(new Set());
    setWzError(null);
    setWzProgress(null);
    setGeneratingIds(new Set());
  }, []);

  const onConfirmWzSelection = useCallback(async () => {
    setWzError(null);
    const idsToRun = [...selectedIds].filter((id) => confirmedIdSet.has(id));
    if (idsToRun.length === 0) return;

    setGeneratingIds(new Set(idsToRun));
    const errors: string[] = [];
    let successCount = 0;

    for (let i = 0; i < idsToRun.length; i += 1) {
      const id = idsToRun[i]!;
      setWzProgress({ current: i + 1, total: idsToRun.length });
      try {
        await generateWzM.mutateAsync(id);
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
  }, [selectedIds, confirmedIdSet, generateWzM, navigate]);

  const handleCardClick = useCallback(
    (customer: Customer) => {
      const order = orderByCustomerId.get(customer.id) ?? null;
      if (wzSelectionMode && order) {
        toggleSelect(order.id);
        return;
      }
      if (order) {
        navigate(`/orders/${order.id}`);
      } else {
        navigate(`/orders/new?date=${encodeURIComponent(date)}&customer_id=${customer.id}`);
      }
    },
    [wzSelectionMode, orderByCustomerId, toggleSelect, navigate, date],
  );

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col gap-4 p-4',
        'pb-[calc(83px+7rem+env(safe-area-inset-bottom))] md:pb-[calc(7rem+env(safe-area-inset-bottom))]',
      )}
    >
      <OrderDayDateNav date={date} onChange={handleDateChange} />

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Wybierz sklep</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Wybierz lokalizację do sprzedaży</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => navigate(`/orders/new?date=${encodeURIComponent(date)}`)}
        >
          + Nowe zamówienie
        </Button>
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
                  const order = orderByCustomerId.get(customer.id) ?? null;
                  return (
                    <motion.li key={customer.id} variants={rowVariants}>
                      <CustomerShopRow
                        customer={customer}
                        order={order}
                        wzSelectionMode={wzSelectionMode}
                        isSelected={order ? selectedIds.has(order.id) : false}
                        isGenerating={order ? generatingIds.has(order.id) : false}
                        onSelect={order ? () => toggleSelect(order.id) : undefined}
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

      <OrdersDaySummary
        orders={orders}
        deliveryEnabled={deliveryEnabled}
        wzSelectionMode={wzSelectionMode}
        selectedIds={[...selectedIds]}
        selectedCount={selectedIds.size}
        confirmedCount={confirmedCount}
        onConfirmWzSelection={() => void onConfirmWzSelection()}
        onCancelWzSelection={onCancelWzSelection}
        generateWzPending={generatingIds.size > 0}
        wzProgress={wzProgress}
        onGenerateWz={onEnterWzSelection}
        onLoadVan={() => navigate('/delivery/van-loading')}
      />

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
  order,
  wzSelectionMode,
  isSelected,
  isGenerating,
  onSelect,
  onClick,
}: CustomerShopRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasOrder = order !== null;
  const items = order?.items ?? [];
  const isCompany = Boolean(customer.company_name?.trim() || customer.nip?.trim());
  const selectable = wzSelectionMode && hasOrder && order?.status === 'confirmed';

  const toggleExpand = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (items.length > 0) setExpanded((v) => !v);
  };

  return (
    <div
      className={cn(
        'shadow-soft w-full overflow-hidden rounded-2xl bg-surface-card text-left transition-colors',
        hasOrder && 'border-l-4 border-solid',
        hasOrder && orderStatusLeftBorderClass(order!.status),
      )}
    >
      {/* Main clickable row */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${customer.name}${hasOrder ? `, zamówienie ${order!.order_number}` : ', brak zamówienia'}`}
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
            {hasOrder && (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', orderStatusBadgeClassName(order!.status))}>
                {ORDER_STATUS_LABELS_PL[order!.status]}
              </span>
            )}
          </div>

          {customer.city?.trim() && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{customer.city}</p>
          )}

          {hasOrder && (
            <div className="mt-2 flex items-center gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dziś</p>
                <p className="text-[15px] font-semibold tabular-nums text-foreground">
                  {formatMoneyGrossLocal(order!.total_gross)}
                </p>
              </div>
              <div className="h-8 w-px bg-border" aria-hidden />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pozycje</p>
                <p className="text-[15px] font-semibold tabular-nums text-foreground">
                  {items.length}
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
                aria-label={`Zaznacz zamówienie ${order!.order_number}`}
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
          ) : items.length > 0 ? (
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
          expanded ? 'max-h-[32rem]' : 'max-h-0',
        )}
        aria-hidden={!expanded}
      >
        <div className="border-t border-border/40 px-3.5 pb-3 pt-2">
          <ul className="space-y-1">
            {items.map((item, i) => {
              const qty = parseFloat(String(item.quantity)) || 0;
              const unit = (item.product_unit || 'szt.').trim();
              const qtyStr = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
              return (
                <li key={item.id ?? `${item.product_id}-${i}`} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {item.product_name}
                    <span className="ml-1.5 text-muted-foreground">{qtyStr} {unit}</span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">
                    {formatMoneyGrossLocal(item.line_total_gross)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface CustomerShopRowProps {
  customer: Customer;
  order: Order | null;
  wzSelectionMode: boolean;
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

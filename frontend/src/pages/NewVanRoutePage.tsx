import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authStorage } from '@/services/api';
import { warehouseService } from '@/services/warehouse.service';
import { orderService } from '@/services/order.service';
import { useCreateVanRouteMutation } from '@/query/use-van-routes';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { Order, OrderItem, Warehouse } from '@/types';

/* ─── Helpers ────────────────────────────────────────────────────── */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatQty(qty: string | number): string {
  const n = typeof qty === 'string' ? parseFloat(qty) : qty;
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '0';
}

/* ─── Shop card (one per order) ─────────────────────────────────── */

function ShopCard({
  order,
  selected,
  onToggle,
}: {
  order: Order;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'rounded-2xl bg-surface-card shadow-soft transition-all',
        selected && 'ring-2 ring-primary/40',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-transparent text-transparent',
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={3}>
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Name */}
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <p className="truncate font-semibold text-foreground">{order.customer_name}</p>
          <p className="text-[12px] text-muted-foreground">
            {order.order_number ?? '—'} · {order.items.length}{' '}
            {order.items.length === 1 ? 'produkt' : order.items.length < 5 ? 'produkty' : 'produktów'}
          </p>
        </button>

        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Expanded order lines */}
      {expanded && (
        <div className="border-t border-border/40 px-4 pb-3 pt-2">
          <div className="flex flex-col gap-1">
            {order.items.map((item: OrderItem) => (
              <div key={item.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{item.product_name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatQty(item.quantity)} {item.product_unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */

export function NewVanRoutePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  const createRoute = useCreateVanRouteMutation();

  /* ── Form state ── */
  const [date, setDate] = useState(todayIso());
  const [driverName, setDriverName] = useState('');
  const [vanName, setVanName] = useState('');
  const [vanWarehouseId, setVanWarehouseId] = useState('');
  const [mainWarehouseId, setMainWarehouseId] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── Warehouses ── */
  const { data: mobileWHData } = useQuery({
    queryKey: ['warehouses', 'mobile', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'mobile', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mobileWarehouses: Warehouse[] = mobileWHData?.results ?? [];

  const { data: mainWHData } = useQuery({
    queryKey: ['warehouses', 'main', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'main', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mainWarehouses: Warehouse[] = mainWHData?.results ?? [];

  // Auto-select first warehouses
  if (mobileWarehouses.length > 0 && !vanWarehouseId) setVanWarehouseId(mobileWarehouses[0]!.id);
  if (mainWarehouses.length > 0 && !mainWarehouseId) setMainWarehouseId(mainWarehouses[0]!.id);

  /* ── Orders for date (exclude already routed) ── */
  const { data: orderData, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders', 'new-route', date, companyId],
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
  const availableOrders: Order[] = useMemo(
    () => orderData?.results ?? [],
    [orderData],
  );

  /* ── Selection helpers ── */
  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedOrderIds.size === availableOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(availableOrders.map((o) => o.id)));
    }
  }

  /* ── Aggregated product summary ── */
  const productSummary = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; qty: number }>();
    for (const order of availableOrders) {
      if (!selectedOrderIds.has(order.id)) continue;
      for (const item of order.items) {
        const existing = map.get(item.product_id);
        const qty = parseFloat(String(item.quantity)) || 0;
        if (existing) {
          existing.qty += qty;
        } else {
          map.set(item.product_id, { name: item.product_name, unit: item.product_unit, qty });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }, [availableOrders, selectedOrderIds]);

  /* ── Submit ── */
  async function onSubmit() {
    setSubmitError(null);
    if (!vanWarehouseId) { setSubmitError('Wybierz van'); return; }
    if (!mainWarehouseId) { setSubmitError('Wybierz magazyn główny'); return; }
    if (selectedOrderIds.size === 0) { setSubmitError('Wybierz co najmniej jeden przystanek'); return; }

    try {
      const route = await createRoute.mutateAsync({
        date,
        driver_name: driverName,
        van_name: vanName,
        van_warehouse_id: vanWarehouseId,
        main_warehouse_id: mainWarehouseId,
        order_ids: [...selectedOrderIds],
      });
      navigate(`/van-routes/${route.id}/load`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się utworzyć trasy');
    }
  }

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const allSelected = availableOrders.length > 0 && selectedOrderIds.size === availableOrders.length;

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
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
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Nowa trasa</h1>
      </div>

      <div className="flex flex-col gap-5 px-4 pt-4 pb-[calc(76px+83px+env(safe-area-inset-bottom))] md:pb-[calc(76px+env(safe-area-inset-bottom))]">

        {/* ── Route details ── */}
        <div className="rounded-2xl bg-surface-card p-4 shadow-soft flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Data trasy
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedOrderIds(new Set()); }}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Kierowca
              </label>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Imię i nazwisko"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nr rejestracyjny
              </label>
              <input
                type="text"
                value={vanName}
                onChange={(e) => setVanName(e.target.value)}
                placeholder="np. BIA 12345"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Van (magazyn)
              </label>
              <select
                value={vanWarehouseId}
                onChange={(e) => setVanWarehouseId(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">— wybierz —</option>
                {mobileWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Magazyn główny
              </label>
              <select
                value={mainWarehouseId}
                onChange={(e) => setMainWarehouseId(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">— wybierz —</option>
                {mainWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Shop / order list ── */}
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Przystanki na {date}
            </h2>
            {availableOrders.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-semibold text-primary"
              >
                {allSelected ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
              </button>
            )}
          </div>

          {ordersLoading && (
            <div className="flex items-center justify-center py-10" role="status">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            </div>
          )}

          {!ordersLoading && availableOrders.length === 0 && (
            <p className="rounded-2xl bg-surface-card px-4 py-6 text-center text-sm text-muted-foreground shadow-soft">
              Brak dostępnych zamówień na wybrany dzień
            </p>
          )}

          <div className="flex flex-col gap-2">
            {availableOrders.map((order) => (
              <ShopCard
                key={order.id}
                order={order}
                selected={selectedOrderIds.has(order.id)}
                onToggle={() => toggleOrder(order.id)}
              />
            ))}
          </div>
        </div>

        {/* ── Product summary ── */}
        {productSummary.length > 0 && (
          <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 p-4 shadow-soft">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
              Podsumowanie załadunku ({selectedOrderIds.size}{' '}
              {selectedOrderIds.size === 1 ? 'przystanek' : 'przystanków'})
            </h2>
            <div className="flex flex-col gap-1.5">
              {productSummary.map((p) => (
                <div key={p.name} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-foreground">{p.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {Number.isInteger(p.qty) ? p.qty : p.qty.toFixed(2)} {p.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {submitError && (
          <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed left-0 right-0 z-30 bottom-[83px] md:bottom-0 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={createRoute.isPending || selectedOrderIds.size === 0}
          className={cn(
            'w-full rounded-xl py-3 text-base font-semibold transition-colors',
            selectedOrderIds.size > 0 && !createRoute.isPending
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {createRoute.isPending
            ? 'Tworzenie trasy…'
            : selectedOrderIds.size === 0
              ? 'Zaplanuj trasę'
              : `Zaplanuj trasę (${selectedOrderIds.size} przystanków)`}
        </button>
      </div>
    </div>
  );
}

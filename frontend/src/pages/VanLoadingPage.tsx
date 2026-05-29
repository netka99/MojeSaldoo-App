import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { authStorage } from '@/services/api';
import { productService } from '@/services/product.service';
import { warehouseService } from '@/services/warehouse.service';
import { useVanLoadingMutation } from '@/query/use-delivery';
import { useStockSnapshotQuery } from '@/query/use-products';
import { useOrdersByDateQuery } from '@/query/use-orders';
import { cn } from '@/lib/utils';
import type { Product, Warehouse, VanLoadingPayload } from '@/types';

/* ─── Types ─────────────────────────────────────────────────────── */

type FilterPill = 'all' | 'ordered';

interface ProductRow {
  product: Product;
  quantity: number;
  fromOrder: boolean;
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDatePl(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function productInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h]!;
}

function formatPrice(price: string | number): string {
  const n = typeof price === 'string' ? parseFloat(price) : price;
  if (!Number.isFinite(n)) return '';
  return `${n.toFixed(2).replace('.', ',')} zł`;
}

function formatStock(qty: number, unit: string): string {
  const q = Number.isInteger(qty) ? qty : qty.toFixed(2);
  return `Stan: ${q} ${unit || 'szt.'}`;
}

/* ─── Main page ──────────────────────────────────────────────────── */

export function VanLoadingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  const dateParam = searchParams.get('date');
  const date = dateParam ?? todayIso();
  const fromOrders = Boolean(dateParam);

  const vanLoading = useVanLoadingMutation();

  /* ── State ── */
  const [search, setSearch] = useState('');
  const [pill, setPill] = useState<FilterPill>(fromOrders ? 'ordered' : 'all');
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── Warehouses ── */
  const { data: mainWHData, isLoading: mainWHLoading } = useQuery({
    queryKey: ['warehouses', 'main', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'main', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mainWarehouses: Warehouse[] = mainWHData?.results ?? [];

  const { data: mobileWHData, isLoading: mobileWHLoading } = useQuery({
    queryKey: ['warehouses', 'mobile', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'mobile', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mobileWarehouses: Warehouse[] = mobileWHData?.results ?? [];

  // Auto-select first main warehouse
  useEffect(() => {
    if (mainWarehouses.length > 0 && !fromWarehouseId) {
      setFromWarehouseId(mainWarehouses[0]!.id);
    }
  }, [mainWarehouses, fromWarehouseId]);

  // Auto-select first mobile warehouse
  useEffect(() => {
    if (mobileWarehouses.length > 0 && !toWarehouseId) {
      setToWarehouseId(mobileWarehouses[0]!.id);
    }
  }, [mobileWarehouses, toWarehouseId]);

  /* ── Orders ── */
  const { data: orderData, isPending: ordersLoading } = useOrdersByDateQuery(date);
  const orders = orderData?.results ?? [];

  // Aggregate products from orders (sum quantity by product_id)
  const orderAggregation = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of orders) {
      for (const item of order.items) {
        const qty = parseFloat(String(item.quantity)) || 0;
        map.set(item.product_id, (map.get(item.product_id) ?? 0) + qty);
      }
    }
    return map;
  }, [orders]);

  /* ── Products ── */
  const { data: productData, isLoading: productsLoading } = useQuery({
    queryKey: ['products', 'van-loading', companyId],
    queryFn: () =>
      productService.fetchList({ page: 1, is_active: true, ordering: 'name', page_size: 200 }),
    enabled: Boolean(companyId),
  });

  /* ── Stock snapshot for from_warehouse ── */
  const { data: stockSnapshot } = useStockSnapshotQuery(fromWarehouseId || undefined);
  const stockByProductId = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of stockSnapshot?.items ?? []) {
      m.set(item.product_id, parseFloat(item.quantity_available) || 0);
    }
    return m;
  }, [stockSnapshot]);

  /* ── Build rows from products + order aggregation ── */
  useEffect(() => {
    if (!productData?.results?.length) return;
    setRows((prev) => {
      // Preserve any quantities the user has already edited
      const editedById = new Map(prev.map((r) => [r.product.id, r.quantity]));
      const orderProductIds = new Set(orderAggregation.keys());

      return productData.results.map((p) => {
        const orderQty = orderAggregation.get(p.id);
        const wasEdited = editedById.has(p.id);
        return {
          product: p,
          quantity: wasEdited
            ? editedById.get(p.id)!
            : orderQty != null && fromOrders
              ? Math.ceil(orderQty)
              : 0,
          fromOrder: orderProductIds.has(p.id),
        };
      });
    });
  }, [productData, orderAggregation, fromOrders]);

  /* ── Filter rows ── */
  const filteredRows = useMemo(() => {
    let result = rows;
    if (pill === 'ordered') result = result.filter((r) => r.fromOrder);
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (r) =>
          r.product.name.toLowerCase().includes(q) ||
          (r.product.sku ?? '').toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      if (a.fromOrder && !b.fromOrder) return -1;
      if (!a.fromOrder && b.fromOrder) return 1;
      return a.product.name.localeCompare(b.product.name, 'pl', { sensitivity: 'base' });
    });
  }, [rows, pill, search]);

  /* ── Qty mutations ── */
  const updateQty = useCallback((productId: string, newQty: number) => {
    setRows((prev) =>
      prev.map((r) =>
        r.product.id === productId ? { ...r, quantity: Math.max(0, newQty) } : r,
      ),
    );
  }, []);

  /* ── Submit ── */
  const loadedRows = useMemo(() => rows.filter((r) => r.quantity > 0), [rows]);

  async function onSubmit() {
    if (!fromWarehouseId) { setSubmitError('Wybierz magazyn źródłowy'); return; }
    if (!toWarehouseId) { setSubmitError('Wybierz magazyn docelowy'); return; }
    if (loadedRows.length === 0) { setSubmitError('Podaj ilość dla co najmniej jednego produktu'); return; }
    if (fromWarehouseId === toWarehouseId) { setSubmitError('Magazyn źródłowy i docelowy muszą być różne'); return; }
    setSubmitError(null);

    const payload: VanLoadingPayload = {
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      issue_date: date,
      items: loadedRows.map((r) => ({
        product_id: r.product.id,
        quantity: r.quantity.toFixed(3),
      })),
    };

    try {
      const doc = await vanLoading.mutateAsync(payload);
      navigate(`/delivery/${doc.id}/route`, { replace: true });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się załadować vana');
    }
  }

  /* ── Guard ── */
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const isLoading = mainWHLoading || mobileWHLoading || productsLoading || (fromOrders && ordersLoading);
  const fromWH = mainWarehouses.find((w) => w.id === fromWarehouseId);
  const toWH = mobileWarehouses.find((w) => w.id === toWarehouseId);
  const hasMultipleWarehouses = mainWarehouses.length > 1 || mobileWarehouses.length > 1;

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Wróć"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Załaduj Van</h1>
          {fromOrders && (
            <p className="text-[12px] text-muted-foreground">{formatDatePl(date)}</p>
          )}
        </div>
        {loadedRows.length > 0 && (
          <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground">
            {loadedRows.length} poz.
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div
        className={cn(
          'flex flex-col gap-4 px-4 pt-4',
          // bottom padding: fixed button bar (≈76px) + bottom nav (83px) + safe area
          'pb-[calc(76px+83px+env(safe-area-inset-bottom))] md:pb-[calc(76px+env(safe-area-inset-bottom))]',
        )}
      >
        {/* Warehouse row */}
        <button
          type="button"
          onClick={() => setShowWarehousePicker((v) => !v)}
          className="flex items-center gap-2 rounded-2xl bg-surface-card px-4 py-3 shadow-soft text-left transition-colors hover:bg-surface-low/40"
          aria-expanded={showWarehousePicker}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-foreground">{fromWH?.code ?? '—'}</span>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={1.5}>
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
            <path d="M1 3h15v13H1zM16 8l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-foreground">{toWH?.code ?? '—'}</span>
          <div className="flex-1" />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', showWarehousePicker && 'rotate-180')}
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {showWarehousePicker && (
          <div className="rounded-2xl bg-surface-card p-4 shadow-soft space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Magazyn źródłowy (MG)
              </label>
              <select
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
              >
                <option value="">— wybierz —</option>
                {mainWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
              {mainWarehouses.length === 0 && !mainWHLoading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Brak aktywnych magazynów głównych. Utwórz magazyn w ustawieniach.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Magazyn docelowy (Van)
              </label>
              <select
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
              >
                <option value="">— wybierz —</option>
                {mobileWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
              {mobileWarehouses.length === 0 && !mobileWHLoading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Brak aktywnych magazynów mobilnych. Utwórz van w ustawieniach.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj produkt…"
            aria-label="Szukaj produktu po nazwie lub SKU"
            className="shadow-soft h-11 w-full rounded-xl border-0 bg-surface-card pl-11 pr-4 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Wyczyść"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPill('all')}
            className={cn(
              'rounded-full px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              pill === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-card text-foreground shadow-soft',
            )}
          >
            Wszystkie
          </button>
          {fromOrders && (
            <button
              type="button"
              onClick={() => setPill('ordered')}
              className={cn(
                'rounded-full px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                pill === 'ordered'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-card text-foreground shadow-soft',
              )}
            >
              Zamówione
            </button>
          )}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-10" aria-busy="true" role="status">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            <span className="text-sm text-muted-foreground">Ładowanie…</span>
          </div>
        )}

        {/* Product list */}
        {!isLoading && (
          <div>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Produkty
            </h2>
            <div className="flex flex-col gap-2">
              {filteredRows.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {search ? 'Brak wyników dla podanej frazy' : 'Brak produktów'}
                </p>
              )}
              {filteredRows.map((row) => (
                <ProductStepperRow
                  key={row.product.id}
                  row={row}
                  stock={stockByProductId.get(row.product.id)}
                  onChange={(qty) => updateQty(row.product.id, qty)}
                />
              ))}
            </div>
          </div>
        )}

        {submitError && (
          <p
            className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {submitError}
          </p>
        )}
      </div>

      {/* ── Fixed bottom bar ── */}
      <div
        className={cn(
          'fixed left-0 right-0 z-30',
          // Sits above the mobile bottom nav (83px); on desktop md+ the bottom nav is hidden
          'bottom-[83px] md:bottom-0',
          'border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur',
        )}
      >
        {fromOrders && !ordersLoading && (
          <p className="mb-2 text-center text-[11px] text-muted-foreground">
            Pobiera dane z zamówień ({orders.length} zam., {orderAggregation.size} produktów)
          </p>
        )}
        <Button
          type="button"
          className="w-full rounded-xl py-3 text-base font-semibold"
          onClick={() => void onSubmit()}
          disabled={vanLoading.isPending || loadedRows.length === 0}
          loading={vanLoading.isPending}
        >
          {vanLoading.isPending
            ? 'Trwa załadunek…'
            : loadedRows.length === 0
              ? 'Załaduj'
              : `Załaduj (${loadedRows.length} poz.)`}
        </Button>
      </div>
    </div>
  );
}

/* ─── Product stepper row ────────────────────────────────────────── */

interface ProductStepperRowProps {
  row: ProductRow;
  stock?: number;
  onChange: (qty: number) => void;
}

function ProductStepperRow({ row, stock, onChange }: ProductStepperRowProps) {
  const { product, quantity, fromOrder } = row;
  const isActive = quantity > 0;
  const colorClass = avatarColor(product.id);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl bg-surface-card px-4 py-3 shadow-soft transition-shadow',
        isActive && 'ring-2 ring-primary/20',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold',
          colorClass,
        )}
        aria-hidden
      >
        {productInitial(product.name)}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-tight text-foreground">{product.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
          {product.price_gross != null && (
            <span className={cn(fromOrder && 'text-primary font-medium')}>
              {formatPrice(product.price_gross)}
            </span>
          )}
          {stock !== undefined && (
            <span>{formatStock(stock, product.unit)}</span>
          )}
        </div>
      </div>

      {/* Stepper */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(quantity - 1)}
          disabled={quantity === 0}
          aria-label={`Zmniejsz ${product.name}`}
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
          value={quantity}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onChange(Number.isFinite(v) && v >= 0 ? v : 0);
          }}
          aria-label={`Ilość ${product.name}`}
          className={cn(
            'h-9 w-12 rounded-lg border-0 bg-transparent text-center text-[18px] font-bold tabular-nums',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:rounded-lg',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}
        />

        <button
          type="button"
          onClick={() => onChange(quantity + 1)}
          aria-label={`Zwiększ ${product.name}`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useVanRouteQuery, useStartLoadingMutation, useConfirmLoadingMutation } from '@/query/use-van-routes';
import { useStockSnapshotQuery } from '@/query/use-products';
import { useVanReconciliationMutation } from '@/query/use-delivery';
import { cn } from '@/lib/utils';
import type { OrderItem, RouteOrder } from '@/types';

/* ─── Types ──────────────────────────────────────────────────────── */

interface CarryOverRow {
  productId: string;
  productName: string;
  unit: string;
  qty: number;        // total carry-over quantity
  returnQty: string;  // qty to return to MG (user input)
  writeoffQty: string; // qty to write off (user input)
  // keepQty = qty - returnQty - writeoffQty (computed, shown read-only)
}

interface LoadRow {
  productId: string;
  productName: string;
  productUnit: string;
  orderQty: number;     // aggregated from selected orders
  keptFromVan: number;  // carry-over being kept → reduces MM qty
  loadQty: number;      // qty to load from MG (user-editable)
  userEdited: boolean;  // if true, don't recalculate on carry-over change
  stock: number | undefined;
}

/* ─── Helpers ────────────────────────────────────────────────────── */

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

function avatarLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

/* ─── Carry-over section ─────────────────────────────────────────── */

function parseNum(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function CarryOverSection({
  rows,
  onChange,
}: {
  rows: CarryOverRow[];
  onChange: (productId: string, field: 'returnQty' | 'writeoffQty', value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-amber-600" stroke="currentColor" strokeWidth={2}>
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-400">
            Towar z poprzedniej trasy — zdecyduj co zrobić
          </p>
        </div>
        <p className="text-[11px] text-amber-700 dark:text-amber-500">
          Podziel każdy produkt na: zostaje w vanie · zwrot do MG · odpisanie. Suma musi równać się stanowi z vana.
        </p>
      </div>

      {/* Product rows */}
      <div className="flex flex-col gap-px bg-amber-200/40 dark:bg-amber-800/20">
        {rows.map((r) => {
          const ret = parseNum(r.returnQty);
          const wof = parseNum(r.writeoffQty);
          const keep = Math.max(0, r.qty - ret - wof);
          const over = ret + wof > r.qty + 0.001;
          return (
            <div key={r.productId} className="bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
              {/* Product name + total */}
              <div className="flex items-baseline gap-2 mb-3">
                <span className="font-semibold text-sm text-amber-900 dark:text-amber-200">{r.productName}</span>
                <span className="text-[12px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {Number.isInteger(r.qty) ? r.qty : r.qty.toFixed(2)} {r.unit} w vanie
                </span>
              </div>

              {/* 3-column input grid */}
              <div className="grid grid-cols-3 gap-2">
                {/* Keep (read-only, computed) */}
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Zostaje</span>
                  <div className={cn(
                    'flex h-10 w-full items-center justify-center rounded-xl text-base font-bold tabular-nums',
                    keep > 0
                      ? 'bg-amber-200/70 text-amber-900 dark:bg-amber-800/40 dark:text-amber-200'
                      : 'bg-amber-100/50 text-amber-400',
                  )}>
                    {Number.isInteger(keep) ? keep : keep.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-amber-600">{r.unit}</span>
                </div>

                {/* Return to MG */}
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Zwrot do MG</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={r.returnQty}
                    onChange={(e) => onChange(r.productId, 'returnQty', e.target.value)}
                    className={cn(
                      'h-10 w-full rounded-xl border bg-background px-2 text-center text-base font-bold tabular-nums focus:outline-none focus:ring-2',
                      over ? 'border-destructive text-destructive focus:ring-destructive/30' : 'border-primary/40 text-primary focus:ring-primary/30',
                    )}
                    aria-label={`Zwrot do MG ${r.productName}`}
                  />
                  <span className="text-[10px] text-muted-foreground">{r.unit}</span>
                </div>

                {/* Write off */}
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-destructive">Odpisz</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={r.writeoffQty}
                    onChange={(e) => onChange(r.productId, 'writeoffQty', e.target.value)}
                    className={cn(
                      'h-10 w-full rounded-xl border bg-background px-2 text-center text-base font-bold tabular-nums focus:outline-none focus:ring-2',
                      over ? 'border-destructive text-destructive focus:ring-destructive/30' : 'border-destructive/40 text-destructive focus:ring-destructive/30',
                    )}
                    aria-label={`Odpisz ${r.productName}`}
                  />
                  <span className="text-[10px] text-muted-foreground">{r.unit}</span>
                </div>
              </div>

              {over && (
                <p className="mt-2 text-[11px] font-semibold text-destructive">
                  Suma przekracza stan vana ({Number.isInteger(r.qty) ? r.qty : r.qty.toFixed(2)} {r.unit})
                </p>
              )}
              {!over && (ret > 0 || wof > 0) && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {ret > 0 && <span className="text-primary font-medium">{Number.isInteger(ret) ? ret : ret.toFixed(2)} {r.unit} → MM-P do MG</span>}
                  {ret > 0 && wof > 0 && ' · '}
                  {wof > 0 && <span className="text-destructive font-medium">{Number.isInteger(wof) ? wof : wof.toFixed(2)} {r.unit} → odpisanie</span>}
                  {keep > 0 && ` · ${Number.isInteger(keep) ? keep : keep.toFixed(2)} ${r.unit} zostaje`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Order selector ─────────────────────────────────────────────── */

function OrderSelector({
  orders,
  selectedIds,
  onToggle,
}: {
  orders: RouteOrder[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Zamówienia w tej trasie ({orders.length})
      </h2>
      <div className="flex flex-col gap-2">
        {orders.map((order) => {
          const selected = selectedIds.has(order.id);
          return (
            <button
              key={order.id}
              type="button"
              onClick={() => onToggle(order.id)}
              className={cn(
                'flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all',
                selected
                  ? 'bg-surface-card shadow-soft ring-2 ring-primary/20'
                  : 'bg-surface-card shadow-soft opacity-50',
              )}
            >
              {/* Checkbox */}
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                  selected ? 'border-primary bg-primary' : 'border-border bg-background',
                )}
              >
                {selected && (
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-primary-foreground" stroke="currentColor" strokeWidth={3}>
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              {/* Avatar */}
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                  avatarColor(order.id),
                )}
              >
                {avatarLetter(order.customer_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{order.customer_name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {order.order_number ?? '—'} · {order.item_count}{' '}
                  {order.item_count === 1 ? 'produkt' : order.item_count < 5 ? 'produkty' : 'produktów'}
                </p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Product stepper row ────────────────────────────────────────── */

function ProductRow({
  row,
  onChange,
}: {
  row: LoadRow;
  onChange: (qty: number) => void;
}) {
  const active = row.loadQty > 0;
  const coveredByVan = row.keptFromVan >= row.orderQty && row.orderQty > 0;

  return (
    <div className={cn(
      'flex flex-col gap-2 rounded-2xl bg-surface-card px-4 py-3 shadow-soft',
      active && 'ring-2 ring-primary/20',
      coveredByVan && 'opacity-60',
    )}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold',
            avatarColor(row.productId),
          )}
          aria-hidden
        >
          {avatarLetter(row.productName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{row.productName}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
            {row.orderQty > 0 && (
              <span className="text-primary font-medium">
                Zam: {row.orderQty} {row.productUnit}
              </span>
            )}
            {row.keptFromVan > 0 && (
              <span className="text-amber-600 font-medium">
                Van: {row.keptFromVan} {row.productUnit}
              </span>
            )}
            {row.stock !== undefined && (
              <span>
                MG: {Number.isInteger(row.stock) ? row.stock : row.stock.toFixed(2)} {row.productUnit}
              </span>
            )}
          </div>
        </div>
        {/* Stepper */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(row.loadQty - 1)}
            disabled={row.loadQty === 0}
            aria-label={`Zmniejsz ${row.productName}`}
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
            value={row.loadQty}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onChange(Number.isFinite(v) && v >= 0 ? v : 0);
            }}
            aria-label={`Ilość ${row.productName}`}
            className={cn(
              'h-9 w-12 rounded-lg border-0 bg-transparent text-center text-[18px] font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
          <button
            type="button"
            onClick={() => onChange(row.loadQty + 1)}
            aria-label={`Zwiększ ${row.productName}`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {coveredByVan && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 pl-14">
          Pokryte przez towar z vana — ustaw 0 lub dodaj więcej jeśli potrzeba
        </p>
      )}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */

export function VanRouteLoadPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { routeId } = useParams<{ routeId: string }>();

  const { data: route, isLoading: routeLoading } = useVanRouteQuery(routeId);
  const { data: stockSnapshot } = useStockSnapshotQuery(route?.main_warehouse_id);
  const { data: vanStockSnapshot, isLoading: vanStockLoading } = useStockSnapshotQuery(route?.van_warehouse_id);

  const startLoading = useStartLoadingMutation();
  const confirmLoading = useConfirmLoadingMutation();
  const reconcile = useVanReconciliationMutation();

  /* ── Carry-over rows ── */
  const [carryOverRows, setCarryOverRows] = useState<CarryOverRow[]>([]);
  const [carryOverInitialised, setCarryOverInitialised] = useState(false);

  useEffect(() => {
    if (carryOverInitialised) return;
    if (vanStockLoading) return;
    const items = (vanStockSnapshot?.items ?? []).filter(
      (i) => (parseFloat(i.quantity_available) || 0) > 0,
    );
    if (items.length === 0) {
      setCarryOverInitialised(true);
      return;
    }
    setCarryOverRows(
      items.map((i) => ({
        productId: i.product_id,
        productName: i.product_name,
        unit: i.unit,
        qty: parseFloat(i.quantity_available) || 0,
        returnQty: '0',
        writeoffQty: '0',
      })),
    );
    setCarryOverInitialised(true);
  }, [carryOverInitialised, vanStockLoading, vanStockSnapshot]);

  function updateCarryOver(productId: string, field: 'returnQty' | 'writeoffQty', value: string) {
    setCarryOverRows((prev) =>
      prev.map((r) => (r.productId === productId ? { ...r, [field]: value } : r)),
    );
    // Recalculate load qty for affected product (only if not user-edited)
    setRows((prev) =>
      prev.map((r) => {
        if (r.productId !== productId || r.userEdited) return r;
        const carryOver = carryOverRows.find((c) => c.productId === productId);
        if (!carryOver) return r;
        const newRow = { ...carryOver, [field]: value };
        const ret = parseNum(newRow.returnQty);
        const wof = parseNum(newRow.writeoffQty);
        const keptFromVan = Math.max(0, carryOver.qty - ret - wof);
        return {
          ...r,
          keptFromVan,
          loadQty: Math.max(0, Math.ceil(r.orderQty - keptFromVan)),
        };
      }),
    );
  }

  /* ── Order selection ── */
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [ordersInitialised, setOrdersInitialised] = useState(false);

  useEffect(() => {
    if (ordersInitialised) return;
    if (!route?.orders?.length) return;
    setSelectedOrderIds(new Set(route.orders.map((o) => o.id)));
    setOrdersInitialised(true);
  }, [ordersInitialised, route?.orders]);

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ── Stock maps ── */
  const stockByProductId = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of stockSnapshot?.items ?? []) {
      m.set(item.product_id, parseFloat(item.quantity_available) || 0);
    }
    return m;
  }, [stockSnapshot]);

  // Effective "kept in van" quantity per product (total carry-over minus return and writeoff)
  const carryOverByProductId = useMemo(() => {
    const m = new Map<string, { row: CarryOverRow; keepQty: number }>();
    for (const r of carryOverRows) {
      const ret = parseNum(r.returnQty);
      const wof = parseNum(r.writeoffQty);
      m.set(r.productId, { row: r, keepQty: Math.max(0, r.qty - ret - wof) });
    }
    return m;
  }, [carryOverRows]);

  /* ── Fetch full order items ── */
  const [allOrderItems, setAllOrderItems] = useState<
    Array<{ orderId: string; productId: string; productName: string; unit: string; qty: number }>
  >([]);

  useEffect(() => {
    if (!route?.orders?.length) return;

    async function fetchItems() {
      const { orderService } = await import('@/services/order.service');
      const results = await Promise.all(
        (route!.orders).map((o) => orderService.fetchById(o.id).then((d) => ({ orderId: o.id, data: d }))),
      );
      const flat: typeof allOrderItems = [];
      for (const { orderId, data } of results) {
        for (const item of data.items as OrderItem[]) {
          flat.push({
            orderId,
            productId: item.product_id,
            productName: item.product_name,
            unit: item.product_unit,
            qty: parseFloat(String(item.quantity)) || 0,
          });
        }
      }
      setAllOrderItems(flat);
    }

    void fetchItems();
  }, [route?.orders]);

  /* ── Build load rows from selected orders + carry-over ── */
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [rowsInitialised, setRowsInitialised] = useState(false);

  useEffect(() => {
    if (rowsInitialised) return;
    if (!allOrderItems.length) return;
    if (!carryOverInitialised) return;

    // Aggregate quantities from all orders (we'll filter by selectedOrderIds reactively)
    const aggMap = new Map<string, { productName: string; unit: string; qty: number }>();
    for (const item of allOrderItems) {
      const existing = aggMap.get(item.productId);
      if (existing) existing.qty += item.qty;
      else aggMap.set(item.productId, { productName: item.productName, unit: item.unit, qty: item.qty });
    }

    const built: LoadRow[] = [];
    for (const [productId, { productName, unit, qty: orderQty }] of aggMap) {
      const carryOver = carryOverByProductId.get(productId);
      const keptFromVan = carryOver?.keepQty ?? 0;
      built.push({
        productId,
        productName,
        productUnit: unit,
        orderQty,
        keptFromVan,
        loadQty: Math.max(0, Math.ceil(orderQty - keptFromVan)),
        userEdited: false,
        stock: stockByProductId.get(productId),
      });
    }

    built.sort((a, b) => a.productName.localeCompare(b.productName, 'pl'));
    setRows(built);
    setRowsInitialised(true);
  }, [rowsInitialised, allOrderItems, carryOverInitialised, carryOverByProductId, stockByProductId]);

  /* ── Update stock figures when snapshot arrives ── */
  useEffect(() => {
    if (!stockByProductId.size) return;
    setRows((prev) => prev.map((r) => ({ ...r, stock: stockByProductId.get(r.productId) })));
  }, [stockByProductId]);

  /* ── Effective order qty per product (based on selected orders) ── */
  const effectiveOrderQtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of allOrderItems) {
      if (!selectedOrderIds.has(item.orderId)) continue;
      m.set(item.productId, (m.get(item.productId) ?? 0) + item.qty);
    }
    return m;
  }, [allOrderItems, selectedOrderIds]);

  /* ── Sync rows when selected orders change ── */
  useEffect(() => {
    if (!effectiveOrderQtyByProduct.size && !rows.length) return;
    setRows((prev) =>
      prev.map((r) => {
        const orderQty = effectiveOrderQtyByProduct.get(r.productId) ?? 0;
        if (r.userEdited) return { ...r, orderQty };
        const carryOver = carryOverByProductId.get(r.productId);
        const keptFromVan = carryOver?.keepQty ?? 0;
        return {
          ...r,
          orderQty,
          keptFromVan,
          loadQty: Math.max(0, Math.ceil(orderQty - keptFromVan)),
        };
      }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOrderQtyByProduct]);

  function updateQty(productId: string, qty: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.productId === productId
          ? { ...r, loadQty: Math.max(0, qty), userEdited: true }
          : r,
      ),
    );
  }

  /* ── Extra products ── */
  const [extraQtys, setExtraQtys] = useState<Map<string, number>>(new Map());
  const [extraSearch, setExtraSearch] = useState('');
  const [showExtraProducts, setShowExtraProducts] = useState(false);

  const extraProducts = useMemo(() => {
    if (!stockSnapshot?.items?.length) return [];
    return stockSnapshot.items
      .filter((item) => (parseFloat(item.quantity_available) || 0) > 0)
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'pl'));
  }, [stockSnapshot]);

  const updateExtraQty = useCallback((productId: string, qty: number) => {
    setExtraQtys((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(productId);
      else next.set(productId, Math.max(0, qty));
      return next;
    });
  }, []);

  /* ── Submit ── */
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onLoad() {
    if (!routeId || !route?.van_warehouse_id) return;
    setSubmitError(null);

    try {
      // ── Step 1: Resolve carry-over items that have return or write-off ──
      const carryOverToProcess = carryOverRows.filter(
        (r) => parseNum(r.returnQty) > 0 || parseNum(r.writeoffQty) > 0,
      );

      if (carryOverToProcess.length > 0) {
        const items = carryOverToProcess.map((r) => ({
          product_id: r.productId,
          quantity_actual_remaining: parseNum(r.returnQty).toFixed(3),
          quantity_writeoff: parseNum(r.writeoffQty).toFixed(3),
        }));

        await reconcile.mutateAsync({
          warehouseId: route.van_warehouse_id,
          data: { items },
          routeId: undefined,
        });
      }

      // ── Step 2: Build MM items (new products from MG) ────────────
      console.debug('[onLoad] rows loadQty:', rows.map(r => `${r.productName}=${r.loadQty}`));
      console.debug('[onLoad] extraQtys:', [...extraQtys.entries()]);
      const merged = new Map<string, number>();
      for (const r of rows) {
        if (r.loadQty > 0) merged.set(r.productId, (merged.get(r.productId) ?? 0) + r.loadQty);
      }
      for (const [productId, qty] of extraQtys) {
        if (qty > 0) merged.set(productId, (merged.get(productId) ?? 0) + qty);
      }
      console.debug('[onLoad] merged items:', [...merged.entries()]);

      const mmItems = [...merged.entries()].map(([product_id, qty]) => ({
        product_id,
        quantity: qty.toFixed(3),
      }));

      if (mmItems.length === 0) {
        // Nothing new to load — all covered by kept carry-over
        // Still need to move route from planned → in_progress
        // Call startLoading with carry-over 'keep' items as placeholder?
        // For now: just confirm (backend may handle this edge case)
        await confirmLoading.mutateAsync(routeId);
        navigate(`/van-routes/${routeId}`);
        return;
      }

      // ── Step 3: Create MM (MG → van) ────────────────────────────
      await startLoading.mutateAsync({
        id: routeId,
        payload: { items: mmItems },
      });

      // ── Step 4: Confirm loading → route goes in_progress ─────────
      await confirmLoading.mutateAsync(routeId);
      navigate(`/van-routes/${routeId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się załadować vana');
    }
  }

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const isPending = startLoading.isPending || confirmLoading.isPending || reconcile.isPending;
  const mmItemCount = rows.filter((r) => r.loadQty > 0).length + [...extraQtys.values()].filter((q) => q > 0).length;
  const hasCarryOver = carryOverRows.length > 0;
  const hasCarryOverAction = carryOverRows.some((r) => parseNum(r.returnQty) > 0 || parseNum(r.writeoffQty) > 0);
  const carryOverHasError = carryOverRows.some((r) => parseNum(r.returnQty) + parseNum(r.writeoffQty) > r.qty + 0.001);
  const returnCount = carryOverRows.filter((r) => parseNum(r.returnQty) > 0).length;
  const writeoffCount = carryOverRows.filter((r) => parseNum(r.writeoffQty) > 0).length;

  const filteredExtraRows = extraSearch.trim()
    ? extraProducts.filter((r) => r.product_name.toLowerCase().includes(extraSearch.toLowerCase()))
    : extraProducts;

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
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Załadunek Vana</h1>
          {route && (
            <p className="text-[12px] text-muted-foreground">
              {route.van_name || route.van_warehouse_code}
              {route.driver_name ? ` · ${route.driver_name}` : ''}
            </p>
          )}
        </div>
        {mmItemCount > 0 && (
          <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground">
            {mmItemCount} poz. z MG
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4 pb-[calc(76px+83px+env(safe-area-inset-bottom))] md:pb-[calc(76px+env(safe-area-inset-bottom))]">

        {(routeLoading || vanStockLoading) && (
          <div className="flex flex-col items-center gap-3 py-10" role="status" aria-busy>
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            <span className="text-sm text-muted-foreground">Ładowanie…</span>
          </div>
        )}

        {/* ── Carry-over section ── */}
        {!vanStockLoading && hasCarryOver && (
          <CarryOverSection
            rows={carryOverRows}
            onChange={updateCarryOver}
          />
        )}

        {/* ── Order selector ── */}
        {!routeLoading && (route?.orders?.length ?? 0) > 0 && (
          <OrderSelector
            orders={route!.orders}
            selectedIds={selectedOrderIds}
            onToggle={toggleOrder}
          />
        )}

        {/* ── Products to load from MG ── */}
        {!routeLoading && rows.length > 0 && (
          <div>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Do załadowania z MG
            </h2>
            <div className="flex flex-col gap-2">
              {rows
                .filter((r) => (effectiveOrderQtyByProduct.get(r.productId) ?? r.orderQty) > 0 || r.loadQty > 0)
                .map((row) => (
                  <ProductRow key={row.productId} row={row} onChange={(qty) => updateQty(row.productId, qty)} />
                ))}
            </div>
          </div>
        )}

        {/* ── Extra products (not in orders) ── */}
        {!showExtraProducts ? (
          <button
            type="button"
            onClick={() => setShowExtraProducts(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface-card px-4 py-3.5 text-sm font-semibold text-primary shadow-soft transition-colors hover:bg-primary/5"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Dodaj dodatkowe produkty
          </button>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dodatkowe produkty
              </h2>
              <button
                type="button"
                onClick={() => { setShowExtraProducts(false); setExtraSearch(''); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Zwiń
              </button>
            </div>
            <div className="relative mb-2">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <input
                type="search"
                placeholder="Szukaj produktu…"
                value={extraSearch}
                onChange={(e) => setExtraSearch(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex flex-col gap-2">
              {filteredExtraRows.map((item) => {
                const qty = extraQtys.get(item.product_id) ?? 0;
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
                        MG: {parseFloat(item.quantity_available)} {item.unit}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateExtraQty(item.product_id, qty - 1)}
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
                          updateExtraQty(item.product_id, Number.isFinite(v) && v >= 0 ? v : 0);
                        }}
                        className={cn(
                          'h-9 w-12 rounded-lg border-0 bg-transparent text-center text-[18px] font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30',
                          qty > 0 ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => updateExtraQty(item.product_id, qty + 1)}
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
              {filteredExtraRows.length === 0 && extraSearch && (
                <p className="py-4 text-center text-sm text-muted-foreground">Brak wyników</p>
              )}
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
        {/* Carry-over summary chips */}
        {hasCarryOver && hasCarryOverAction && (
          <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
            {returnCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                MM-P: {returnCount} poz. wraca do MG
              </span>
            )}
            {writeoffCount > 0 && (
              <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-semibold text-destructive">
                Odpisanie: {writeoffCount} poz.
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void onLoad()}
          disabled={isPending || carryOverHasError}
          className={cn(
            'w-full rounded-xl py-3 text-base font-semibold transition-colors',
            !isPending
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {isPending
            ? reconcile.isPending
              ? 'Rozliczanie carry-over…'
              : 'Trwa załadunek…'
            : mmItemCount > 0
              ? `Załaduj Van (${mmItemCount} poz. z MG)`
              : hasCarryOver
                ? 'Zatwierdź i wyrusz'
                : 'Załaduj Van'}
        </button>
      </div>
    </div>
  );
}

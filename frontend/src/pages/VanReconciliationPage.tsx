import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useVanRouteQuery } from '@/query/use-van-routes';
import { useDeliveryQuery, useVanRouteWZListQuery, useVanReconciliationMutation } from '@/query/use-delivery';
import { useStockSnapshotQuery } from '@/query/use-products';
import { cn } from '@/lib/utils';
import { countPendingWzDocs, sumDeliveredWzByProduct, sumPendingWzByProduct } from '@/lib/van-wz-utils';
import type { VanReconciliationResult } from '@/types';

/* ─── Types ──────────────────────────────────────────────────────── */

type ReconciliationRow = {
  productId: string;
  productName: string;
  unit: string;
  // Derived
  loaded: number;
  sold: number;
  expectedThisRoute: number;
  totalVanStock: number;
  carryOver: number;
  pendingWz: number;
  loadedOnThisRoute: boolean;
  // User inputs — physical count + allocation split (all independent, no cross-calculation)
  physicalCount: string; // what driver actually counted in van (may differ from totalVanStock)
  returnQty: string;     // → quantity_actual_remaining (back to warehouse)
  keepQty: string;       // stays in van (not sent to backend — implicit remainder)
  writeoffQty: string;   // → quantity_writeoff (damage / loss)
};

function parseQty(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function fmt(n: number, unit = ''): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}

function formatReconciledLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

/* ─── Shared stepper ─────────────────────────────────────────────── */

function Stepper({
  value,
  unit,
  onChange,
  colorClass = 'text-foreground',
  inputClass = '',
}: {
  value: string;
  unit: string;
  onChange: (val: string) => void;
  colorClass?: string;
  inputClass?: string;
}) {
  const n = parseQty(value);

  function step(delta: number) {
    const next = Math.max(0, n + delta);
    onChange(Number.isInteger(next) ? String(next) : next.toFixed(2));
  }

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={n <= 0}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Zmniejsz"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        className={cn(
          'h-9 w-20 rounded-lg border border-input bg-background text-center text-base font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/25',
          colorClass,
          inputClass,
        )}
      />
      <button
        type="button"
        onClick={() => step(1)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
        aria-label="Zwiększ"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
      <span className="w-6 text-[12px] text-muted-foreground">{unit}</span>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────── */

export function VanReconciliationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const urlWarehouseId = searchParams.get('warehouse_id') ?? '';
  const urlRouteId = searchParams.get('route_id') ?? '';

  const reconcile = useVanReconciliationMutation();

  const { data: route } = useVanRouteQuery(urlRouteId || undefined);
  const mmDocId = route?.mm_document?.id;

  const { data: mmDoc } = useDeliveryQuery(mmDocId);
  const { data: vanWZDocs } = useVanRouteWZListQuery(urlRouteId || undefined);

  const { data: stockSnapshot, isLoading: snapshotLoading, isFetching: snapshotFetching } = useStockSnapshotQuery(
    urlWarehouseId || undefined,
  );

  const [result, setResult] = useState<VanReconciliationResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReconciliationRow[]>([]);

  const stockByProductId = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of stockSnapshot?.items ?? []) {
      m.set(i.product_id, parseFloat(i.quantity_available) || 0);
    }
    return m;
  }, [stockSnapshot]);

  const soldByProductId = useMemo(() => sumDeliveredWzByProduct(vanWZDocs), [vanWZDocs]);
  const pendingWzByProductId = useMemo(() => sumPendingWzByProduct(vanWZDocs), [vanWZDocs]);
  const pendingWzDocCount = useMemo(() => countPendingWzDocs(vanWZDocs), [vanWZDocs]);

  const rowsReady = !snapshotLoading && !snapshotFetching && Boolean(stockSnapshot);

  useEffect(() => {
    if (!rowsReady || !stockSnapshot) return;

    const allProducts = new Map<string, { name: string; unit: string }>();
    for (const i of stockSnapshot.items ?? []) {
      if ((parseFloat(i.quantity_available) || 0) > 0) {
        allProducts.set(i.product_id, { name: i.product_name, unit: i.unit });
      }
    }

    if (allProducts.size === 0) {
      setRows([]);
      return;
    }

    const loadedByProductId = new Map<string, number>();
    for (const item of mmDoc?.items ?? []) {
      loadedByProductId.set(item.product_id, parseFloat(String(item.quantity_planned)) || 0);
    }

    const built: ReconciliationRow[] = [];
    for (const [productId, { name, unit }] of allProducts) {
      const loadedOnThisRoute = loadedByProductId.has(productId);
      const loaded = loadedByProductId.get(productId) ?? 0;
      const sold = soldByProductId.get(productId) ?? 0;
      const pendingWz = pendingWzByProductId.get(productId) ?? 0;
      const expectedThisRoute = Math.max(0, loaded - sold);
      const totalVanStock = stockByProductId.get(productId) ?? 0;
      const carryOver = loadedOnThisRoute ? 0 : totalVanStock;

      // Default: carry-over stock stays in van; route stock goes back to warehouse
      const defaultReturn = carryOver > 0 || pendingWz > 0 ? 0 : totalVanStock;

      const physicalCountDefault = Number.isInteger(totalVanStock)
        ? String(totalVanStock)
        : totalVanStock.toFixed(2);

      built.push({
        productId,
        productName: name,
        unit,
        loaded,
        sold,
        expectedThisRoute,
        totalVanStock,
        carryOver,
        pendingWz,
        loadedOnThisRoute,
        physicalCount: physicalCountDefault,
        returnQty: String(defaultReturn),
        keepQty: carryOver > 0 || pendingWz > 0 ? physicalCountDefault : '0',
        writeoffQty: '0',
      });
    }

    built.sort((a, b) => a.productName.localeCompare(b.productName, 'pl'));
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.productId, r]));
      return built.map((b) => {
        const p = prevById.get(b.productId);
        // Preserve user edits if row already existed
        return p ? { ...b, physicalCount: p.physicalCount, returnQty: p.returnQty, keepQty: p.keepQty, writeoffQty: p.writeoffQty } : b;
      });
    });
  }, [rowsReady, stockSnapshot, mmDoc, soldByProductId, pendingWzByProductId, stockByProductId]);

  function updateRow(productId: string, field: 'physicalCount' | 'returnQty' | 'keepQty' | 'writeoffQty', value: string) {
    setRows((prev) =>
      prev.map((r) => (r.productId === productId ? { ...r, [field]: value } : r)),
    );
  }

  async function onSubmit() {
    setSubmitError(null);

    for (const r of rows) {
      const ret = parseQty(r.returnQty);
      const keep = parseQty(r.keepQty);
      const wof = parseQty(r.writeoffQty);
      const counted = parseQty(r.physicalCount);
      if (ret + keep + wof > counted + 0.001) {
        setSubmitError(`Suma przekracza policzoną ilość dla: ${r.productName}`);
        return;
      }
    }

    // Backend uses T (system stock) to compute kept = T - P - W.
    // Driver's explicit keepQty is not sent — it's just a UI aid.
    // If physicalCount < totalVanStock, the unaccounted stock is added to writeoff
    // so the backend zeroes it out rather than leaving phantom stock in the van.
    const items = rows.map((r) => {
      const counted = parseQty(r.physicalCount);
      const missing = Math.max(0, r.totalVanStock - counted);
      return {
        product_id: r.productId,
        quantity_actual_remaining: parseQty(r.returnQty).toFixed(3),
        quantity_writeoff: (parseQty(r.writeoffQty) + missing).toFixed(3),
      };
    });

    try {
      const res = await reconcile.mutateAsync({
        warehouseId: urlWarehouseId,
        data: { items },
        routeId: urlRouteId || undefined,
      });
      setResult(res);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się rozliczyć vana');
    }
  }

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  /* ── Result screen ── */
  if (result) {
    const returned = rows.filter((r) => parseQty(r.returnQty) > 0);
    const writtenOff = rows.filter((r) => parseQty(r.writeoffQty) > 0);
    const kept = rows.filter(
      (r) => parseQty(r.returnQty) === 0 && parseQty(r.writeoffQty) === 0,
    );

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/40 bg-background/95 px-0 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
              <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-[17px] font-semibold tracking-tight">Rozliczenie zakończone</h1>
        </div>

        {/* Return to warehouse */}
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">Zwrot do magazynu</p>
          {result.mm_return_number ? (
            <>
              <p className="text-sm text-emerald-700 dark:text-emerald-500">
                Nr dokumentu: <span className="font-bold">{result.mm_return_number}</span>
              </p>
              {returned.map((r) => (
                <div key={r.productId} className="flex justify-between text-sm text-emerald-700 dark:text-emerald-500">
                  <span>{r.productName}</span>
                  <span className="tabular-nums font-semibold">{fmt(parseQty(r.returnQty), r.unit)}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Brak produktów do zwrotu</p>
          )}
          <p className="text-[12px] text-muted-foreground">{formatReconciledLabel(result.reconciled_at)}</p>
        </div>

        {/* Written off — RW document */}
        {writtenOff.length > 0 && (
          <div className="rounded-2xl bg-destructive/5 border border-destructive/30 px-4 py-3 space-y-1">
            <p className="text-sm font-semibold text-destructive">Odpisano (straty / uszkodzenia)</p>
            {result.rw_writeoff_number && (
              <p className="text-sm text-destructive/80">
                Nr dokumentu: <span className="font-bold">{result.rw_writeoff_number}</span>
              </p>
            )}
            {writtenOff.map((r) => (
              <div key={r.productId} className="flex justify-between text-sm text-destructive/80">
                <span>{r.productName}</span>
                <span className="tabular-nums font-semibold">{fmt(parseQty(r.writeoffQty), r.unit)}</span>
              </div>
            ))}
            <p className="text-[12px] text-muted-foreground">{formatReconciledLabel(result.reconciled_at)}</p>
          </div>
        )}

        {/* Kept in van */}
        {kept.length > 0 && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-400">
              Zostaje w vanie na kolejny dzień
            </p>
            {kept.map((r) => (
              <div key={r.productId} className="flex justify-between text-sm text-amber-700 dark:text-amber-500">
                <span>{r.productName}</span>
                <span className="tabular-nums font-semibold">{fmt(r.totalVanStock, r.unit)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Discrepancies */}
        {result.discrepancies.length > 0 && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-destructive">
              Różnice w stanie ({result.discrepancies.length})
            </p>
            {result.discrepancies.map((d) => {
              const delta = parseFloat(d.quantity_delta);
              return (
                <div key={d.product_id} className="flex justify-between text-sm">
                  <span className="text-foreground">{d.product_name}</span>
                  <span className={cn('tabular-nums font-semibold', delta < 0 ? 'text-destructive' : 'text-amber-600')}>
                    {delta > 0 ? '+' : ''}{delta.toLocaleString('pl-PL', { maximumFractionDigits: 3 })}
                    {' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({d.discrepancy_type === 'damage' ? 'niedobór' : 'nadwyżka'})
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {result.discrepancies.length === 0 && !kept.length && !writtenOff.length && returned.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-4">
            Stan vana zgadzał się z systemem — brak różnic.
          </p>
        )}

        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-full rounded-xl py-3 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {urlRouteId ? 'Wróć do tras' : 'Wróć do dokumentów'}
        </button>
      </div>
    );
  }

  /* ── Enter counts screen ── */
  const hasOverAllocation = rows.some(
    (r) => parseQty(r.returnQty) + parseQty(r.keepQty) + parseQty(r.writeoffQty) > parseQty(r.physicalCount) + 0.001,
  );

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-[calc(76px+83px+env(safe-area-inset-bottom))] md:pb-[calc(76px+env(safe-area-inset-bottom))] space-y-4">

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/40 bg-background/95 px-0 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight">Rozlicz Van</h1>
          {route && (
            <p className="text-[12px] text-muted-foreground">
              {route.route_number && <span className="font-semibold text-foreground">{route.route_number} · </span>}
              {route.van_name || route.van_warehouse_code} · {route.date}
            </p>
          )}
        </div>
      </div>

      {/* Instruction strip */}
      <div className="rounded-2xl bg-primary/5 border border-primary/15 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Rozdziel co zostało w vanie</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Dla każdego produktu ustaw ile wraca do magazynu, ile jest stratą,
          a reszta automatycznie zostaje w vanie.
        </p>
      </div>

      {/* Pending WZ warning */}
      {pendingWzDocCount > 0 && (
        <div className="rounded-2xl border border-amber-300/50 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Uwaga: {pendingWzDocCount}{' '}
            {pendingWzDocCount === 1 ? 'dostawa niepotwierdzona' : 'dostawy niepotwierdzone'}
          </p>
          <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-400">
            Wróć do trasy i potwierdź dostawy przed rozliczeniem.
          </p>
          {urlRouteId && (
            <button
              type="button"
              onClick={() => navigate(`/van-routes/${urlRouteId}`)}
              className="mt-2 text-[12px] font-semibold text-amber-800 underline dark:text-amber-300"
            >
              Wróć do trasy →
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {(snapshotLoading || snapshotFetching) && !rowsReady && (
        <div className="flex items-center justify-center py-16">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {rowsReady && rows.length === 0 && (
        <div className="rounded-2xl bg-surface-card px-4 py-10 text-center shadow-soft">
          <p className="font-semibold text-foreground">Van jest pusty</p>
          <p className="mt-1 text-sm text-muted-foreground">Brak towaru do rozliczenia.</p>
        </div>
      )}

      {/* Error */}
      {submitError && (
        <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      {/* Product cards */}
      {rowsReady && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const returnN = parseQty(r.returnQty);
            const keepN = parseQty(r.keepQty);
            const writeoffN = parseQty(r.writeoffQty);
            const countedN = parseQty(r.physicalCount);
            const overAllocated = returnN + keepN + writeoffN > countedN + 0.001;
            const countDiff = countedN - r.totalVanStock; // positive = surplus, negative = missing

            // Active preset: which quick-action is fully selected (relative to physicalCount)
            const preset =
              returnN === countedN && keepN === 0 && writeoffN === 0 ? 'return' :
              returnN === 0 && keepN === countedN && writeoffN === 0 ? 'keep' :
              returnN === 0 && keepN === 0 && writeoffN === countedN ? 'writeoff' :
              'custom';

            function applyPreset(p: 'return' | 'keep' | 'writeoff') {
              const all = Number.isInteger(countedN)
                ? String(countedN)
                : countedN.toFixed(2);
              if (p === 'return') {
                updateRow(r.productId, 'returnQty', all);
                updateRow(r.productId, 'keepQty', '0');
                updateRow(r.productId, 'writeoffQty', '0');
              } else if (p === 'keep') {
                updateRow(r.productId, 'returnQty', '0');
                updateRow(r.productId, 'keepQty', all);
                updateRow(r.productId, 'writeoffQty', '0');
              } else {
                updateRow(r.productId, 'returnQty', '0');
                updateRow(r.productId, 'keepQty', '0');
                updateRow(r.productId, 'writeoffQty', all);
              }
            }

            return (
              <div key={r.productId} className={cn(
                'rounded-2xl bg-surface-card px-4 py-4 shadow-soft',
                overAllocated && 'ring-2 ring-destructive/40',
              )}>

                {/* Header: name + stock reference */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{r.productName}</span>
                      {r.carryOver > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                          z poprzedniej trasy
                        </span>
                      )}
                      {r.pendingWz > 0 && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          WZ niepotwierdzone
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      W systemie: <span className="font-semibold tabular-nums text-foreground">{fmt(r.totalVanStock, r.unit)}</span>
                    </p>
                  </div>
                  {/* Active preset chip */}
                  {preset !== 'custom' && (
                    <span className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                      preset === 'return' && 'bg-primary/10 text-primary',
                      preset === 'keep'   && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                      preset === 'writeoff' && 'bg-destructive/10 text-destructive',
                    )}>
                      {preset === 'return' && 'Zwrot'}
                      {preset === 'keep'   && 'Zostaje'}
                      {preset === 'writeoff' && 'Odpisane'}
                    </span>
                  )}
                </div>

                {/* Physical count row */}
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-medium text-foreground">Policzone w vanie</span>
                    {Math.abs(countDiff) > 0.001 && (
                      <span className={cn(
                        'ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
                        countDiff < 0
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
                      )}>
                        {countDiff > 0 ? '+' : ''}{fmt(countDiff, r.unit)}
                      </span>
                    )}
                  </div>
                  <Stepper
                    value={r.physicalCount}
                    unit={r.unit}
                    onChange={(v) => {
                      updateRow(r.productId, 'physicalCount', v);
                      // Re-clamp returnQty if it would exceed new physicalCount
                      const newCounted = parseQty(v);
                      const wof = parseQty(r.writeoffQty);
                      const ret = parseQty(r.returnQty);
                      if (ret + wof > newCounted + 0.001) {
                        const newReturn = Math.max(0, newCounted - wof);
                        updateRow(r.productId, 'returnQty', Number.isInteger(newReturn) ? String(newReturn) : newReturn.toFixed(2));
                      }
                    }}
                  />
                </div>

                {/* Quick-preset buttons */}
                <div className="mb-4 grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('return')}
                    className={cn(
                      'rounded-xl py-2 text-[12px] font-semibold transition-colors',
                      preset === 'return'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    )}
                  >
                    Oddaj wszystko
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('keep')}
                    className={cn(
                      'rounded-xl py-2 text-[12px] font-semibold transition-colors',
                      preset === 'keep'
                        ? 'bg-amber-400 text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    )}
                  >
                    Zostaw na jutro
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('writeoff')}
                    className={cn(
                      'rounded-xl py-2 text-[12px] font-semibold transition-colors',
                      preset === 'writeoff'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    )}
                  >
                    Odpisz wszystko
                  </button>
                </div>

                {/* Fine-tune split — always visible for transparency */}
                <div className="space-y-2">
                  {/* Return to warehouse */}
                  <div className="flex items-center gap-2">
                    <span className="w-36 shrink-0 text-[12px] font-medium text-foreground">
                      Oddaj do magazynu
                    </span>
                    <Stepper
                      value={r.returnQty}
                      unit={r.unit}
                      onChange={(v) => updateRow(r.productId, 'returnQty', v)}
                    />
                  </div>

                  {/* Keep in van — independent stepper, no back-calculation */}
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'w-36 shrink-0 text-[12px] font-medium',
                      keepN > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                    )}>
                      Zostaje w vanie
                    </span>
                    <Stepper
                      value={r.keepQty}
                      unit={r.unit}
                      colorClass={keepN > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}
                      onChange={(v) => updateRow(r.productId, 'keepQty', v)}
                    />
                  </div>

                  {/* Write off */}
                  <div className="flex items-center gap-2">
                    <span className="w-36 shrink-0 text-[12px] font-medium text-destructive/70">
                      Strata / uszkodzenie
                    </span>
                    <Stepper
                      value={r.writeoffQty}
                      unit={r.unit}
                      onChange={(v) => updateRow(r.productId, 'writeoffQty', v)}
                      colorClass={writeoffN > 0 ? 'text-destructive' : 'text-muted-foreground'}
                    />
                  </div>
                </div>

                {/* Over-allocation error */}
                {overAllocated && (
                  <p className="mt-2 text-[12px] font-semibold text-destructive">
                    Suma (zwrot + zostaje + strata) przekracza policzone {fmt(countedN, r.unit)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom bar */}
      {rowsReady && (
        <div className="fixed left-0 right-0 bottom-[83px] md:bottom-0 z-30 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={reconcile.isPending || hasOverAllocation}
            className={cn(
              'w-full rounded-xl py-3 text-base font-semibold transition-colors',
              !reconcile.isPending && !hasOverAllocation
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {reconcile.isPending
              ? 'Rozliczanie…'
              : rows.length === 0
                ? 'Zatwierdź — van pusty'
                : 'Zatwierdź rozliczenie'}
          </button>
        </div>
      )}
    </div>
  );
}

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

type Decision = 'return' | 'keep' | 'writeoff';

type ReconciliationRow = {
  productId: string;
  productName: string;
  unit: string;
  // This route
  loaded: number;       // from MM doc items
  sold: number;         // from WZ docs
  expectedThisRoute: number; // loaded - sold (delivered WZ only)
  totalVanStock: number;
  /** Stock from a previous route (product not on this route's MM). */
  carryOver: number;
  /** On draft/saved/in_transit WZ — still in van, not sold yet. */
  pendingWz: number;
  loadedOnThisRoute: boolean;
  // User inputs
  physicalCount: string;
  decision: Decision;
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

/* ─── Page ───────────────────────────────────────────────────────── */

export function VanReconciliationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const urlWarehouseId = searchParams.get('warehouse_id') ?? '';
  const urlRouteId = searchParams.get('route_id') ?? '';

  const reconcile = useVanReconciliationMutation();

  // Fetch route → to get mm_document id + date
  const { data: route } = useVanRouteQuery(urlRouteId || undefined);
  const mmDocId = route?.mm_document?.id;
  const routeDate = route?.date ?? '';

  // Fetch MM document (what was loaded)
  const { data: mmDoc } = useDeliveryQuery(mmDocId);

  // Fetch WZ docs issued from this van on this date (what was sold)
  const { data: vanWZDocs } = useVanRouteWZListQuery(urlRouteId || undefined);

  // Current van stock snapshot
  const { data: stockSnapshot, isLoading: snapshotLoading, isFetching: snapshotFetching } = useStockSnapshotQuery(
    urlWarehouseId || undefined,
  );

  // Result after submission
  const [result, setResult] = useState<VanReconciliationResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── Build rows ── */
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
    if (!rowsReady) return;

    // Only products currently in the van with stock > 0 — these need a decision
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
        physicalCount: String(totalVanStock),
        decision:
          carryOver > 0 || pendingWz > 0 || expectedThisRoute <= 0
            ? 'keep'
            : 'return',
      });
    }

    built.sort((a, b) => a.productName.localeCompare(b.productName, 'pl'));
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.productId, r]));
      return built.map((b) => {
        const p = prevById.get(b.productId);
        return p ? { ...b, physicalCount: p.physicalCount, decision: p.decision } : b;
      });
    });
  }, [rowsReady, stockSnapshot, mmDoc, soldByProductId, pendingWzByProductId, stockByProductId]);

  function updateRow(productId: string, field: 'physicalCount' | 'decision', value: string) {
    setRows((prev) =>
      prev.map((r) => (r.productId === productId ? { ...r, [field]: value } : r)),
    );
  }

  async function onSubmit() {
    setSubmitError(null);

    const returning = rows.filter((r) => r.decision === 'return');
    const writingOff = rows.filter((r) => r.decision === 'writeoff');

    for (const r of returning) {
      const q = parseQty(r.physicalCount);
      if (Number.isNaN(q) || q < 0) {
        setSubmitError(`Nieprawidłowa ilość dla: ${r.productName}`);
        return;
      }
    }

    // Always use explicit split mode (quantity_writeoff present) so the backend knows
    // exactly what to return, what to damage, and what stays in the van.
    // Kept rows are included with P=0, W=0 so they appear in the reconciliation summary.
    const kept = rows.filter((r) => r.decision === 'keep');
    const items = [
      ...returning.map((r) => ({
        product_id: r.productId,
        quantity_actual_remaining: parseQty(r.physicalCount).toFixed(3),
        quantity_writeoff: '0.000',
      })),
      ...writingOff.map((r) => ({
        product_id: r.productId,
        quantity_actual_remaining: '0.000',
        quantity_writeoff: parseQty(r.physicalCount).toFixed(3),
      })),
      ...kept.map((r) => ({
        product_id: r.productId,
        quantity_actual_remaining: '0.000',
        quantity_writeoff: '0.000',
      })),
    ];

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
    const kept = rows.filter((r) => r.decision === 'keep');
    const writtenOff = rows.filter((r) => r.decision === 'writeoff');
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

        {/* MM-P summary */}
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">Zwrot do magazynu głównego</p>
          {result.mm_return_number ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-500">
              Dokument MM-P: <span className="font-bold">{result.mm_return_number}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Brak produktów do zwrotu</p>
          )}
          <p className="text-[12px] text-muted-foreground">{formatReconciledLabel(result.reconciled_at)}</p>
        </div>

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

        {/* Written off */}
        {writtenOff.length > 0 && (
          <div className="rounded-2xl bg-destructive/5 border border-destructive/30 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-destructive">
              Odpisane (strata)
            </p>
            {writtenOff.map((r) => (
              <div key={r.productId} className="flex justify-between text-sm text-destructive">
                <span>{r.productName}</span>
                <span className="tabular-nums font-semibold">{fmt(r.totalVanStock, r.unit)}</span>
              </div>
            ))}
          </div>
        )}

        {result.discrepancies.length === 0 && !kept.length && !writtenOff.length && (
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
  const returningCount = rows.filter((r) => r.decision === 'return').length;
  const writingOffCount = rows.filter((r) => r.decision === 'writeoff').length;

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
              {route.van_name || route.van_warehouse_code} · {route.date}
            </p>
          )}
        </div>
      </div>

      {submitError && (
        <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      {pendingWzDocCount > 0 && (
        <p className="rounded-2xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" role="status">
          Masz {pendingWzDocCount}{' '}
          {pendingWzDocCount === 1 ? 'dokument WZ' : 'dokumenty WZ'} bez potwierdzonej dostawy.
          Potwierdź je na trasie przed rozliczeniem — inaczej „Sprzedano” będzie zaniżone.
        </p>
      )}

      {(snapshotLoading || snapshotFetching) && !rowsReady && (
        <div className="flex items-center justify-center py-16">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {rowsReady && rows.length === 0 && (
        <div className="rounded-2xl bg-surface-card px-4 py-10 text-center shadow-soft">
          <p className="font-semibold text-foreground">Van jest pusty</p>
          <p className="mt-1 text-sm text-muted-foreground">Brak towaru do rozliczenia.</p>
        </div>
      )}

      {rowsReady && rows.length > 0 && (
        <>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground px-1">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-primary/60 inline-block" />
              Z tej trasy
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />
              Z poprzedniej trasy
            </span>
          </div>

          {/* Rows */}
          <div className="flex flex-col gap-3">
            {rows.map((r) => {
              const physical = parseQty(r.physicalCount);
              const diff = physical - (r.decision === 'return' ? r.expectedThisRoute : 0);
              const hasDiff = r.decision === 'return' && Math.abs(physical - r.expectedThisRoute) > 0.001;

              return (
                <div
                  key={r.productId}
                  className={cn(
                    'rounded-2xl bg-surface-card px-4 py-3 shadow-soft',
                    (r.decision === 'keep' || r.decision === 'writeoff') && 'opacity-70',
                  )}
                >
                  {/* Product name + carry-over badge */}
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-semibold text-foreground">{r.productName}</span>
                    {r.carryOver > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        +{fmt(r.carryOver, r.unit)} z wcześniej
                      </span>
                    )}
                    {r.pendingWz > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        {fmt(r.pendingWz, r.unit)} — WZ niepotwierdzone
                      </span>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">Załadowano</p>
                      <p className="font-semibold tabular-nums text-foreground">{fmt(r.loaded, r.unit)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sprzedano</p>
                      <p className="font-semibold tabular-nums text-foreground">{fmt(r.sold, r.unit)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Oczekiwane</p>
                      <p className="font-semibold tabular-nums text-foreground">{fmt(r.expectedThisRoute, r.unit)}</p>
                    </div>
                  </div>

                  {/* Decision toggle */}
                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateRow(r.productId, 'decision', 'return')}
                      className={cn(
                        'flex-1 rounded-xl py-2 text-[12px] font-semibold transition-colors',
                        r.decision === 'return'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80',
                      )}
                    >
                      Zwrot do MG
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRow(r.productId, 'decision', 'keep')}
                      className={cn(
                        'flex-1 rounded-xl py-2 text-[12px] font-semibold transition-colors',
                        r.decision === 'keep'
                          ? 'bg-amber-400 text-white'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80',
                      )}
                    >
                      Zostaje w vanie
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRow(r.productId, 'decision', 'writeoff')}
                      className={cn(
                        'flex-1 rounded-xl py-2 text-[12px] font-semibold transition-colors',
                        r.decision === 'writeoff'
                          ? 'bg-destructive text-destructive-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80',
                      )}
                    >
                      Odpisz
                    </button>
                  </div>

                  {/* Physical count input — only when returning */}
                  {r.decision === 'return' && (
                    <div className="flex items-center gap-3">
                      <label className="text-[12px] text-muted-foreground shrink-0">Stan faktyczny</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={r.physicalCount}
                        onChange={(e) => updateRow(r.productId, 'physicalCount', e.target.value)}
                        className={cn(
                          'h-9 w-28 rounded-lg border bg-background px-2 text-right text-sm font-semibold',
                          hasDiff && physical < r.expectedThisRoute
                            ? 'border-destructive text-destructive'
                            : hasDiff && physical > r.expectedThisRoute
                              ? 'border-amber-400 text-amber-700'
                              : 'border-input text-foreground',
                        )}
                        aria-label={`Stan faktyczny ${r.productName}`}
                      />
                      <span className="text-[12px] text-muted-foreground">{r.unit}</span>
                      {hasDiff && (
                        <span className={cn(
                          'ml-auto text-[12px] font-semibold tabular-nums',
                          diff < 0 ? 'text-destructive' : 'text-amber-600',
                        )}>
                          {diff > 0 ? '+' : ''}{fmt(diff, r.unit)}
                        </span>
                      )}
                    </div>
                  )}

                  {r.decision === 'keep' && (
                    <p className="text-[12px] text-amber-600 dark:text-amber-400">
                      {fmt(r.totalVanStock, r.unit)} pozostaje w vanie — nie generuje MM-P
                    </p>
                  )}

                  {r.decision === 'writeoff' && (
                    <p className="text-[12px] text-destructive dark:text-destructive">
                      {fmt(r.totalVanStock, r.unit)} zostanie odpisane — stratna (DAMAGE)
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {submitError && (
            <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
        </>
      )}

      {/* Bottom bar */}
      {rowsReady && (
        <div className="fixed left-0 right-0 bottom-[83px] md:bottom-0 z-30 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={reconcile.isPending}
            className={cn(
              'w-full rounded-xl py-3 text-base font-semibold transition-colors',
              !reconcile.isPending
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {reconcile.isPending
              ? 'Rozliczanie…'
              : (() => {
                  if (rows.length === 0) return 'Zatwierdź — van pusty, zamknij trasę';
                  const parts = [];
                  if (returningCount > 0) parts.push(`zwróć ${returningCount} poz. do MG`);
                  if (writingOffCount > 0) parts.push(`odpisz ${writingOffCount} poz.`);
                  return parts.length > 0 ? `Zatwierdź — ${parts.join(', ')}` : 'Zatwierdź — wszystko zostaje w vanie';
                })()}
          </button>
        </div>
      )}
    </div>
  );
}

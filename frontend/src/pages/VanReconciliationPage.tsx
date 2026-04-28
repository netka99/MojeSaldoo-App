import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { authStorage } from '@/services/api';
import { warehouseService } from '@/services/warehouse.service';
import { productService } from '@/services/product.service';
import { useVanReconciliationMutation } from '@/query/use-delivery';
import { cn } from '@/lib/utils';
import type { Warehouse } from '@/types';
import type { StockSnapshotItem } from '@/types';
import type { VanReconciliationResult } from '@/types';
import type { VanReconciliationPayload } from '@/types';

// One row in the reconciliation table: snapshot data + the user's "actual count" input
type ReconciliationRow = {
  productId: string;
  productName: string;
  sku: string | null;
  unit: string;
  quantityExpected: number; // from stock snapshot
  quantityActual: string; // user input (controlled, string)
};

function parseQty(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function discrepancy(expected: number, actual: string): number {
  return parseQty(actual) - expected;
}

function formatDiscrepancy(diff: number, unit: string): string {
  if (diff === 0) return '—';
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toLocaleString('pl-PL', { maximumFractionDigits: 3 })} ${unit}`.trim();
}

function discrepancyClass(diff: number): string {
  if (diff === 0) return 'text-muted-foreground';
  if (diff < 0) return 'text-destructive font-semibold';
  return 'text-amber-600 font-semibold';
}

function formatReconciledLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

export function VanReconciliationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  const reconcile = useVanReconciliationMutation();

  // Phase: 'select-warehouse' | 'enter-counts' | 'result'
  const [phase, setPhase] = useState<'select-warehouse' | 'enter-counts' | 'result'>('select-warehouse');

  // Step 1: which van warehouse to reconcile
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [reconciliationDate, setReconciliationDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState<string>('');

  // Step 2: rows populated from stock snapshot
  const [rows, setRows] = useState<ReconciliationRow[]>([]);

  // Validation error (shown below the form)
  const [formError, setFormError] = useState<string | null>(null);

  // API submit error
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Result from the API after successful reconciliation
  const [result, setResult] = useState<VanReconciliationResult | null>(null);

  // Fetch mobile warehouses — only "mobile" type
  const { data: mobileWarehousesData, isLoading: warehousesLoading } = useQuery({
    queryKey: ['warehouses', 'mobile', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'mobile', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mobileWarehouses: Warehouse[] = mobileWarehousesData?.results ?? [];
  const selectedWarehouseName =
    mobileWarehouses.find((w) => w.id === selectedWarehouseId)?.name ?? '—';

  // Fetch stock snapshot for selected warehouse — only when user confirmed Step 1
  // We fetch this imperatively (manual trigger), so we use `enabled: false` and refetch on demand.
  // Use a simple useQuery with `enabled` tied to `phase === 'enter-counts'`
  const {
    isLoading: snapshotLoading,
    isError: snapshotError,
    refetch: fetchSnapshot,
  } = useQuery({
    queryKey: ['stock-snapshot', selectedWarehouseId],
    queryFn: () => productService.fetchStockSnapshot(selectedWarehouseId),
    enabled: false, // manual only
  });

  function handleSelectWarehouse() {
    if (!selectedWarehouseId) {
      setFormError('Wybierz magazyn (van)');
      return;
    }
    if (!reconciliationDate) {
      setFormError('Podaj datę rozliczenia');
      return;
    }
    setFormError(null);
    setPhase('enter-counts');

    // Fetch stock snapshot for the selected warehouse
    void fetchSnapshot().then((res) => {
      const items: StockSnapshotItem[] = res.data?.items ?? [];

      if (items.length === 0) {
        // Empty van — pre-fill rows as empty, show informational state
        setRows([]);
      } else {
        // Map snapshot to editable rows — actual count defaults to expected (zero discrepancy)
        setRows(
          items.map((item) => ({
            productId: item.product_id,
            productName: item.product_name,
            sku: item.sku,
            unit: item.unit,
            quantityExpected: parseFloat(item.quantity_available),
            quantityActual: item.quantity_available, // default = expected
          })),
        );
      }
    });
  }

  function updateRowActual(productId: string, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.productId === productId ? { ...r, quantityActual: value } : r)),
    );
  }

  function goBackToWarehouseSelect() {
    setPhase('select-warehouse');
    setRows([]);
    setFormError(null);
    setSubmitError(null);
  }

  // Computed — rows with discrepancies (actual ≠ expected)
  const rowsWithDiscrepancy = rows.filter(
    (r) => Math.abs(discrepancy(r.quantityExpected, r.quantityActual)) > 0.0001,
  );
  const hasAnyDiscrepancy = rowsWithDiscrepancy.length > 0;

  async function onSubmit() {
    // Validate all actual counts are valid numbers
    for (const r of rows) {
      const q = parseQty(r.quantityActual);
      if (Number.isNaN(q) || q < 0) {
        setSubmitError(`Nieprawidłowa ilość dla: ${r.productName}`);
        return;
      }
    }
    setSubmitError(null);

    const payload: VanReconciliationPayload = {
      items: rows.map((r) => ({
        product_id: r.productId,
        quantity_actual_remaining: parseQty(r.quantityActual).toFixed(3),
      })),
    };

    try {
      const res = await reconcile.mutateAsync({ warehouseId: selectedWarehouseId, data: payload });
      setResult(res);
      setPhase('result');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się rozliczyć vana');
    }
  }

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/delivery')}>
          ← Dokumenty dostawy
        </Button>
        <h1 className="text-2xl font-semibold">Rozlicz Van</h1>
      </div>

      {/* ERROR BANNER */}
      {(formError || submitError) && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {formError || submitError}
        </p>
      )}

      {/* PHASE 1, 2, 3 rendered below based on phase state */}

      {phase === 'select-warehouse' && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 1 — Wybierz van do rozliczenia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Wybierz mobilny magazyn (van), który chcesz rozliczyć. System pokaże aktualny stan
              magazynu vana — wpisz ile faktycznie zostało na vannie.
            </p>

            {/* VAN WAREHOUSE SELECTOR */}
            <div>
              <label htmlFor="van-warehouse-select" className="mb-1 block text-sm font-medium">
                Magazyn (van)
              </label>
              {warehousesLoading ? (
                <p className="text-sm text-muted-foreground">Ładowanie magazynów…</p>
              ) : (
                <select
                  id="van-warehouse-select"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                >
                  <option value="">— wybierz —</option>
                  {mobileWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              )}
              {!warehousesLoading && mobileWarehouses.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Brak mobilnych magazynów (typ: mobile). Utwórz van w ustawieniach magazynów.
                </p>
              )}
            </div>

            {/* RECONCILIATION DATE */}
            <Input
              id="reconciliation-date"
              label="Data rozliczenia"
              type="date"
              value={reconciliationDate}
              onChange={(e) => setReconciliationDate(e.target.value)}
              required
            />

            {/* NOTES */}
            <div>
              <label htmlFor="reconciliation-notes" className="mb-1 block text-sm font-medium">
                Notatki (opcjonalnie)
              </label>
              <textarea
                id="reconciliation-notes"
                className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="np. koniec trasy, uwagi do niedoborów…"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={handleSelectWarehouse}>
                Dalej
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === 'enter-counts' && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 2 — Wpisz stan faktyczny</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Dla każdego produktu wpisz ile faktycznie jest na vannie. Różnice zostaną zaznaczone na
              czerwono (niedobór) lub żółto (nadwyżka). Produkty bez różnicy nie generują ruchów
              magazynowych.
            </p>

            {/* LOADING STATE */}
            {snapshotLoading && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Ładowanie stanu magazynu vana…
              </p>
            )}

            {/* ERROR STATE */}
            {snapshotError && !snapshotLoading && (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                Nie udało się załadować stanu magazynu. Sprawdź połączenie i spróbuj ponownie.
              </p>
            )}

            {/* EMPTY VAN STATE */}
            {!snapshotLoading && !snapshotError && rows.length === 0 && (
              <div className="rounded-md bg-muted/40 px-4 py-6 text-center">
                <p className="text-sm font-medium text-foreground">Van jest pusty</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ten magazyn nie ma żadnych produktów w stanie dostępnym. Nie ma czego rozliczać.
                </p>
              </div>
            )}

            {/* RECONCILIATION TABLE */}
            {!snapshotLoading && rows.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 font-medium">Produkt</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 text-right font-medium">Stan wg systemu</th>
                        <th className="px-3 py-2 text-right font-medium">J.m.</th>
                        <th className="w-36 px-3 py-2 font-medium">Stan faktyczny</th>
                        <th className="px-3 py-2 text-right font-medium">Różnica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const diff = discrepancy(r.quantityExpected, r.quantityActual);
                        const hasDiff = Math.abs(diff) > 0.0001;
                        return (
                          <tr
                            key={r.productId}
                            className={cn(
                              'border-t border-border',
                              hasDiff && diff < 0 && 'bg-destructive/5',
                              hasDiff && diff > 0 && 'bg-amber-50',
                            )}
                          >
                            <td className="px-3 py-2 font-medium text-foreground">
                              {r.productName}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {r.sku || '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-sm text-muted-foreground">
                              {r.quantityExpected.toLocaleString('pl-PL', {
                                maximumFractionDigits: 3,
                              })}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{r.unit || '—'}</td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                className={cn(
                                  'h-9 w-28 rounded-md border bg-background px-2 text-right text-sm',
                                  hasDiff && diff < 0
                                    ? 'border-destructive text-destructive font-semibold'
                                    : hasDiff && diff > 0
                                      ? 'border-amber-400 text-amber-700 font-semibold'
                                      : 'border-input text-foreground',
                                )}
                                value={r.quantityActual}
                                onChange={(e) => updateRowActual(r.productId, e.target.value)}
                                aria-label={`Ilość faktyczna: ${r.productName}`}
                              />
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2 text-right font-mono text-sm',
                                discrepancyClass(diff),
                              )}
                            >
                              {formatDiscrepancy(diff, r.unit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border">
                        <td colSpan={5} className="px-3 py-2 text-sm font-medium">
                          {hasAnyDiscrepancy ? (
                            <span className="text-destructive">
                              Wykryto różnice w {rowsWithDiscrepancy.length} pozycjach
                            </span>
                          ) : (
                            <span className="text-green-700">Brak różnic — wszystko się zgadza</span>
                          )}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* DISCREPANCY LEGEND */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-destructive/20" />
                    Niedobór (szkody / zgubione)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-amber-100" />
                    Nadwyżka (korekta)
                  </span>
                </div>
              </>
            )}

            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button type="button" variant="outline" onClick={goBackToWarehouseSelect}>
                Wstecz
              </Button>
              {rows.length > 0 && (
                <Button
                  type="button"
                  onClick={() => void onSubmit()}
                  disabled={reconcile.isPending}
                >
                  {reconcile.isPending ? 'Rozliczanie…' : 'Zatwierdź rozliczenie'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {phase === 'result' && result !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Rozliczenie zakończone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 rounded-md bg-muted/40 px-4 py-3 text-sm">
              <p>
                <span className="text-muted-foreground">Magazyn: </span>
                <span className="font-semibold">{selectedWarehouseName}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Rozliczono: </span>
                <span className="font-medium">{formatReconciledLabel(result.reconciled_at)}</span>
              </p>
              {result.discrepancies.length > 0 ? (
                <p className="text-destructive font-medium">
                  Zarejestrowano {result.discrepancies.length}{' '}
                  {result.discrepancies.length === 1 ? 'różnicę' : 'różnic'} w stanach
                </p>
              ) : (
                <p className="text-green-700 font-medium">
                  Brak różnic — stan vana zgadzał się z systemem
                </p>
              )}
            </div>

            {/* RESULT TABLE — only show if there were discrepancies */}
            {result.discrepancies.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">Produkt</th>
                      <th className="px-3 py-2 text-right font-medium">Oczekiwano</th>
                      <th className="px-3 py-2 text-right font-medium">Faktycznie</th>
                      <th className="px-3 py-2 text-right font-medium">Różnica</th>
                      <th className="px-3 py-2 font-medium">Typ ruchu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.discrepancies.map((item) => {
                      const diff = parseFloat(item.quantity_delta);
                      return (
                        <tr
                          key={item.product_id}
                          className={cn(
                            'border-t border-border',
                            diff < 0 && 'bg-destructive/5',
                            diff > 0 && 'bg-amber-50',
                          )}
                        >
                          <td className="px-3 py-2 font-medium">{item.product_name}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                            {parseFloat(item.quantity_expected).toLocaleString('pl-PL', {
                              maximumFractionDigits: 3,
                            })}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            {parseFloat(item.quantity_actual).toLocaleString('pl-PL', {
                              maximumFractionDigits: 3,
                            })}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-2 text-right font-mono text-sm',
                              discrepancyClass(diff),
                            )}
                          >
                            {formatDiscrepancy(diff, '')}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-medium',
                                item.discrepancy_type === 'damage'
                                  ? 'bg-destructive/10 text-destructive'
                                  : 'bg-amber-100 text-amber-800',
                              )}
                            >
                              {item.discrepancy_type === 'damage' ? 'Szkoda/niedobór' : 'Korekta'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate('/delivery')}>
                Wróć do listy dokumentów
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  // Reset for a new reconciliation
                  setPhase('select-warehouse');
                  setSelectedWarehouseId('');
                  setRows([]);
                  setResult(null);
                  setFormError(null);
                  setSubmitError(null);
                }}
              >
                Rozlicz kolejny van
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

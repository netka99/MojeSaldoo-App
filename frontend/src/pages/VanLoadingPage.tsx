import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { authStorage } from '@/services/api';
import { productService } from '@/services/product.service';
import { warehouseService } from '@/services/warehouse.service';
import { useVanLoadingMutation } from '@/query/use-delivery';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';
import type { Warehouse } from '@/types';
import type { VanLoadingPayload } from '@/types';

type Step = 1 | 2 | 3;

type ProductRow = {
  product: Product;
  quantity: string; // controlled input value, e.g. "5" or "0"
};

function formatQty(q: string, unit: string): string {
  const n = parseFloat(q);
  if (!Number.isFinite(n) || n === 0) return '0';
  return `${n} ${unit}`.trim();
}

function parseQty(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function VanLoadingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  const vanLoading = useVanLoadingMutation();

  // Step tracking
  const [step, setStep] = useState<Step>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 1 fields
  const [fromWarehouseId, setFromWarehouseId] = useState<string>('');
  const [toWarehouseId, setToWarehouseId] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [driverName, setDriverName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Step 2: product rows — one row per active product fetched from API
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [productSearch, setProductSearch] = useState<string>('');

  // Success state (after submit)
  const [createdDocument, setCreatedDocument] = useState<{ id: string; document_number: string | null } | null>(null);

  // Fetch main warehouses (from_warehouse selector)
  const { data: mainWarehousesData, isLoading: mainWarehousesLoading } = useQuery({
    queryKey: ['warehouses', 'main', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'main', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mainWarehouses: Warehouse[] = mainWarehousesData?.results ?? [];

  // Fetch mobile warehouses (to_warehouse selector)
  const { data: mobileWarehousesData, isLoading: mobileWarehousesLoading } = useQuery({
    queryKey: ['warehouses', 'mobile', companyId],
    queryFn: () => warehouseService.fetchList({ warehouse_type: 'mobile', is_active: true, ordering: 'code' }),
    enabled: Boolean(companyId),
  });
  const mobileWarehouses: Warehouse[] = mobileWarehousesData?.results ?? [];

  // Fetch ALL active products for the loading table (step 2)
  const { data: productData, isLoading: productsLoading } = useQuery({
    queryKey: ['products', 'van-loading', companyId],
    queryFn: () => productService.fetchList({ page: 1, is_active: true, ordering: 'name', page_size: 200 }),
    enabled: Boolean(companyId),
  });

  // TanStack Query v5: useQuery has no onSuccess — sync rows when catalog loads (preserve quantities on refetch)
  useEffect(() => {
    if (!productData?.results?.length) return;
    setRows((prev) => {
      const qtyById = new Map(prev.map((r) => [r.product.id, r.quantity]));
      return productData.results.map((p) => ({
        product: p,
        quantity: qtyById.get(p.id) ?? '0',
      }));
    });
  }, [productData]);

  // Filtered rows for the product table in step 2 (search by name or SKU)
  const filteredRows = productSearch.trim()
    ? rows.filter(
        (r) =>
          r.product.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          (r.product.sku ?? '').toLowerCase().includes(productSearch.toLowerCase()),
      )
    : rows;

  // Rows that will actually be loaded (quantity > 0)
  const loadedRows = rows.filter((r) => parseQty(r.quantity) > 0);

  // Computed: total number of product types being loaded
  const totalProductTypes = loadedRows.length;

  // Helper: get warehouse name by id
  const warehouseName = (id: string, list: Warehouse[]) => list.find((w) => w.id === id)?.name ?? id;

  function validateStep1(): boolean {
    if (!fromWarehouseId) {
      setStepError('Wybierz magazyn źródłowy (MG)');
      return false;
    }
    if (!toWarehouseId) {
      setStepError('Wybierz magazyn docelowy (van)');
      return false;
    }
    if (fromWarehouseId === toWarehouseId) {
      setStepError('Magazyn źródłowy i docelowy nie mogą być takie same');
      return false;
    }
    if (!issueDate) {
      setStepError('Podaj datę załadunku');
      return false;
    }
    setStepError(null);
    return true;
  }

  function validateStep2(): boolean {
    if (loadedRows.length === 0) {
      setStepError('Podaj ilość dla co najmniej jednego produktu');
      return false;
    }
    for (const r of loadedRows) {
      const q = parseQty(r.quantity);
      if (q <= 0) {
        setStepError(`Nieprawidłowa ilość dla: ${r.product.name}`);
        return false;
      }
    }
    setStepError(null);
    return true;
  }

  function goNext() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStepError(null);
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStepError(null);
      setStep(3);
    }
  }

  function goBack() {
    setStepError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  async function onSubmit() {
    if (!validateStep1() || !validateStep2()) {
      setStep(1);
      return;
    }
    setSubmitError(null);

    const payload: VanLoadingPayload = {
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      issue_date: issueDate,
      driver_name: driverName.trim() || undefined,
      notes: notes.trim() || undefined,
      items: loadedRows.map((r) => ({
        product_id: r.product.id,
        quantity: parseQty(r.quantity).toFixed(3),
      })),
    };

    try {
      const doc = await vanLoading.mutateAsync(payload);
      setCreatedDocument({ id: doc.id, document_number: doc.document_number });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się załadować vana');
    }
  }

  function updateRowQty(productId: string, value: string) {
    setRows((prev) => prev.map((r) => (r.product.id === productId ? { ...r, quantity: value } : r)));
  }

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (createdDocument) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Van załadowany</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Dokument MM został wygenerowany pomyślnie.</p>
            <div className="rounded-md bg-muted/40 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Nr dokumentu: </span>
              <span className="font-semibold">{createdDocument.document_number ?? '—'}</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate(`/delivery/${createdDocument.id}`)}>
                Zobacz dokument MM
              </Button>
              <Button onClick={() => navigate('/delivery')}>Wróć do listy dokumentów</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/delivery')}>
          ← Dokumenty dostawy
        </Button>

        <ol className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Kroki">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                  step === n
                    ? 'bg-primary text-primary-foreground'
                    : step > n
                      ? 'bg-muted-foreground/20 text-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
                aria-current={step === n ? 'step' : undefined}
              >
                {n}
              </span>
              <span className={cn('hidden sm:inline', step === n && 'font-medium text-foreground')}>
                {n === 1 ? 'Magazyny' : n === 2 ? 'Produkty' : 'Podsumowanie'}
              </span>
              {n < 3 && <span className="text-border">|</span>}
            </li>
          ))}
        </ol>
      </div>

      <h1 className="text-2xl font-semibold">Załaduj Van</h1>

      {(stepError || submitError) && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {stepError || submitError}
        </p>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 1 — Magazyny i data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* FROM WAREHOUSE — main type only */}
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="from-warehouse">
                Magazyn źródłowy (MG)
              </label>
              {mainWarehousesLoading ? (
                <p className="text-sm text-muted-foreground">Ładowanie…</p>
              ) : (
                <select
                  id="from-warehouse"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              )}
              {mainWarehouses.length === 0 && !mainWarehousesLoading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Brak magazynów głównych (typ: main). Utwórz magazyn w ustawieniach.
                </p>
              )}
            </div>

            {/* TO WAREHOUSE — mobile type only */}
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="to-warehouse">
                Magazyn docelowy (van)
              </label>
              {mobileWarehousesLoading ? (
                <p className="text-sm text-muted-foreground">Ładowanie…</p>
              ) : (
                <select
                  id="to-warehouse"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              )}
              {mobileWarehouses.length === 0 && !mobileWarehousesLoading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Brak vana/mobilnych magazynów (typ: mobile). Utwórz magazyn w ustawieniach.
                </p>
              )}
            </div>

            {/* ISSUE DATE */}
            <Input
              id="van-issue-date"
              label="Data załadunku"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              required
            />

            {/* DRIVER NAME — optional */}
            <Input
              id="van-driver-name"
              label="Imię i nazwisko kierowcy (opcjonalnie)"
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="np. Jan Kowalski"
            />

            {/* NOTES — optional */}
            <div>
              <label htmlFor="van-notes" className="mb-1 block text-sm font-medium">
                Notatki (opcjonalnie)
              </label>
              <textarea
                id="van-notes"
                className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" onClick={goNext}>
                Dalej
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 2 — Produkty do załadunku</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Wpisz ilość każdego produktu, który chcesz załadować. Produkty z ilością 0 zostaną pominięte.
            </p>

            {/* SEARCH FILTER */}
            <input
              type="text"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Szukaj produktu po nazwie lub SKU…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              aria-label="Filtruj produkty"
            />

            {/* PRODUCT TABLE */}
            {productsLoading ? (
              <p className="text-sm text-muted-foreground">Ładowanie produktów…</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">Produkt</th>
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">J.m.</th>
                      <th className="w-32 px-3 py-2 font-medium">Ilość do załadunku</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                          Brak produktów
                        </td>
                      </tr>
                    )}
                    {filteredRows.map((r) => {
                      const qty = parseQty(r.quantity);
                      const isLoaded = qty > 0;
                      return (
                        <tr
                          key={r.product.id}
                          className={cn(
                            'border-t border-border',
                            isLoaded && 'bg-primary/5',
                          )}
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            {r.product.name}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {r.product.sku || '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.product.unit || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              className={cn(
                                'h-9 w-28 rounded-md border bg-background px-2 text-right text-sm',
                                isLoaded
                                  ? 'border-primary text-foreground font-semibold'
                                  : 'border-input text-muted-foreground',
                              )}
                              value={r.quantity}
                              onChange={(e) => updateRowQty(r.product.id, e.target.value)}
                              placeholder="0"
                              aria-label={`Ilość ${r.product.name}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* RUNNING TOTAL SUMMARY */}
            <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
              <p className="text-sm font-medium">
                Załadowanych pozycji: <span className="text-primary">{totalProductTypes}</span>
                {totalProductTypes > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (
                    {loadedRows
                      .map((r) => `${formatQty(r.quantity, r.product.unit || '')}`)
                      .join(', ')
                      .slice(0, 80)}
                    )
                  </span>
                )}
              </p>
            </div>

            <div className="flex justify-between gap-2 pt-2">
              <Button type="button" variant="outline" onClick={goBack}>
                Wstecz
              </Button>
              <Button type="button" onClick={goNext}>
                Dalej
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Krok 3 — Podsumowanie i załadunek</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* WAREHOUSE & DATE SUMMARY */}
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Z magazynu (MG):</span>{' '}
                <span className="font-medium">{warehouseName(fromWarehouseId, mainWarehouses)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Do vana:</span>{' '}
                <span className="font-medium">{warehouseName(toWarehouseId, mobileWarehouses)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Data załadunku:</span>{' '}
                <span className="font-medium">{issueDate}</span>
              </p>
              {driverName.trim() && (
                <p>
                  <span className="text-muted-foreground">Kierowca:</span>{' '}
                  <span className="font-medium">{driverName}</span>
                </p>
              )}
            </div>

            {/* PRODUCT REVIEW TABLE */}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[360px] text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">Produkt</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 text-right font-medium">Ilość</th>
                    <th className="px-3 py-2 font-medium">J.m.</th>
                  </tr>
                </thead>
                <tbody>
                  {loadedRows.map((r) => (
                    <tr key={r.product.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{r.product.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.product.sku || '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {parseQty(r.quantity).toLocaleString('pl-PL')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.product.unit || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border">
                    <td colSpan={2} className="px-3 py-2 font-semibold">
                      Razem pozycji
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-primary">
                      {totalProductTypes}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {notes.trim() && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">Notatki:</span> {notes}
              </p>
            )}

            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button type="button" variant="outline" onClick={goBack}>
                Wstecz
              </Button>
              <Button
                type="button"
                onClick={() => void onSubmit()}
                disabled={vanLoading.isPending}
              >
                {vanLoading.isPending ? 'Trwa załadunek…' : 'Załaduj Van'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

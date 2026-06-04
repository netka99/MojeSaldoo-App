import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { WarehouseForm } from '@/components/features/warehouses/WarehouseForm';
import { Accordion } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  useDeleteWarehouseMutation,
  useUpdateWarehouseMutation,
  useWarehouseQuery,
  useWarehouseStockQuery,
} from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import type { WarehouseStockItem, WarehouseWrite } from '@/types';

function fmt(v: string | number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${s} ${unit}` : s;
}

function StockBadge({ item }: { item: WarehouseStockItem }) {
  if (item.is_below_minimum) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
        ⚠ Poniżej min.
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
      OK
    </span>
  );
}

export function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const warehouseQ = useWarehouseQuery(id);
  const update = useUpdateWarehouseMutation();
  const remove = useDeleteWarehouseMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Stock filter state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showBelowMin, setShowBelowMin] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const stockQ = useWarehouseStockQuery(id, {
    search: search || undefined,
    below_minimum: showBelowMin || undefined,
  });

  const stockItems = useMemo(
    () => stockQ.data ?? [],
    [stockQ.data],
  );

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!id) {
    return <Navigate to="/warehouses" replace />;
  }

  const warehouse = warehouseQ.data;

  const handleDelete = async () => {
    if (!warehouse) return;
    if (!window.confirm(`Usunąć magazyn ${warehouse.code} (${warehouse.name})?`)) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(warehouse.id);
      navigate('/warehouses');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Usunięcie nie powiodło się');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
          Wróć do listy
        </Button>
      </div>

      {warehouseQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie magazynu…</p>}

      {warehouseQ.isError && (
        <div
          className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {warehouseQ.error instanceof Error ? warehouseQ.error.message : 'Nie udało się wczytać magazynu'}
        </div>
      )}

      {warehouse && (
        <>
          <Card className="shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">
                    {warehouse.code} — {warehouse.name}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Stan produktów w tym magazynie.</p>
                </div>
                {/* search + filter controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <svg
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
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
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Szukaj produktu…"
                      className="h-8 rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      aria-label="Szukaj produktu"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showBelowMin}
                      onChange={(e) => setShowBelowMin(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Tylko poniżej min.
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {stockQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie stanów…</p>}
              {stockQ.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {stockQ.error instanceof Error ? stockQ.error.message : 'Nie udało się wczytać stanu magazynu'}
                </p>
              )}
              {!stockQ.isLoading && !stockQ.isError && stockItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {search || showBelowMin ? 'Brak wyników dla tych filtrów.' : 'Brak pozycji na tym magazynie.'}
                </p>
              )}
              {!stockQ.isLoading && !stockQ.isError && stockItems.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Produkt
                        </th>
                        <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                          SKU
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Dostępne
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Zarezerwowane
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Razem
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Min. stan
                        </th>
                        <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                          Status
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Korekta
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {stockItems.map((row) => (
                        <tr
                          key={row.id}
                          className={row.is_below_minimum ? 'bg-red-50/40' : undefined}
                        >
                          <td className="max-w-[200px] truncate px-4 py-3">
                            <Link
                              to={`/products/${row.product_id}/edit`}
                              className="text-foreground underline-offset-2 hover:text-primary hover:underline"
                            >
                              {row.product_name}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                            {row.product_sku ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                            {fmt(row.quantity_available, row.product_unit)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {fmt(row.quantity_reserved, row.product_unit)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-foreground">
                            {fmt(row.quantity_total, row.product_unit)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {fmt(row.min_stock_alert)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StockBadge item={row} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <Link
                              to={`/products/${row.product_id}/adjust-stock`}
                              className="text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/90"
                            >
                              Koryguj
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Accordion
            title="Ustawienia magazynu"
            description="Edycja danych, opcji oraz trwałe usunięcie magazynu"
            defaultOpen={false}
          >
            <div className="space-y-6">
              {submitError && (
                <p
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {submitError}
                </p>
              )}
              <WarehouseForm
                warehouse={warehouse}
                presentation="embedded"
                submitLabel="Zapisz ustawienia"
                onSubmit={async (data: WarehouseWrite) => {
                  setSubmitError(null);
                  try {
                    await update.mutateAsync({ id: warehouse.id, body: data });
                  } catch (e) {
                    setSubmitError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian');
                  }
                }}
                onCancel={() => navigate(-1)}
                isLoading={update.isPending}
              />

              <div className="border-t border-border pt-6">
                {deleteError && (
                  <p
                    className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    role="alert"
                  >
                    {deleteError}
                  </p>
                )}
                <p className="text-sm font-medium text-foreground">Usuń magazyn</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Usunięcie jest nieodwracalne. Nie usuwaj magazynu, jeśli nadal są na nim dokumenty lub rezerwacje.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-3"
                  disabled={remove.isPending}
                  loading={remove.isPending}
                  onClick={() => void handleDelete()}
                >
                  Usuń magazyn
                </Button>
              </div>
            </div>
          </Accordion>
        </>
      )}
    </div>
  );
}

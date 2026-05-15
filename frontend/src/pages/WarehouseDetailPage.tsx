import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { WarehouseForm } from '@/components/features/warehouses/WarehouseForm';
import { Accordion } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useStockSnapshotQuery } from '@/query/use-products';
import {
  useDeleteWarehouseMutation,
  useUpdateWarehouseMutation,
  useWarehouseQuery,
} from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import type { StockSnapshotItem, WarehouseWrite } from '@/types';

function snapshotItemsSorted(items: StockSnapshotItem[]): StockSnapshotItem[] {
  return [...items].sort((a, b) => a.product_name.localeCompare(b.product_name, 'pl', { sensitivity: 'base' }));
}

export function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const warehouseQ = useWarehouseQuery(id);
  const stockQ = useStockSnapshotQuery(id);
  const update = useUpdateWarehouseMutation();
  const remove = useDeleteWarehouseMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => snapshotItemsSorted(stockQ.data?.items ?? []),
    [stockQ.data?.items],
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
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/warehouses')}>
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
              <CardTitle className="text-lg">
                {warehouse.code} — {warehouse.name}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Stan produktów w tym magazynie.</p>
            </CardHeader>
            <CardContent className="pt-6">
              {stockQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie stanów…</p>}
              {stockQ.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {stockQ.error instanceof Error ? stockQ.error.message : 'Nie udało się wczytać stanu magazynu'}
                </p>
              )}
              {!stockQ.isLoading && !stockQ.isError && sortedItems.length === 0 && (
                <p className="text-sm text-muted-foreground">Brak pozycji na tym magazynie.</p>
              )}
              {!stockQ.isLoading && !stockQ.isError && sortedItems.length > 0 && (
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
                          Ilość
                        </th>
                        <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                          Jedn.
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Korekta stanu
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {sortedItems.map((row) => (
                        <tr key={row.product_id}>
                          <td className="max-w-[200px] truncate px-4 py-3 text-foreground">{row.product_name}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                            {row.sku ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                            {row.quantity_available}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{row.unit}</td>
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
                onCancel={() => navigate('/warehouses')}
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

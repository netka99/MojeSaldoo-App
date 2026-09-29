import { Navigate, useLocation } from 'react-router-dom';
import { useSilentWarehouse } from '@/hooks/useSilentWarehouse';
import { useWarehouseStockQuery } from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

function fmt(v: string | number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${s} ${unit}` : s;
}

/** Stock of the implicit MG — used when warehouse management is off. */
export function StockPage() {
  const location = useLocation();
  const { warehouseId, warehouseName, isLoading } = useSilentWarehouse();
  const stockQ = useWarehouseStockQuery(warehouseId || undefined);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const items = stockQ.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Stany</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Co weszło z zakupu i co zeszło na produkcję albo WZ
          {warehouseName ? ` (${warehouseName})` : ''}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Towar na stanie</CardTitle>
        </CardHeader>
        <CardContent>
          {(isLoading || stockQ.isLoading) && (
            <p className="text-sm text-muted-foreground">Ładowanie…</p>
          )}
          {stockQ.isError && (
            <p className="text-sm text-destructive" role="alert">
              Nie udało się wczytać stanów.
            </p>
          )}
          {!isLoading && !warehouseId && (
            <p className="text-sm text-muted-foreground">
              Brak stanów. Przyjmij towar na stan (skan lub PZ), aby tu coś zobaczyć.
            </p>
          )}
          {!stockQ.isLoading && warehouseId && items.length === 0 && (
            <p className="text-sm text-muted-foreground">Na razie pusto.</p>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Produkt</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Dostępne</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Razem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-medium text-foreground">{row.product_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmt(row.quantity_available, row.product_unit)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmt(row.quantity_total, row.product_unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

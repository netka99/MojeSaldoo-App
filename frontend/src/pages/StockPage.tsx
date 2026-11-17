import { Navigate, useLocation, Link } from 'react-router-dom';
import { useSilentWarehouse } from '@/hooks/useSilentWarehouse';
import { useWarehouseStockQuery } from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import type { WarehouseStockItem } from '@/types/warehouse.types';

function fmt(v: string | number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${s} ${unit}` : s;
}

const GROUP_ORDER = ['finished', 'material', 'trade', 'service', null] as const;
const GROUP_LABEL: Record<string, string> = {
  finished: 'Wyroby gotowe',
  material: 'Surowce',
  trade: 'Towary handlowe',
  service: 'Usługi',
};

function StockTable({ items }: { items: WarehouseStockItem[] }) {
  return (
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
            <tr key={row.id} className="transition-colors hover:bg-muted/30">
              <td className="px-4 py-3 font-medium text-foreground">
                <Link to={`/products/${row.product_id}`} className="hover:text-primary hover:underline">
                  {row.product_name}
                </Link>
              </td>
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
  );
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

  // Group by product_type
  const groups = GROUP_ORDER
    .map((type) => ({
      type,
      label: type ? (GROUP_LABEL[type] ?? type) : 'Pozostałe',
      items: items.filter((r) => (r.product_type ?? null) === type),
    }))
    .filter((g) => g.items.length > 0);

  // If all items have the same type (or no type info), show flat list
  const showGrouped = groups.length > 1;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Stany</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Co weszło z zakupu i co zeszło na produkcję albo WZ
          {warehouseName ? ` (${warehouseName})` : ''}.
        </p>
      </div>

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

      {items.length > 0 && showGrouped && (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.type ?? 'null'} className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
                <h2 className="text-sm font-semibold text-slate-900">{g.label}</h2>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {g.items.length}
                </span>
              </div>
              <div className="p-4">
                <StockTable items={g.items} />
              </div>
            </section>
          ))}
        </div>
      )}

      {items.length > 0 && !showGrouped && (
        <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-900">Towar na stanie</h2>
          </div>
          <div className="p-4">
            <StockTable items={items} />
          </div>
        </section>
      )}
    </div>
  );
}

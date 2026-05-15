import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import { WAREHOUSE_TYPE_LABELS_PL, type Warehouse } from '@/types';

const PAGE_SIZE = 20;

function warehouseCountLabel(count: number): string {
  if (count === 1) return '1 magazyn';
  const n = count % 10;
  const n100 = count % 100;
  if (n >= 2 && n <= 4 && (n100 < 10 || n100 >= 20)) return `${count} magazyny`;
  return `${count} magazynów`;
}

export interface WarehouseListProps {
  onRowClick?: (warehouse: Warehouse) => void;
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się wczytać magazynów';
}

export function WarehouseList({ onRowClick }: WarehouseListProps) {
  const [page, setPage] = useState(1);
  const { data, isFetching, isError, error, refetch } = useWarehouseListQuery(page);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <Card className="mx-auto w-full max-w-6xl shadow-sm">
      <CardHeader className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-xl sm:text-[1.5rem]">Magazyny</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFetching ? 'Ładowanie…' : warehouseCountLabel(count)}
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {isError && (
          <div
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <p className="text-sm text-destructive">{queryErrorMessage(error)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Spróbuj ponownie
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Kod
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nazwa
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Typ
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  Aktywny
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  Stan ujemny
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  FIFO
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {items.map((w) => (
                <tr
                  key={w.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={onRowClick ? 'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : undefined}
                  onClick={onRowClick ? () => onRowClick(w) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(w);
                          }
                        }
                      : undefined
                  }
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium">{w.code}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-foreground">{w.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {WAREHOUSE_TYPE_LABELS_PL[w.warehouse_type]}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{w.is_active ? 'Tak' : 'Nie'}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{w.allow_negative_stock ? 'Tak' : 'Nie'}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{w.fifo_enabled ? 'Tak' : 'Nie'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isFetching && items.length === 0 && !isError && (
          <p className="py-12 text-center text-sm text-muted-foreground">Brak magazynów.</p>
        )}

        {totalPages > 1 && (
          <nav
            className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
            aria-label="Paginacja"
          >
            <p className="text-center text-sm text-muted-foreground sm:text-left">
              Strona <span className="font-medium text-foreground">{page}</span> z{' '}
              <span className="font-medium text-foreground">{totalPages}</span>
            </p>
            <div className="flex justify-center gap-2 sm:justify-end">
              <Button type="button" variant="outline" size="sm" disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
                Poprzednia
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Następna
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

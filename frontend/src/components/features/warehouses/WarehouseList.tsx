import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import type { Warehouse } from '@/types';

const PAGE_SIZE = 20;

export interface WarehouseListProps {
  onDelete?: (warehouse: Warehouse) => void;
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Failed to load warehouses';
}

export function WarehouseList({ onDelete }: WarehouseListProps) {
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
          <CardTitle className="text-xl sm:text-2xl">Warehouses</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFetching ? 'Loading…' : `${count} warehouse${count === 1 ? '' : 's'}`}
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {isError && (
          <div
            className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <p className="text-sm text-destructive">{queryErrorMessage(error)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Code
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  Active
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  −Stock
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  FIFO
                </th>
                {onDelete && (
                  <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {items.map((w) => (
                <tr key={w.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium">{w.code}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-foreground">{w.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{w.warehouse_type}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{w.is_active ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{w.allow_negative_stock ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{w.fifo_enabled ? 'Yes' : 'No'}</td>
                  {onDelete && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(w)}>
                        Delete
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isFetching && items.length === 0 && !isError && (
          <p className="py-12 text-center text-sm text-muted-foreground">No warehouses yet.</p>
        )}

        {totalPages > 1 && (
          <nav
            className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
            aria-label="Pagination"
          >
            <p className="text-center text-sm text-muted-foreground sm:text-left">
              Page <span className="font-medium text-foreground">{page}</span> of{' '}
              <span className="font-medium text-foreground">{totalPages}</span>
            </p>
            <div className="flex justify-center gap-2 sm:justify-end">
              <Button type="button" variant="outline" size="sm" disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

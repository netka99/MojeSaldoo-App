import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useProductListQuery } from '@/query/use-products';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

/** Matches Django `PageNumberPagination` default in this project. */
const PAGE_SIZE = 20;

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

export interface ProductListProps {
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  onRowClick?: (product: Product) => void;
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Failed to load products';
}

export function ProductList({ onEdit, onDelete, onRowClick }: ProductListProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [skuFilter, setSkuFilter] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSkuFilter(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const { data, isFetching, isError, error, refetch } = useProductListQuery(page, skuFilter);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <Card className="mx-auto w-full max-w-6xl shadow-sm">
      <CardHeader className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-xl sm:text-2xl">Products</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFetching ? 'Loading…' : `${count} item${count === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="w-full min-w-0 sm:max-w-xs">
          <Input
            label="Filter"
            placeholder="SKU"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Filter products by SKU"
          />
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

        {/* Mobile: stacked cards */}
        <ul className="divide-y divide-border md:hidden">
          {items.map((p) => (
            <li key={p.id}>
              <div
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className="flex w-full flex-col gap-2 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onRowClick?.(p)}
                onKeyDown={(e) => {
                  if (!onRowClick) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(p);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">{p.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.is_active ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Unit: {p.unit || '—'}</span>
                  <span className="text-right font-medium text-foreground">{formatMoney(p.price_gross)}</span>
                  <span className="col-span-2 truncate">SKU: {p.sku ?? '—'}</span>
                </div>
                <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={`/products/${p.id}/adjust-stock`}
                    className={cn(
                      'inline-flex h-9 w-full items-center justify-center rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground ring-offset-background transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    )}
                  >
                    Adjust stock
                  </Link>
                </div>
                {(onEdit || onDelete) && (
                  <div className="flex gap-2 pt-1">
                    {onEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(p);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(p);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop: table */}
        <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Unit
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  SKU
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Net
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Gross
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Stock
                </th>
                {(onEdit || onDelete) && (
                  <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {items.map((p) => (
                <tr
                  key={p.id}
                  className={onRowClick ? 'cursor-pointer hover:bg-muted/30' : ''}
                  onClick={() => onRowClick?.(p)}
                >
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium text-foreground">{p.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{p.unit}</td>
                  <td className="max-w-[120px] truncate px-4 py-3 text-muted-foreground">{p.sku ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(p.price_net)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-foreground">
                    {formatMoney(p.price_gross)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.is_active ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div onClick={(e) => e.stopPropagation()}>
                      <Link
                        to={`/products/${p.id}/adjust-stock`}
                        className={cn(
                          'inline-flex h-9 items-center justify-center rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground ring-offset-background transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        )}
                      >
                        Adjust
                      </Link>
                    </div>
                  </td>
                  {(onEdit || onDelete) && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {onEdit && (
                          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(p)}>
                            Edit
                          </Button>
                        )}
                        {onDelete && (
                          <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(p)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isFetching && items.length === 0 && !isError && (
          <p className="py-12 text-center text-sm text-muted-foreground">No products match this filter.</p>
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

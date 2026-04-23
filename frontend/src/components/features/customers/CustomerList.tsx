import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCustomerListQuery } from '@/query/use-customers';
import type { Customer } from '@/types';

const PAGE_SIZE = 20;

export interface CustomerListProps {
  onEdit?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
  onRowClick?: (customer: Customer) => void;
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Failed to load customers';
}

export function CustomerList({ onEdit, onDelete, onRowClick }: CustomerListProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const { data, isFetching, isError, error, refetch } = useCustomerListQuery(page, search);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <Card className="mx-auto w-full max-w-6xl shadow-sm">
      <CardHeader className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-xl sm:text-2xl">Customers</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFetching ? 'Loading…' : `${count} item${count === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="w-full min-w-0 sm:max-w-xs">
          <Input
            label="Filter"
            placeholder="Name or NIP"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Filter customers by name or NIP"
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

        <ul className="divide-y divide-border md:hidden">
          {items.map((c) => (
            <li key={c.id}>
              <div
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className="flex w-full flex-col gap-2 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onRowClick?.(c)}
                onKeyDown={(e) => {
                  if (!onRowClick) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(c);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.company_name && (
                      <p className="truncate text-xs text-muted-foreground">{c.company_name}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.is_active ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">{c.city ?? '—'}</span>
                  <span className="truncate text-right">{c.nip ?? '—'}</span>
                  <span className="col-span-2 truncate">{c.email ?? '—'}</span>
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
                          onEdit(c);
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
                          onDelete(c);
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

        <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Company
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  City
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  NIP
                </th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Email
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">
                  Status
                </th>
                {(onEdit || onDelete) && (
                  <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {items.map((c) => (
                <tr
                  key={c.id}
                  className={onRowClick ? 'cursor-pointer hover:bg-muted/30' : ''}
                  onClick={() => onRowClick?.(c)}
                >
                  <td className="max-w-[160px] truncate px-4 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">{c.company_name ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{c.city ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                    {c.nip ?? '—'}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.is_active ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {(onEdit || onDelete) && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {onEdit && (
                          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(c)}>
                            Edit
                          </Button>
                        )}
                        {onDelete && (
                          <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(c)}>
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
          <p className="py-12 text-center text-sm text-muted-foreground">No customers match this filter.</p>
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

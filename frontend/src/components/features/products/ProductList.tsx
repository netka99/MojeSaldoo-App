import { useEffect, useState } from 'react';
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

function formatTotalStock(value: string | number | undefined): string {
  if (value === undefined || value === null) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
}

type TypeFilter = 'all' | 'products' | 'services';

function itemCountLabel(count: number, filter: TypeFilter): string {
  if (filter === 'services') {
    if (count === 1) return '1 usługa';
    const n = count % 10;
    const n100 = count % 100;
    if (n >= 2 && n <= 4 && (n100 < 10 || n100 >= 20)) return `${count} usługi`;
    return `${count} usług`;
  }
  if (count === 1) return '1 produkt';
  const n = count % 10;
  const n100 = count % 100;
  if (n >= 2 && n <= 4 && (n100 < 10 || n100 >= 20)) return `${count} produkty`;
  return `${count} produktów`;
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface ProductListProps {
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  onRowClick?: (product: Product) => void;
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się wczytać produktów';
}

const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: 'Wszystkie',
  products: 'Produkty',
  services: 'Usługi',
};

export function ProductList({ onEdit, onDelete, onRowClick }: ProductListProps) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSkuFilter(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const isServiceParam =
    typeFilter === 'services' ? true : typeFilter === 'products' ? false : undefined;

  const { data, isFetching, isError, error, refetch } = useProductListQuery(page, skuFilter, isServiceParam);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const cardTitle =
    typeFilter === 'services' ? 'Usługi' : typeFilter === 'products' ? 'Produkty' : 'Produkty i usługi';

  function handleTypeFilter(f: TypeFilter) {
    setTypeFilter(f);
    setPage(1);
  }

  return (
    <Card className="mx-auto w-full max-w-6xl shadow-sm">
      <CardHeader className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-xl sm:text-[1.5rem]">{cardTitle}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFetching ? 'Ładowanie…' : itemCountLabel(count, typeFilter)}
          </p>
        </div>
        <div className="w-full min-w-0 sm:max-w-xs">
          <Input
            label="Filtr SKU"
            placeholder="np. SKU-123"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Filtruj produkty po kodzie SKU"
          />
        </div>
      </CardHeader>
      <div className="flex gap-1 border-b border-border px-6 pb-0">
        {(['all', 'products', 'services'] as TypeFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => handleTypeFilter(f)}
            className={cn(
              'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              typeFilter === f
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {TYPE_FILTER_LABELS[f]}
          </button>
        ))}
      </div>
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

        <div className="bg-surface-card rounded-2xl overflow-hidden md:hidden">
          <ul className="flex flex-col gap-1">
          {items.map((p) => (
            <li key={p.id}>
              <div
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={
                  onRowClick ? `Otwórz edycję produktu: ${p.name}` : undefined
                }
                className={cn(
                  'flex w-full gap-3 px-4 py-4 text-left transition-colors active:bg-surface-low hover:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  onRowClick ? 'cursor-pointer' : 'cursor-default',
                )}
                onClick={() => onRowClick?.(p)}
                onKeyDown={(e) => {
                  if (!onRowClick) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(p);
                  }
                }}
              >
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {typeFilter === 'all' && (
                        <span className={`self-start rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.is_service ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {p.is_service ? 'Usługa' : 'Produkt'}
                        </span>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.is_active ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {p.is_active ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Jednostka: {p.unit || '—'}</span>
                    <span className="text-right font-medium text-foreground">{formatMoney(p.price_gross)}</span>
                    <span className="col-span-2">
                      Stan (wszystkie magazyny):{' '}
                      <span className="font-medium text-foreground tabular-nums">{formatTotalStock(p.stock_total)}</span>
                    </span>
                    <span className="col-span-2 truncate">SKU: {p.sku ?? '—'}</span>
                  </div>
                  {(onEdit || onDelete) && (
                    <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      {onEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => onEdit(p)}
                        >
                          Edytuj
                        </Button>
                      )}
                      {onDelete && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="flex-1"
                          onClick={() => onDelete(p)}
                        >
                          Usuń
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {onRowClick && (
                  <ChevronRightIcon className="mt-1 h-5 w-5 shrink-0 self-start text-muted-foreground" />
                )}
              </div>
            </li>
          ))}
          </ul>
        </div>

        <div className="hidden md:block">
          <div className="overflow-x-auto rounded-2xl bg-surface-card">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-low/80">
              <tr>
                <th scope="col" className="px-4 py-4 text-left font-medium text-muted-foreground">
                  Nazwa
                </th>
                <th scope="col" className="px-4 py-4 text-left font-medium text-muted-foreground">
                  Jednostka
                </th>
                <th scope="col" className="px-4 py-4 text-left font-medium text-muted-foreground">
                  SKU
                </th>
                <th scope="col" className="px-4 py-4 text-right font-medium text-muted-foreground">
                  Netto
                </th>
                <th scope="col" className="px-4 py-4 text-right font-medium text-muted-foreground">
                  Brutto
                </th>
                <th scope="col" className="px-4 py-4 text-center font-medium text-muted-foreground">
                  Aktywność
                </th>
                <th scope="col" className="px-4 py-4 text-right font-medium text-muted-foreground">
                  Stan (Σ)
                </th>
                {(onEdit || onDelete) && (
                  <th scope="col" className="px-4 py-4 text-right font-medium text-muted-foreground">
                    Akcje
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  className={cn(
                    'transition-colors hover:bg-surface-low/50 active:bg-surface-low',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(p)}
                >
                  <td className="max-w-[200px] px-4 py-4">
                    <div className="flex flex-col gap-1">
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                      {typeFilter === 'all' && (
                        <span className={`self-start rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.is_service ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {p.is_service ? 'Usługa' : 'Produkt'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{p.unit}</td>
                  <td className="max-w-[120px] truncate px-4 py-4 text-muted-foreground">{p.sku ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums text-muted-foreground">
                    {formatMoney(p.price_net)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums font-medium text-foreground">
                    {formatMoney(p.price_gross)}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.is_active ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {p.is_active ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums text-foreground">
                    {formatTotalStock(p.stock_total)}
                  </td>
                  {(onEdit || onDelete) && (
                    <td className="whitespace-nowrap px-4 py-4 text-right">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {onEdit && (
                          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(p)}>
                            Edytuj
                          </Button>
                        )}
                        {onDelete && (
                          <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(p)}>
                            Usuń
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
        </div>

        {!isFetching && items.length === 0 && !isError && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {typeFilter === 'services'
              ? 'Brak usług spełniających ten filtr.'
              : 'Brak produktów spełniających ten filtr.'}
          </p>
        )}

        {totalPages > 1 && (
          <nav
            className="mt-6 flex flex-col items-stretch justify-between gap-3 pt-4 sm:flex-row sm:items-center"
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

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductListQuery } from '@/query/use-products';
import { cn } from '@/lib/utils';
import {
  reportButtonClass,
  reportPresetClass,
  reportRowClass,
  reportSubtitleClass,
  reportTableClass,
  reportTdClass,
  reportTdMoneyClass,
  reportTdMutedClass,
  reportThClass,
  statusRedClass,
} from '@/lib/reportSurface';
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

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
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

function statusClass(active: boolean): string {
  return active ? 'text-sm font-medium text-emerald-700' : 'text-sm font-medium text-slate-400';
}

function ProductThumb({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />;
  }
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary"
      aria-hidden
    >
      {letter}
    </span>
  );
}

export function ProductList({ onEdit, onDelete, onRowClick }: ProductListProps) {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') ?? '';
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [searchFilter, setSearchFilter] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchFilter(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const isServiceParam =
    typeFilter === 'services' ? true : typeFilter === 'products' ? false : undefined;

  const { data, isFetching, isError, error, refetch } = useProductListQuery(page, searchFilter, isServiceParam);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const showActions = Boolean(onEdit || onDelete);

  function handleTypeFilter(f: TypeFilter) {
    setTypeFilter(f);
    setPage(1);
  }

  function openRow(product: Product) {
    onRowClick?.(product);
  }

  return (
    <>
      <p className={reportSubtitleClass}>
        {isFetching && !data ? 'Ładowanie…' : itemCountLabel(count, typeFilter)}
      </p>

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 md:rounded-3xl md:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rodzaj">
            {(['all', 'products', 'services'] as TypeFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handleTypeFilter(f)}
                className={cn(
                  reportPresetClass,
                  typeFilter === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
                aria-pressed={typeFilter === f}
              >
                {TYPE_FILTER_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nazwa, SKU, opis…"
              aria-label="Szukaj produktów po nazwie lub SKU"
              className="field-ios w-full pl-9"
            />
          </div>
        </div>
      </div>

      {isError && (
        <div
          className={cn('flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between', statusRedClass)}
          role="alert"
        >
          <p className="text-sm text-red-700">{queryErrorMessage(error)}</p>
          <button type="button" className={reportButtonClass} onClick={() => void refetch()}>
            Spróbuj ponownie
          </button>
        </div>
      )}

      {items.length > 0 && (
      <div className="flex flex-col gap-2 md:hidden">
        {items.map((p) => (
          <div
            key={p.id}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            aria-label={onRowClick ? `Otwórz edycję produktu: ${p.name}` : undefined}
            className={cn(
              'rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left',
              onRowClick && 'cursor-pointer',
            )}
            onClick={() => openRow(p)}
            onKeyDown={(e) => {
              if (!onRowClick) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openRow(p);
              }
            }}
          >
            <div className="flex items-start gap-3">
              <ProductThumb name={p.name} url={p.image_url} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                {typeFilter === 'all' && (
                  <p className="mt-0.5 text-sm font-normal text-slate-500">{p.is_service ? 'Usługa' : 'Produkt'}</p>
                )}
              </div>
                  <span className={cn('shrink-0', statusClass(p.is_active))}>{p.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
              <p className="min-w-0 text-sm font-normal text-slate-500">
                {p.unit || '—'}
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="tabular-nums">{p.sku ?? '—'}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                Stan <span className="tabular-nums text-slate-600">{formatTotalStock(p.stock_total)}</span>
              </p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatMoney(p.price_gross)}</p>
                </div>
              </div>
            </div>
            {showActions && (
              <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                {onEdit && (
                  <button type="button" className={cn(reportButtonClass, 'flex-1')} onClick={() => onEdit(p)}>
                    Edytuj
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="flex-1 rounded-2xl bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive"
                    onClick={() => onDelete(p)}
                  >
                    Usuń
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      {items.length > 0 && (
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block md:rounded-3xl">
        <table className={cn(reportTableClass, 'min-w-full')} aria-label="Lista produktów">
          <thead>
            <tr>
              <th scope="col" className={reportThClass}>Nazwa</th>
              <th scope="col" className={reportThClass}>Jednostka</th>
              <th scope="col" className={reportThClass}>SKU</th>
              <th scope="col" className={cn(reportThClass, 'text-right')}>Netto</th>
              <th scope="col" className={cn(reportThClass, 'text-right')}>Brutto</th>
              <th scope="col" className={reportThClass}>Status</th>
              <th scope="col" className={cn(reportThClass, 'text-right')}>Stan</th>
              {showActions && (
                <th scope="col" className={cn(reportThClass, 'text-right')}>Akcje</th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr
                key={p.id}
                className={cn(reportRowClass, onRowClick && 'cursor-pointer')}
                onClick={() => openRow(p)}
              >
                <td className="max-w-[280px] px-3 py-3">
                  <div className="flex items-center gap-3">
                    <ProductThumb name={p.name} url={p.image_url} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                      {typeFilter === 'all' && (
                        <p className="text-sm font-normal text-slate-500">{p.is_service ? 'Usługa' : 'Produkt'}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className={reportTdMutedClass}>{p.unit || '—'}</td>
                <td className={cn(reportTdClass, 'max-w-[140px] truncate tabular-nums')}>{p.sku ?? '—'}</td>
                <td className={cn(reportTdMutedClass, 'text-right')}>{formatMoney(p.price_net)}</td>
                <td className={reportTdMoneyClass}>{formatMoney(p.price_gross)}</td>
                <td className="whitespace-nowrap px-3 py-3">
                  <span className={statusClass(p.is_active)}>{p.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                </td>
                <td className={cn(reportTdClass, 'text-right tabular-nums')}>{formatTotalStock(p.stock_total)}</td>
                {showActions && (
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      {onEdit && (
                        <button type="button" className={reportButtonClass} onClick={() => onEdit(p)}>
                          Edytuj
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="rounded-2xl bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive"
                          onClick={() => onDelete(p)}
                        >
                          Usuń
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {!isFetching && items.length === 0 && !isError && (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 md:rounded-3xl">
          {typeFilter === 'services'
            ? 'Brak usług spełniających ten filtr.'
            : 'Brak produktów spełniających ten filtr.'}
        </p>
      )}

      {totalPages > 1 && (
        <nav className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center" aria-label="Paginacja">
          <p className="text-center text-sm text-slate-500 sm:text-left">
            Strona <span className="font-semibold tabular-nums text-slate-900">{page}</span> z{' '}
            <span className="font-semibold tabular-nums text-slate-900">{totalPages}</span>
          </p>
          <div className="flex justify-center gap-2 sm:justify-end">
            <button
              type="button"
              className={cn(reportButtonClass, 'disabled:cursor-not-allowed disabled:opacity-50')}
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
            >
              Poprzednia
            </button>
            <button
              type="button"
              className={cn(reportButtonClass, 'disabled:cursor-not-allowed disabled:opacity-50')}
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Następna
            </button>
          </div>
        </nav>
      )}
    </>
  );
}

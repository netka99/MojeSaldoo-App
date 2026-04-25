import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useOrderListQuery, type OrderListFilters } from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { ORDER_STATUS_LABELS_PL, orderStatusOptions } from '@/constants/orderStatusPl';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus } from '@/types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatMoneyGross(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function formatDeliveryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

export function orderStatusBadgeClassName(status: OrderStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800';
    case 'confirmed':
      return 'bg-blue-100 text-blue-800';
    case 'delivered':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    case 'in_preparation':
    case 'loaded':
    case 'in_delivery':
      return 'bg-amber-100 text-amber-900';
    case 'invoiced':
      return 'bg-violet-100 text-violet-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się załadować zamówień';
}

const selectClassName = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function buildOrderListApiFilters(
  search: string,
  status: '' | OrderStatus,
  dateFrom: string,
  dateTo: string,
): OrderListFilters {
  const filters: OrderListFilters = {};
  const t = search.trim();
  if (t) filters.search = t;
  if (status) filters.status = status;
  if (dateFrom) filters.delivery_date_after = dateFrom;
  if (dateTo) filters.delivery_date_before = dateTo;
  return filters;
}

export function OrdersPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <OrdersPageContent />;
}

function OrdersPageContent() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const listFilters = buildOrderListApiFilters(search, status, dateFrom, dateTo);
  const { data, isFetching, isError, error, refetch } = useOrderListQuery(page, listFilters);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-semibold text-foreground">Zamówienia</h1>
        <Button
          type="button"
          className="sm:shrink-0"
          onClick={() => navigate('/orders/new')}
        >
          Nowe zamówienie
        </Button>
      </div>

      <Card className="mx-auto w-full max-w-6xl shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-border pb-6">
          <div>
            <CardTitle className="text-xl sm:text-2xl">Lista zamówień</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFetching ? 'Ładowanie…' : `Znaleziono: ${count}`}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 sm:col-span-2">
              <Input
                label="Klient"
                placeholder="Szukaj po kliencie lub numerze"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                autoComplete="off"
                id="orders-customer-search"
                aria-label="Filtruj zamówienia po kliencie lub numerze"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="orders-status-filter" className="text-sm font-medium leading-none">
                Status
              </label>
              <select
                id="orders-status-filter"
                className={selectClassName}
                value={status}
                onChange={(e) => {
                  setStatus((e.target.value as OrderStatus | '') || '');
                  setPage(1);
                }}
                aria-label="Filtruj zamówienia po statusie"
              >
                <option value="">Wszystkie</option>
                {orderStatusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
              <Input
                label="Dostawa od"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                id="orders-delivery-from"
                aria-label="Data dostawy od"
              />
              <Input
                label="Dostawa do"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                id="orders-delivery-to"
                aria-label="Data dostawy do"
              />
            </div>
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
                Spróbuj ponownie
              </Button>
            </div>
          )}

          <ul className="divide-y divide-border md:hidden">
            {items.map((o) => (
              <li key={o.id}>
                <div className="flex flex-col gap-2 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/orders/${o.id}`} className="min-w-0 font-medium text-primary hover:underline">
                      {o.order_number ?? o.id.slice(0, 8)}
                    </Link>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        orderStatusBadgeClassName(o.status),
                      )}
                    >
                      {ORDER_STATUS_LABELS_PL[o.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{o.customer_name}</p>
                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Dostawa: {formatDeliveryDate(o.delivery_date)}</span>
                    <span className="text-right font-medium text-foreground">{formatMoneyGross(o.total_gross)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="min-w-full divide-y divide-border text-sm" aria-label="Lista zamówień">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Nr zamówienia
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Klient
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Data dostawy
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Wartość brutto
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {items.map((o: Order) => (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link to={`/orders/${o.id}`} className="text-primary hover:underline">
                        {o.order_number ?? o.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground" title={o.customer_name}>
                      {o.customer_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDeliveryDate(o.delivery_date)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          orderStatusBadgeClassName(o.status),
                        )}
                      >
                        {ORDER_STATUS_LABELS_PL[o.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-foreground">
                      {formatMoneyGross(o.total_gross)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isFetching && items.length === 0 && !isError && (
            <p className="py-12 text-center text-sm text-muted-foreground">Brak zamówień spełniających kryteria.</p>
          )}

          {totalPages > 1 && (
            <nav
              className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
              aria-label="Stronicowanie listy zamówień"
            >
              <p className="text-center text-sm text-muted-foreground sm:text-left">
                Strona <span className="font-medium text-foreground">{page}</span> z{' '}
                <span className="font-medium text-foreground">{totalPages}</span>
              </p>
              <div className="flex justify-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Poprzednia
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Następna
                </Button>
              </div>
            </nav>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

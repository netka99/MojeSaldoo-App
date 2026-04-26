import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  useDeliveryListQuery,
  useGenerateDeliveryForOrderMutation,
  type DeliveryListFilters,
} from '@/query/use-delivery';
import { useOrderListQuery } from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { DELIVERY_STATUS_LABELS_PL, deliveryStatusFilterOptions } from '@/constants/deliveryStatusPl';
import { cn } from '@/lib/utils';
import type { DeliveryDocument, DeliveryDocumentStatus } from '@/types';

const PAGE_SIZE = 20;
const ORDER_SEARCH_DEBOUNCE_MS = 350;

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się załadować dokumentów';
}

const selectClassName = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function deliveryStatusBadgeClassName(status: DeliveryDocumentStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800';
    case 'saved':
      return 'bg-blue-100 text-blue-800';
    case 'in_transit':
      return 'bg-amber-100 text-amber-900';
    case 'delivered':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function buildDeliveryListFilters(
  status: '' | DeliveryDocumentStatus,
  dateFrom: string,
  dateTo: string,
): DeliveryListFilters {
  const filters: DeliveryListFilters = {
    document_type: 'WZ',
  };
  if (status) filters.status = status;
  if (dateFrom) filters.issue_date_after = dateFrom;
  if (dateTo) filters.issue_date_before = dateTo;
  return filters;
}

export function DeliveryDocumentsPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <DeliveryDocumentsPageContent />;
}

function DeliveryDocumentsPageContent() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | DeliveryDocumentStatus>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const listFilters = buildDeliveryListFilters(status, dateFrom, dateTo);
  const { data, isFetching, isError, error, refetch } = useDeliveryListQuery(page, listFilters);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const [orderSearchInput, setOrderSearchInput] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setOrderSearch(orderSearchInput.trim());
    }, ORDER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [orderSearchInput]);

  const { data: ordersData, isFetching: ordersLoading } = useOrderListQuery(1, {
    status: 'confirmed',
    search: orderSearch || undefined,
  });
  const confirmedOrders = ordersData?.results ?? [];

  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generateMutation = useGenerateDeliveryForOrderMutation();

  const handleGenerateWz = () => {
    if (!selectedOrderId) return;
    setGenerateError(null);
    generateMutation.mutate(selectedOrderId, {
      onSuccess: () => {
        setSelectedOrderId('');
        void refetch();
      },
      onError: (e) => {
        setGenerateError(queryErrorMessage(e));
      },
    });
  };

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Dokumenty WZ</h1>

        <Card className="w-full shadow-sm">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg">Generuj WZ z zamówienia</CardTitle>
            <p className="text-sm text-muted-foreground">
              Wybierz potwierdzone zamówienie. Wyszukiwanie ogranicza listę — wpisz fragment nazwy klienta lub numer.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-[200px] flex-1 space-y-2">
                <Input
                  label="Szukaj zamówienia"
                  placeholder="Klient lub numer ZAM/…"
                  value={orderSearchInput}
                  onChange={(e) => setOrderSearchInput(e.target.value)}
                  id="delivery-order-search"
                  autoComplete="off"
                />
              </div>
              <div className="min-w-[240px] flex-1 space-y-2">
                <label htmlFor="delivery-order-select" className="text-sm font-medium leading-none">
                  Zamówienie
                </label>
                <select
                  id="delivery-order-select"
                  className={selectClassName}
                  value={selectedOrderId}
                  onChange={(e) => {
                    setSelectedOrderId(e.target.value);
                    setGenerateError(null);
                  }}
                  disabled={ordersLoading}
                  aria-busy={ordersLoading}
                >
                  <option value="">— wybierz —</option>
                  {confirmedOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {(o.order_number ?? o.id.slice(0, 8)) + ' · ' + o.customer_name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                className="sm:shrink-0"
                disabled={!selectedOrderId || generateMutation.isPending}
                onClick={handleGenerateWz}
                id="delivery-generate-wz"
              >
                {generateMutation.isPending ? 'Generowanie…' : 'Generuj WZ'}
              </Button>
            </div>
            {generateError && (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {generateError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mx-auto w-full max-w-6xl shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-border pb-6">
          <div>
            <CardTitle className="text-xl sm:text-2xl">Lista dokumentów WZ</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFetching ? 'Ładowanie…' : `Znaleziono: ${count}`}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="delivery-status-filter" className="text-sm font-medium leading-none">
                Status
              </label>
              <select
                id="delivery-status-filter"
                className={selectClassName}
                value={status}
                onChange={(e) => {
                  setStatus((e.target.value as DeliveryDocumentStatus | '') || '');
                  setPage(1);
                }}
                aria-label="Filtruj dokumenty po statusie"
              >
                <option value="">Wszystkie</option>
                {deliveryStatusFilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
              <Input
                label="Data wystawienia od"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                id="delivery-issue-from"
                aria-label="Data wystawienia od"
              />
              <Input
                label="Data wystawienia do"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                id="delivery-issue-to"
                aria-label="Data wystawienia do"
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
            {items.map((row: DeliveryDocument) => (
              <li key={row.id} className="py-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/delivery/${row.id}`}
                      className="min-w-0 font-medium text-primary hover:underline"
                    >
                      {row.document_number ?? row.id.slice(0, 8)}
                    </Link>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        deliveryStatusBadgeClassName(row.status),
                      )}
                    >
                      {DELIVERY_STATUS_LABELS_PL[row.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{row.customer_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    Data: {formatIssueDate(row.issue_date)} · Kierowca: {row.driver_name?.trim() ? row.driver_name : '—'}
                  </p>
                  <Link
                    to={`/orders/${row.order_id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Zamówienie
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="min-w-full divide-y divide-border text-sm" aria-label="Lista dokumentów WZ">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Numer WZ
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Data wyst.
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Klient
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Kierowca
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Zamówienie
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {items.map((row: DeliveryDocument) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link to={`/delivery/${row.id}`} className="text-primary hover:underline">
                        {row.document_number ?? row.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatIssueDate(row.issue_date)}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground" title={row.customer_name}>
                      {row.customer_name || '—'}
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground" title={row.driver_name}>
                      {row.driver_name?.trim() ? row.driver_name : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          deliveryStatusBadgeClassName(row.status),
                        )}
                      >
                        {DELIVERY_STATUS_LABELS_PL[row.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/orders/${row.order_id}`} className="text-primary hover:underline">
                        {row.order_number ?? row.order_id.slice(0, 8)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isFetching && items.length === 0 && !isError && (
            <p className="py-12 text-center text-sm text-muted-foreground">Brak dokumentów spełniających kryteria.</p>
          )}

          {totalPages > 1 && (
            <nav
              className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
              aria-label="Stronicowanie listy dokumentów"
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

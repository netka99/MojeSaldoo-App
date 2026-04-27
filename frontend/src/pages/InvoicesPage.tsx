import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  INVOICE_KSEF_STATUS_LABELS_PL,
  invoiceKsefStatusFilterOptions,
} from '@/constants/invoiceKsefStatusPl';
import {
  INVOICE_STATUS_LABELS_PL,
  invoiceStatusFilterOptions,
} from '@/constants/invoiceStatusPl';
import { useCustomerListQuery } from '@/query/use-customers';
import { useInvoiceListQuery, type InvoiceListFilters } from '@/query/use-invoices';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { Invoice, InvoiceKsefStatus, InvoiceStatus } from '@/types';

const PAGE_SIZE = 20;
const CUSTOMER_SEARCH_DEBOUNCE_MS = 350;

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
const plMoney = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
});

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function formatGross(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return plMoney.format(n);
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się załadować faktur';
}

const selectClassName = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function invoiceStatusBadgeClassName(status: InvoiceStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800';
    case 'issued':
      return 'bg-blue-100 text-blue-800';
    case 'sent':
      return 'bg-indigo-100 text-indigo-900';
    case 'paid':
      return 'bg-green-100 text-green-800';
    case 'overdue':
      return 'bg-amber-100 text-amber-900';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function invoiceKsefStatusBadgeClassName(status: InvoiceKsefStatus): string {
  switch (status) {
    case 'not_sent':
      return 'bg-gray-100 text-gray-700';
    case 'pending':
      return 'bg-amber-100 text-amber-900';
    case 'sent':
      return 'bg-blue-100 text-blue-800';
    case 'accepted':
      return 'bg-green-100 text-green-800';
    case 'rejected':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function buildInvoiceListFilters(
  status: '' | InvoiceStatus,
  ksefStatus: '' | InvoiceKsefStatus,
  customerId: string,
  dateFrom: string,
  dateTo: string,
): InvoiceListFilters {
  const filters: InvoiceListFilters = {};
  if (status) filters.status = status;
  if (ksefStatus) filters.ksef_status = ksefStatus;
  if (customerId) filters.customer = customerId;
  if (dateFrom) filters.issue_date_after = dateFrom;
  if (dateTo) filters.issue_date_before = dateTo;
  return filters;
}

export function InvoicesPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InvoicesPageContent />;
}

function InvoicesPageContent() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [ksefStatus, setKsefStatus] = useState<'' | InvoiceKsefStatus>('');
  const [customerId, setCustomerId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [customerSearchInput, setCustomerSearchInput] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setCustomerSearch(customerSearchInput.trim());
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [customerSearchInput]);

  const { data: customersData, isFetching: customersLoading } = useCustomerListQuery(1, customerSearch);
  const customerOptions = customersData?.results ?? [];

  const listFilters = buildInvoiceListFilters(status, ksefStatus, customerId, dateFrom, dateTo);
  const { data, isFetching, isError, error, refetch } = useInvoiceListQuery(page, listFilters);
  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Faktury</h1>
        <Link
          to="/invoices/new"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Nowa faktura z zamówienia
        </Link>
      </div>

      <Card className="mx-auto w-full max-w-6xl shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-border pb-6">
          <div>
            <CardTitle className="text-xl sm:text-2xl">Lista faktur</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFetching ? 'Ładowanie…' : `Znaleziono: ${count}`}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="invoice-status-filter" className="text-sm font-medium leading-none">
                Status
              </label>
              <select
                id="invoice-status-filter"
                className={selectClassName}
                value={status}
                onChange={(e) => {
                  setStatus((e.target.value as InvoiceStatus | '') || '');
                  resetPage();
                }}
                aria-label="Filtruj po statusie faktury"
              >
                <option value="">Wszystkie</option>
                {invoiceStatusFilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="invoice-ksef-filter" className="text-sm font-medium leading-none">
                Status KSeF
              </label>
              <select
                id="invoice-ksef-filter"
                className={selectClassName}
                value={ksefStatus}
                onChange={(e) => {
                  setKsefStatus((e.target.value as InvoiceKsefStatus | '') || '');
                  resetPage();
                }}
                aria-label="Filtruj po statusie KSeF"
              >
                <option value="">Wszystkie</option>
                {invoiceKsefStatusFilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 lg:col-span-1">
              <Input
                label="Szukaj klienta (lista)"
                placeholder="Nazwa lub NIP…"
                value={customerSearchInput}
                onChange={(e) => setCustomerSearchInput(e.target.value)}
                id="invoice-customer-search"
                autoComplete="off"
              />
              <label htmlFor="invoice-customer-filter" className="sr-only">
                Klient
              </label>
              <select
                id="invoice-customer-filter"
                className={cn(selectClassName, 'mt-2')}
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  resetPage();
                }}
                disabled={customersLoading}
                aria-busy={customersLoading}
                aria-label="Filtruj po kliencie"
              >
                <option value="">Wszyscy klienci</option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || c.name}
                    {c.nip ? ` · NIP ${c.nip}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-3">
              <Input
                label="Data wystawienia od"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  resetPage();
                }}
                id="invoice-issue-from"
                aria-label="Data wystawienia od"
              />
              <Input
                label="Data wystawienia do"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  resetPage();
                }}
                id="invoice-issue-to"
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
            {items.map((row: Invoice) => (
              <li key={row.id} className="py-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/invoices/${row.id}`}
                      className="min-w-0 font-medium text-primary hover:underline"
                    >
                      {row.invoice_number ?? row.id.slice(0, 8)}
                    </Link>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        invoiceStatusBadgeClassName(row.status),
                      )}
                    >
                      {INVOICE_STATUS_LABELS_PL[row.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{row.order.customer_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    Wyst.: {formatIssueDate(row.issue_date)} · Płatność: {formatIssueDate(row.due_date)}
                  </p>
                  <p className="text-sm font-medium">{formatGross(row.total_gross)}</p>
                  <span
                    className={cn(
                      'w-fit rounded-full px-2 py-0.5 text-xs font-medium',
                      invoiceKsefStatusBadgeClassName(row.ksef_status),
                    )}
                  >
                    {INVOICE_KSEF_STATUS_LABELS_PL[row.ksef_status]}
                  </span>
                  <Link
                    to={`/orders/${row.order.id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Zamówienie
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="min-w-full divide-y divide-border text-sm" aria-label="Lista faktur">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Nr faktury
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Klient
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Data wystawienia
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Termin płatności
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Wartość brutto
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status KSeF
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {items.map((row: Invoice) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <div className="flex flex-col">
                        <Link to={`/invoices/${row.id}`} className="text-primary hover:underline">
                          {row.invoice_number ?? row.id.slice(0, 8)}
                        </Link>
                        <Link
                          to={`/orders/${row.order.id}`}
                          className="text-xs font-normal text-primary hover:underline"
                        >
                          Zamówienie
                        </Link>
                      </div>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground" title={row.order.customer_name}>
                      {row.order.customer_name || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatIssueDate(row.issue_date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatIssueDate(row.due_date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {formatGross(row.total_gross)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          invoiceStatusBadgeClassName(row.status),
                        )}
                      >
                        {INVOICE_STATUS_LABELS_PL[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          invoiceKsefStatusBadgeClassName(row.ksef_status),
                        )}
                      >
                        {INVOICE_KSEF_STATUS_LABELS_PL[row.ksef_status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isFetching && items.length === 0 && !isError && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Brak faktur spełniających kryteria.
            </p>
          )}

          {totalPages > 1 && (
            <nav
              className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
              aria-label="Stronicowanie listy faktur"
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

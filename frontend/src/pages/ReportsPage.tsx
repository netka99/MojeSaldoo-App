import { useMemo, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { INVOICE_KSEF_STATUS_LABELS_PL } from '@/constants/invoiceKsefStatusPl';
import {
  useKsefStatusReportQuery,
  useSalesSummaryReportQuery,
  useTopCustomersReportQuery,
  useTopProductsReportQuery,
  TOP_LIMIT,
} from '@/query/use-reports';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { KsefStatusReport } from '@/types/reporting.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

export const KSEF_DONUT_COLORS = {
  notSent: '#9ca3af',
  pending: '#fbbf24',
  sent: '#60a5fa',
  accepted: '#4ade80',
  rejected: '#f87171',
} as const;

/** CSS `conic-gradient` for KSeF status donut (testable pure helper). */
export function buildKsefConicGradient(report: KsefStatusReport): string {
  const entries: { color: string; n: number }[] = [
    { color: KSEF_DONUT_COLORS.notSent, n: report.notSent },
    { color: KSEF_DONUT_COLORS.pending, n: report.pending },
    { color: KSEF_DONUT_COLORS.sent, n: report.sent },
    { color: KSEF_DONUT_COLORS.accepted, n: report.accepted },
    { color: KSEF_DONUT_COLORS.rejected, n: report.rejected },
  ];
  const total = entries.reduce((s, e) => s + e.n, 0);
  if (total === 0) {
    return 'conic-gradient(#e5e7eb 0% 100%)';
  }
  let acc = 0;
  const parts: string[] = [];
  for (const e of entries) {
    if (e.n <= 0) continue;
    const start = (acc / total) * 100;
    acc += e.n;
    const end = (acc / total) * 100;
    parts.push(`${e.color} ${start.toFixed(3)}% ${end.toFixed(3)}%`);
  }
  return `conic-gradient(from 0deg, ${parts.join(', ')})`;
}

export type KsefLegendRow = {
  label: string;
  value: number;
  color: string;
};

export function buildKsefLegendRows(report: KsefStatusReport): KsefLegendRow[] {
  return [
    { label: INVOICE_KSEF_STATUS_LABELS_PL.not_sent, value: report.notSent, color: KSEF_DONUT_COLORS.notSent },
    { label: INVOICE_KSEF_STATUS_LABELS_PL.pending, value: report.pending, color: KSEF_DONUT_COLORS.pending },
    { label: INVOICE_KSEF_STATUS_LABELS_PL.sent, value: report.sent, color: KSEF_DONUT_COLORS.sent },
    { label: INVOICE_KSEF_STATUS_LABELS_PL.accepted, value: report.accepted, color: KSEF_DONUT_COLORS.accepted },
    { label: INVOICE_KSEF_STATUS_LABELS_PL.rejected, value: report.rejected, color: KSEF_DONUT_COLORS.rejected },
  ];
}

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
  };
}

function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function formatQty(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(n);
}

const inputClass = cn(
  'flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

const tableClass = 'w-full border-collapse text-sm';
const thClass = 'border-b bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground';
const tdClass = 'border-b px-3 py-2';

export function KsefStatusDonut({ report }: { report: KsefStatusReport }) {
  const background = useMemo(() => buildKsefConicGradient(report), [report]);
  const total =
    report.notSent +
    report.pending +
    report.sent +
    report.accepted +
    report.rejected;

  return (
    <div
      className="relative mx-auto h-44 w-44 shrink-0 rounded-full"
      style={{
        background,
        WebkitMask: 'radial-gradient(farthest-side, transparent 58%, black 59%)',
        mask: 'radial-gradient(farthest-side, transparent 58%, black 59%)',
      }}
      role="img"
      aria-label={`Podsumowanie KSeF: ${total} faktur łącznie`}
    />
  );
}

export function ReportsPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <ReportsPageContent />;
}

function ReportsPageContent() {
  const initial = useMemo(() => defaultDateRange(), []);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);

  const sales = useSalesSummaryReportQuery(dateFrom, dateTo);
  const products = useTopProductsReportQuery(dateFrom, dateTo);
  const customers = useTopCustomersReportQuery(dateFrom, dateTo);
  const ksef = useKsefStatusReportQuery();

  const ksefData = ksef.data;
  const legendRows = ksefData ? buildKsefLegendRows(ksefData) : [];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Raporty</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Podsumowanie sprzedaży, rankingi i status KSeF dla aktywnej firmy.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <CardTitle className="text-lg">Podsumowanie sprzedaży</CardTitle>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="report-date-from" className="mb-1 block text-xs text-muted-foreground">
                  Od
                </label>
                <input
                  id="report-date-from"
                  type="date"
                  className={cn(inputClass, 'w-full min-w-[10rem]')}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="report-date-to" className="mb-1 block text-xs text-muted-foreground">
                  Do
                </label>
                <input
                  id="report-date-to"
                  type="date"
                  className={cn(inputClass, 'w-full min-w-[10rem]')}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {sales.isError && (
              <p className="text-sm text-destructive">
                {sales.error instanceof Error ? sales.error.message : 'Błąd ładowania podsumowania'}
              </p>
            )}
            {sales.isFetching && !sales.data && <p className="text-sm text-muted-foreground">Ładowanie…</p>}
            {sales.data && (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Zamówienia
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{sales.data.totalOrders}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Suma brutto
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatMoney(sales.data.totalGross)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Śr. wartość zamówienia
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatMoney(sales.data.avgOrderValue)}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top {TOP_LIMIT} produktów (przychód)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Wybrany okres: {dateFrom} — {dateTo}
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {products.isError && (
                <p className="text-sm text-destructive">
                  {products.error instanceof Error ? products.error.message : 'Błąd'}
                </p>
              )}
              {products.isFetching && !products.data && (
                <p className="text-sm text-muted-foreground">Ładowanie…</p>
              )}
              {products.data && products.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Brak danych w tym okresie.</p>
              )}
              {products.data && products.data.length > 0 && (
                <table className={tableClass} aria-label="Top produktów według przychodu">
                  <thead>
                    <tr>
                      <th className={thClass}>Produkt</th>
                      <th className={thClass}>Ilość</th>
                      <th className={cn(thClass, 'text-right')}>Przychód brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.data.map((row, i) => (
                      <tr key={`${row.productName}-${i}`}>
                        <td className={tdClass}>{row.productName}</td>
                        <td className={cn(tdClass, 'tabular-nums')}>{formatQty(row.totalQuantity)}</td>
                        <td className={cn(tdClass, 'text-right tabular-nums')}>
                          {formatMoney(row.totalGross)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top {TOP_LIMIT} klientów (przychód)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Wybrany okres: {dateFrom} — {dateTo}
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {customers.isError && (
                <p className="text-sm text-destructive">
                  {customers.error instanceof Error ? customers.error.message : 'Błąd'}
                </p>
              )}
              {customers.isFetching && !customers.data && (
                <p className="text-sm text-muted-foreground">Ładowanie…</p>
              )}
              {customers.data && customers.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Brak danych w tym okresie.</p>
              )}
              {customers.data && customers.data.length > 0 && (
                <table className={tableClass} aria-label="Top klientów według przychodu">
                  <thead>
                    <tr>
                      <th className={thClass}>Klient</th>
                      <th className={thClass}>Zamówienia</th>
                      <th className={cn(thClass, 'text-right')}>Suma brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.data.map((row, i) => (
                      <tr key={`${row.customerName}-${i}`}>
                        <td className={tdClass}>{row.customerName}</td>
                        <td className={cn(tdClass, 'tabular-nums')}>{row.orderCount}</td>
                        <td className={cn(tdClass, 'text-right tabular-nums')}>
                          {formatMoney(row.totalGross)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status KSeF</CardTitle>
            <p className="text-sm text-muted-foreground">Rozkład faktur według statusu w KSeF</p>
          </CardHeader>
          <CardContent>
            {ksef.isError && (
              <p className="text-sm text-destructive">
                {ksef.error instanceof Error ? ksef.error.message : 'Błąd'}
              </p>
            )}
            {ksef.isFetching && !ksefData && <p className="text-sm text-muted-foreground">Ładowanie…</p>}
            {ksefData && (
              <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
                <div className="flex flex-1 flex-col items-center gap-4 lg:flex-row lg:items-start">
                  <KsefStatusDonut report={ksefData} />
                  <ul className="grid w-full max-w-sm gap-2 text-sm sm:grid-cols-2" aria-label="Legenda wykresu KSeF">
                    {legendRows.map((row) => (
                      <li key={row.label} className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: row.color }}
                          aria-hidden
                        />
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="ml-auto font-medium tabular-nums">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="mb-2 text-sm font-medium text-foreground">Faktury odrzucone</h3>
                  {ksefData.rejectedInvoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Brak odrzuconych faktur.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {ksefData.rejectedInvoices.map((inv) => (
                        <li key={inv.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <Link
                              to={`/invoices/${inv.id}`}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {inv.invoice_number ?? inv.id}
                            </Link>
                            <span className="text-muted-foreground"> · {inv.customer_name}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatMoney(inv.total_gross)}
                            {inv.ksef_error_message ? ` · ${inv.ksef_error_message}` : ''}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

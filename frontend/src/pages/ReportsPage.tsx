import { useMemo, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { INVOICE_KSEF_STATUS_LABELS_PL } from '@/constants/invoiceKsefStatusPl';
import {
  useKsefStatusReportQuery,
  useProfitLossQuery,
  useSalesSummaryReportQuery,
  useTopCustomersReportQuery,
  useTopProductsReportQuery,
  TOP_LIMIT,
} from '@/query/use-reports';
import { authStorage } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { reportingService } from '@/services/reporting.service';
import { cn } from '@/lib/utils';
import type { KsefStatusReport } from '@/types/reporting.types';

/** Flat-rate tax rates by ryczałt category. */
const RYCZALT_RATES: Record<string, number> = {
  rolnicze:     0.02,
  handel:       0.03,
  budownictwo:  0.055,
  uslugi:       0.085,
  it:           0.12,
  medyczne:     0.14,
  finansowe:    0.15,
  wolne_zawody: 0.17,
};

const RYCZALT_RATE_LABELS: Record<string, string> = {
  rolnicze:     '2%',
  handel:       '3%',
  budownictwo:  '5,5%',
  uslugi:       '8,5%',
  it:           '12%',
  medyczne:     '14%',
  finansowe:    '15%',
  wolne_zawody: '17%',
};

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

  const { user } = useAuth();
  const isRyczalt = user?.taxation_form === 'ryczalt';
  const ryczaltCategory = user?.ryczalt_category ?? null;
  const hasCostAllocation = user?.modules?.['cost_allocation'] === true;
  const ryczaltRate = ryczaltCategory ? (RYCZALT_RATES[ryczaltCategory] ?? null) : null;
  const ryczaltRateLabel = ryczaltCategory ? (RYCZALT_RATE_LABELS[ryczaltCategory] ?? null) : null;

  const now = new Date();
  const [ewpYear, setEwpYear] = useState(now.getFullYear());
  const [ewpMonth, setEwpMonth] = useState(now.getMonth() + 1);
  const [ewpLoading, setEwpLoading] = useState(false);
  const [ewpError, setEwpError] = useState<string | null>(null);

  const handleDownloadEwp = async () => {
    setEwpError(null);
    setEwpLoading(true);
    try {
      await reportingService.downloadJpkEwp(ewpYear, ewpMonth);
    } catch (e) {
      setEwpError(e instanceof Error ? e.message : 'Błąd pobierania JPK_EWP');
    } finally {
      setEwpLoading(false);
    }
  };

  const sales = useSalesSummaryReportQuery(dateFrom, dateTo);
  const products = useTopProductsReportQuery(dateFrom, dateTo);
  const customers = useTopCustomersReportQuery(dateFrom, dateTo);
  const ksef = useKsefStatusReportQuery();
  const pl = useProfitLossQuery(dateFrom, dateTo);

  const ksefData = ksef.data;
  const legendRows = ksefData ? buildKsefLegendRows(ksefData) : [];

  // Ryczałt profitability numbers derived from sales + P&L queries.
  const ryczaltRevenue = sales.data
    ? Number.parseFloat(String(sales.data.totalGross))
    : null;
  const ryczaltOpex = pl.data?.totals
    ? Number.parseFloat(String(pl.data.totals.opex))
    : null;
  const ryczaltProfit =
    ryczaltRevenue !== null && ryczaltOpex !== null
      ? ryczaltRevenue - ryczaltOpex
      : ryczaltRevenue !== null
      ? ryczaltRevenue
      : null;
  const estimatedTax =
    ryczaltRevenue !== null && ryczaltRate !== null
      ? ryczaltRevenue * ryczaltRate
      : null;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Raporty</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Podsumowanie sprzedaży, rankingi i status KSeF dla aktywnej firmy.
          </p>
        </div>
        <div className="no-print flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Drukuj PDF
          </button>
        </div>
      </div>

      <div className="space-y-6">

        {/* ── Ryczałt profitability card ─────────────────────────────────── */}
        {isRyczalt && (
          <Card className="border-primary/20 bg-primary/3">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Rentowność ryczałtowa</CardTitle>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Wybrany okres: {dateFrom} — {dateTo}
                    {ryczaltRateLabel && (
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                        stawka {ryczaltRateLabel}
                      </span>
                    )}
                  </p>
                </div>
                <Link
                  to="/reports/profit-loss"
                  className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Szczegółowy P&L →
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {(sales.isFetching && !sales.data) || (pl.isFetching && !pl.data) ? (
                <p className="text-sm text-muted-foreground">Ładowanie…</p>
              ) : (
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Przychody brutto
                    </dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">
                      {ryczaltRevenue !== null ? formatMoney(ryczaltRevenue) : '—'}
                    </dd>
                  </div>

                  {hasCostAllocation ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Koszty OPEX
                      </dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums text-destructive">
                        {ryczaltOpex !== null && ryczaltOpex > 0
                          ? `− ${formatMoney(ryczaltOpex)}`
                          : ryczaltOpex === 0
                          ? formatMoney(0)
                          : '—'}
                      </dd>
                    </div>
                  ) : (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Koszty OPEX
                      </dt>
                      <dd className="mt-1 text-sm text-muted-foreground">
                        <Link
                          to="/settings/company"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          Włącz moduł Kosztów
                        </Link>
                      </dd>
                    </div>
                  )}

                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Wynik rzeczywisty
                    </dt>
                    <dd
                      className={cn(
                        'mt-1 text-xl font-semibold tabular-nums',
                        ryczaltProfit !== null && ryczaltProfit < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {ryczaltProfit !== null ? formatMoney(ryczaltProfit) : '—'}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Szacowany podatek
                      {ryczaltRateLabel && ` (${ryczaltRateLabel})`}
                    </dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                      {estimatedTax !== null ? formatMoney(estimatedTax) : '—'}
                    </dd>
                  </div>
                </dl>
              )}
              {!hasCostAllocation && (
                <p className="mt-3 text-xs text-muted-foreground">
                  💡 Na ryczałcie podatek liczony jest od przychodu — nie od zysku. Jeśli masz
                  koszty firmowe (telefon, internet, leasing), włącz moduł Kosztów aby zobaczyć
                  realny wynik finansowy po odjęciu wydatków.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle className="text-lg">Podsumowanie sprzedaży</CardTitle>
              <p className="print-only mt-1 text-xs text-muted-foreground">
                Okres: {dateFrom} — {dateTo}
              </p>
            </div>
            <div className="no-print flex flex-wrap items-end gap-3">
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
                  <dd className="mt-1 text-[1.5rem] font-semibold tracking-tight tabular-nums">{sales.data.totalOrders}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Suma brutto
                  </dt>
                  <dd className="mt-1 text-[1.5rem] font-semibold tracking-tight tabular-nums">
                    {formatMoney(sales.data.totalGross)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Śr. wartość zamówienia
                  </dt>
                  <dd className="mt-1 text-[1.5rem] font-semibold tracking-tight tabular-nums">
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

        {/* ── JPK_EWP export card — ryczałt only ────────────────────────── */}
        {isRyczalt && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Ewidencja Przychodów — JPK_EWP</CardTitle>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Miesięczny plik XML do przekazania biuru rachunkowemu lub wysłania do Krajowej
                    Administracji Skarbowej.
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  Ryczałt
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Rok
                  </label>
                  <select
                    aria-label="Rok JPK_EWP"
                    value={ewpYear}
                    onChange={(e) => setEwpYear(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {[now.getFullYear() - 1, now.getFullYear()].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Miesiąc
                  </label>
                  <select
                    aria-label="Miesiąc JPK_EWP"
                    value={ewpMonth}
                    onChange={(e) => setEwpMonth(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {new Date(2000, m - 1).toLocaleString('pl-PL', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={ewpLoading}
                  onClick={() => void handleDownloadEwp()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {ewpLoading ? 'Generowanie…' : '⬇ Pobierz JPK_EWP'}
                </button>
              </div>
              {ewpError && (
                <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {ewpError}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Plik zawiera ewidencję przychodów (JPK_EWP v3) zgodną ze schematem Ministerstwa
                Finansów. Obejmuje wszystkie wystawione faktury w wybranym miesiącu.
              </p>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}

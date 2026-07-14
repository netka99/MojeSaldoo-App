import { useState } from 'react';
import { format, subMonths, startOfMonth, startOfYear, endOfYear, subYears } from 'date-fns';
import { Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useCustomerMarginQuery } from '@/query/use-reports';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { RyczaltManagerialNotice } from '@/components/reports/RyczaltManagerialNotice';
import type { CustomerMarginMissingProduct } from '@/types/reporting.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isNaN(n) ? '—' : pln.format(n);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)} %`;
}

function marginClass(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'text-muted-foreground';
  if (pct < 0) return 'text-red-600 font-semibold';
  if (pct < 10) return 'text-orange-500';
  if (pct < 30) return 'text-yellow-600';
  return 'text-green-600';
}

const inputClass = cn(
  'flex h-9 rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

type Preset = { label: string; from: string; to: string };

function getPresets(): Preset[] {
  const now = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  return [
    { label: '3 mies.', from: fmt(startOfMonth(subMonths(now, 2))), to: fmt(now) },
    { label: '6 mies.', from: fmt(startOfMonth(subMonths(now, 5))), to: fmt(now) },
    { label: '12 mies.', from: fmt(startOfMonth(subMonths(now, 11))), to: fmt(now) },
    { label: 'Ten rok', from: fmt(startOfYear(now)), to: fmt(now) },
    { label: 'Poprzedni rok', from: fmt(startOfYear(subYears(now, 1))), to: fmt(endOfYear(subYears(now, 1))) },
  ];
}

const tableClass = 'w-full border-collapse text-sm';
const thClass = 'border-b bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground';
const tdClass = 'border-b px-3 py-2';

export function CustomerMarginPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <CustomerMarginPageContent />;
}

function CustomerMarginPageContent() {
  const presets = getPresets();
  const [dateFrom, setDateFrom] = useState(presets[2].from); // 12 months default
  const [dateTo, setDateTo] = useState(presets[2].to);
  const [activePreset, setActivePreset] = useState<string>('12 mies.');

  const { data, isError, error, isFetching } = useCustomerMarginQuery(dateFrom, dateTo);

  function applyPreset(p: Preset) {
    setDateFrom(p.from);
    setDateTo(p.to);
    setActivePreset(p.label);
  }

  const rows = data?.rows ?? [];
  const missingProducts: CustomerMarginMissingProduct[] = data?.productsMissingCost ?? [];
  const incompleteCount = rows.filter((r) => !r.cogsComplete).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Marże na klientach</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Przychód vs. koszt własny sprzedaży (avg_cost × ilość) per klient.
        </p>
      </div>

      <RyczaltManagerialNotice />

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <CardTitle className="text-lg">Zestawienie klientów</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    activePreset === p.label
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* Custom date range */}
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor="cm-date-from" className="mb-1 block text-xs text-muted-foreground">Od</label>
                <input
                  id="cm-date-from"
                  type="date"
                  className={cn(inputClass, 'min-w-[9rem]')}
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setActivePreset(''); }}
                />
              </div>
              <div>
                <label htmlFor="cm-date-to" className="mb-1 block text-xs text-muted-foreground">Do</label>
                <input
                  id="cm-date-to"
                  type="date"
                  className={cn(inputClass, 'min-w-[9rem]')}
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setActivePreset(''); }}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isError && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : 'Błąd ładowania danych'}
            </p>
          )}
          {isFetching && !data && <p className="text-sm text-muted-foreground">Ładowanie…</p>}

          {missingProducts.length > 0 && (
            <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              <p className="font-medium mb-2">
                {incompleteCount} {incompleteCount === 1 ? 'klient ma' : 'klientów ma'} produkty bez kosztu zakupu
                (avg_cost) — marża dla tych klientów jest niedostępna.
              </p>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-yellow-700">
                Produkty bez avg_cost:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {missingProducts.map((p) => (
                  <li key={p.productId} className="text-xs">
                    {p.productName}
                    <span className="ml-2 text-yellow-600">
                      — dodaj PZ z kosztem lub ustaw avg_cost na produkcie
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Brak faktur w wybranym okresie.</p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className={tableClass} aria-label="Marże na klientach">
                <thead>
                  <tr>
                    <th className={thClass}>Klient</th>
                    <th className={cn(thClass, 'text-right')}>Faktury</th>
                    <th className={cn(thClass, 'text-right')}>Przychód brutto</th>
                    <th className={cn(thClass, 'text-right')}>COGS</th>
                    <th className={cn(thClass, 'text-right whitespace-nowrap')}>~COGS (est.)</th>
                    <th className={cn(thClass, 'text-right')}>Zysk brutto</th>
                    <th className={cn(thClass, 'text-right')}>Marża %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const displayProfit = row.grossProfit ?? row.estimatedGrossProfit;
                    const displayMargin = row.marginPercent ?? row.estimatedMarginPercent;
                    const isEstimated = row.grossProfit === null && row.estimatedGrossProfit !== null;
                    return (
                      <tr key={`${row.customerId ?? 'unknown'}-${i}`}>
                        <td className={tdClass}>{row.customerName}</td>
                        <td className={cn(tdClass, 'text-right tabular-nums text-muted-foreground')}>
                          {row.invoiceCount}
                        </td>
                        <td className={cn(tdClass, 'text-right tabular-nums')}>{formatMoney(row.totalRevenue)}</td>
                        <td className={cn(tdClass, 'text-right tabular-nums text-muted-foreground')}>
                          {row.cogsComplete ? formatMoney(row.cogs) : <span className="text-xs italic">—</span>}
                        </td>
                        <td className={cn(tdClass, 'text-right tabular-nums text-blue-500')}>
                          {row.estimatedCogs != null ? (
                            <span title="Szacunek z receptury">~ {formatMoney(row.estimatedCogs)}</span>
                          ) : '—'}
                        </td>
                        <td className={cn(tdClass, 'text-right tabular-nums')}>
                          <span className={Number(displayProfit) >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {formatMoney(displayProfit)}
                            {isEstimated && <span className="ml-1 text-[10px] text-blue-500">~</span>}
                          </span>
                        </td>
                        <td className={cn(tdClass, 'text-right tabular-nums', marginClass(displayMargin))}>
                          {formatPercent(displayMargin)}
                          {isEstimated && <span className="ml-1 text-[10px] text-blue-500">~</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

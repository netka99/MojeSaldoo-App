import { useState } from 'react';
import { format, subMonths, startOfMonth, startOfYear, endOfYear, subYears } from 'date-fns';
import { Link, Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useProfitLossQuery, useProfitLossMonthDetailQuery } from '@/query/use-reports';
import { downloadCsv } from '@/lib/downloadCsv';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { OPEX_CATEGORY_LABELS } from '@/services/ksef.service';
import { RyczaltManagerialNotice } from '@/components/reports/RyczaltManagerialNotice';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-default">
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] font-bold leading-none text-muted-foreground/60 select-none">
        i
      </span>
      <span className={cn(
        'pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 w-56 -translate-x-1/2',
        'rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-relaxed text-popover-foreground shadow-md',
        'opacity-0 transition-opacity group-hover:opacity-100',
      )}>
        {text}
        {/* small arrow pointing up */}
        <span className="absolute left-1/2 bottom-full -translate-x-1/2 border-4 border-transparent border-b-border" />
      </span>
    </span>
  );
}

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)} %`;
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

function defaultDates() {
  const now = new Date();
  return {
    from: format(startOfMonth(subMonths(now, 11)), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
  };
}

/** Simple CSS bar chart */
function BarChart({ rows }: { rows: { month: string; revenue: number; purchaseCosts: number; grossProfit: number }[] }) {
  const max = Math.max(...rows.map((r) => Math.max(r.revenue, r.purchaseCosts)), 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[600px] items-end gap-1 px-2 pb-2 pt-4" style={{ height: 200 }}>
        {rows.map((r) => {
          const revH = Math.round((r.revenue / max) * 160);
          const costH = Math.round((r.purchaseCosts / max) * 160);
          const profitH = r.grossProfit > 0 ? Math.round((r.grossProfit / max) * 160) : 0;
          return (
            <div key={r.month} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 165 }}>
                <div title={`Przychód: ${pln.format(r.revenue)}`} className="w-3 rounded-t bg-blue-500/80" style={{ height: revH }} />
                <div title={`Koszty: ${pln.format(r.purchaseCosts)}`} className="w-3 rounded-t bg-red-400/80" style={{ height: costH }} />
                <div title={`Zysk: ${pln.format(r.grossProfit)}`} className="w-3 rounded-t bg-green-500/80" style={{ height: profitH }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{r.month.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-4 px-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500/80" />Przychód</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400/80" />Koszty zakupów</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500/80" />Zysk brutto</span>
      </div>
    </div>
  );
}

const STATUS_PL: Record<string, string> = {
  draft: 'Szkic', issued: 'Wystawiona', sent: 'Wysłana', paid: 'Zapłacona', overdue: 'Przeterminowana', cancelled: 'Anulowana',
};

function MonthDrillDown({ month }: { month: string }) {
  const { data, isLoading } = useProfitLossMonthDetailQuery(month);

  if (isLoading) return <p className="px-4 py-3 text-xs text-muted-foreground">Ładowanie szczegółów…</p>;
  if (!data) return null;

  const hasInvoices = data.invoices.length > 0;
  const hasPZ = data.pz_documents.length > 0;

  return (
    <div className="grid gap-4 px-4 pb-4 pt-2 sm:grid-cols-2">
      {/* Invoices */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-blue-700">
          Faktury sprzedażowe ({data.invoices.length})
        </p>
        {!hasInvoices && <p className="text-xs text-muted-foreground">Brak faktur w tym miesiącu.</p>}
        <div className="space-y-1">
          {data.invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs">
              <div className="min-w-0">
                <Link to={`/invoices/${inv.id}`} className="font-medium text-blue-700 hover:underline">
                  {inv.invoice_number || inv.id.slice(0, 8)}
                </Link>
                <span className="ml-1.5 text-muted-foreground">{inv.customer_name}</span>
              </div>
              <div className="ml-2 shrink-0 text-right">
                <span className="font-medium text-blue-700">{formatMoney(inv.total_gross)}</span>
                <span className="ml-1.5 text-muted-foreground">{STATUS_PL[inv.status] ?? inv.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PZ documents */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-red-700">
          Dokumenty zakupu PZ ({data.pz_documents.length})
        </p>
        {!hasPZ && <p className="text-xs text-muted-foreground">Brak zaksięgowanych PZ w tym miesiącu.</p>}
        <div className="space-y-1">
          {data.pz_documents.map((pz) => (
            <div key={pz.id} className="flex items-center justify-between rounded-lg bg-red-50 px-2.5 py-1.5 text-xs">
              <div className="min-w-0">
                <Link to={`/delivery/${pz.id}`} className="font-medium text-red-700 hover:underline">
                  {pz.document_number || pz.id.slice(0, 8)}
                </Link>
                <span className="ml-1.5 text-muted-foreground">{pz.supplier_name || '—'}</span>
              </div>
              <span className="ml-2 shrink-0 font-medium text-red-700">{formatMoney(pz.total_cost)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* OPEX individual invoices */}
      {(data.opex_invoices ?? []).length > 0 && (
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-semibold text-orange-700">
            Koszty operacyjne OPEX ({data.opex_invoices.length})
          </p>
          <div className="space-y-1">
            {data.opex_invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-orange-800">
                    {OPEX_CATEGORY_LABELS[inv.opex_category as keyof typeof OPEX_CATEGORY_LABELS] ?? inv.opex_category}
                  </span>
                  <span className="text-muted-foreground">{inv.issue_date}</span>
                  {inv.invoice_number && (
                    <span className="font-mono text-orange-700">{inv.invoice_number}</span>
                  )}
                  <span className="text-muted-foreground truncate">{inv.seller_name}</span>
                </div>
                <span className="ml-2 shrink-0 font-medium text-orange-700">{formatMoney(inv.gross_amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProfitLossPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const defaults = defaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const { data, isLoading, isError } = useProfitLossQuery(dateFrom, dateTo);

  const presets = getPresets();

  const chartRows = (data?.rows ?? []).map((r) => ({
    month: r.month,
    revenue: Number(r.revenue),
    purchaseCosts: Number(r.purchaseCosts),
    grossProfit: Number(r.grossProfit),
  }));

  const totals = data?.totals;

  function applyPreset(p: Preset) {
    setDateFrom(p.from);
    setDateTo(p.to);
    setExpandedMonth(null);
  }

  function toggleMonth(month: string) {
    setExpandedMonth((prev) => (prev === month ? null : month));
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Zysk i Koszty (P&amp;L)</h1>
        {data && data.rows.length > 0 && (
          <button
            type="button"
            onClick={() => void downloadCsv('/reports/profit-loss/', { date_from: dateFrom, date_to: dateTo }, 'wynik-finansowy.csv')}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Pobierz CSV
          </button>
        )}
      </div>

      <RyczaltManagerialNotice />

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          {/* Quick presets */}
          <div className="mb-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  dateFrom === p.from && dateTo === p.to
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Manual date range */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Od</label>
              <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Do</label>
              <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Totals */}
      {totals && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: 'Przychody',
                tip: 'Suma brutto wystawionych faktur sprzedażowych (statusy: wystawiona, wysłana, zapłacona, przeterminowana) w wybranym okresie.',
                value: formatMoney(totals.revenue),
                color: 'text-blue-600',
              },
              {
                label: 'COGS',
                tip: 'Cost of Goods Sold — koszt własny sprzedaży. Suma wartości pozycji z przyjętych dokumentów PZ (unit_cost × ilość). Nie uwzględnia kosztów operacyjnych.',
                value: formatMoney(totals.purchaseCosts),
                color: 'text-red-500',
              },
              {
                label: 'Zysk brutto',
                tip: 'Przychody − COGS. Pokazuje, ile zostaje po pokryciu kosztu zakupu towarów, zanim odejmiemy koszty operacyjne (czynsz, media, usługi).',
                value: formatMoney(totals.grossProfit),
                color: Number(totals.grossProfit) >= 0 ? 'text-green-600' : 'text-red-600',
              },
              {
                label: 'Marża brutto',
                tip: 'Zysk brutto ÷ Przychody × 100%. Ile groszy zysku zostaje z każdej złotówki sprzedaży po odliczeniu kosztu towarów.',
                value: formatPercent(totals.marginPercent),
                color: 'text-foreground',
              },
            ].map(({ label, tip, value, color }) => (
              <Card key={label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground flex items-center">
                    {label}
                    <InfoTip text={tip} />
                  </p>
                  <p className={cn('mt-1 text-lg font-semibold', color)}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {Number(totals.opex) > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                {
                  label: 'Koszty operacyjne (OPEX)',
                  tip: 'Operating Expenses — koszty bieżącej działalności: media, czynsz, usługi zewnętrzne, transport, marketing. Pobierane z faktur zakupowych KSeF oznaczonych tagiem OPEX.',
                  value: formatMoney(totals.opex),
                  color: 'text-orange-600',
                },
                {
                  label: 'Zysk operacyjny',
                  tip: 'Zysk brutto − OPEX. Rzeczywisty wynik operacyjny po uwzględnieniu wszystkich kosztów działalności. Zbliżony do EBIT (bez odsetek i podatku).',
                  value: formatMoney(totals.operatingProfit),
                  color: Number(totals.operatingProfit) >= 0 ? 'text-green-700' : 'text-red-600',
                },
                {
                  label: 'Marża operacyjna',
                  tip: 'Zysk operacyjny ÷ Przychody × 100%. Pokazuje efektywność całej działalności — ile zostaje po pokryciu zarówno kosztu towarów, jak i kosztów operacyjnych.',
                  value: formatPercent(totals.operatingMarginPercent),
                  color: 'text-foreground',
                },
              ].map(({ label, tip, value, color }) => (
                <Card key={label}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground flex items-center">
                      {label}
                      <InfoTip text={tip} />
                    </p>
                    <p className={cn('mt-1 text-lg font-semibold', color)}>{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {Number(totals.fixedCosts ?? 0) > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                {
                  label: 'Koszty stałe',
                  tip: 'Ręcznie wprowadzone stałe wydatki miesięczne: wynagrodzenia, ZUS/zdrowotne, czynsz, leasing i inne koszty spoza KSeF.',
                  value: formatMoney(totals.fixedCosts),
                  color: 'text-purple-600',
                },
                {
                  label: 'Zysk netto',
                  tip: 'Zysk operacyjny − Koszty stałe. Rzeczywisty zarobek firmy po odjęciu wszystkich kosztów: towarów, OPEX i kosztów stałych (kadra, czynsz).',
                  value: formatMoney(totals.netProfit),
                  color: Number(totals.netProfit) >= 0 ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold',
                },
                {
                  label: 'Marża netto',
                  tip: 'Zysk netto ÷ Przychody × 100%. Ile realnie zarabiasz z każdej złotówki przychodu po wszystkich kosztach.',
                  value: formatPercent(totals.netMarginPercent ?? null),
                  color: 'text-foreground',
                },
              ].map(({ label, tip, value, color }) => (
                <Card key={label}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground flex items-center">
                      {label}
                      <InfoTip text={tip} />
                    </p>
                    <p className={cn('mt-1 text-lg font-semibold', color)}>{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Chart */}
      {!isLoading && !isError && chartRows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Miesięczny wykres</CardTitle></CardHeader>
          <CardContent><BarChart rows={chartRows} /></CardContent>
        </Card>
      )}

      {/* Table with drill-down */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Dane miesięczne
            <span className="ml-2 text-xs font-normal text-muted-foreground">— kliknij wiersz, żeby zobaczyć źródło danych</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {isError && <p className="p-4 text-sm text-destructive">Błąd ładowania danych.</p>}
          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-6 border-b bg-muted/50 px-3 py-2" />
                    <th className="border-b bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground">Miesiąc</th>
                    {([
                      { label: 'Przychody', tip: 'Suma brutto faktur sprzedażowych wystawionych w danym miesiącu.' },
                      { label: 'COGS', tip: 'Cost of Goods Sold — wartość przyjętych towarów z dokumentów PZ w danym miesiącu.' },
                      { label: 'Zysk brutto', tip: 'Przychody − COGS.' },
                      { label: 'OPEX', tip: 'Koszty operacyjne — faktury KSeF oznaczone tagiem OPEX (media, czynsz, usługi itp.).' },
                      { label: 'Zysk oper.', tip: 'Zysk brutto − OPEX. Wynik po wszystkich kosztach działalności.' },
                      { label: 'Koszty stałe', tip: 'Ręcznie wprowadzone miesięczne koszty stałe (wynagrodzenia, ZUS, czynsz itp.) z modułu Koszty Stałe.' },
                      { label: 'Zysk netto', tip: 'Zysk operacyjny − Koszty stałe. Realny zarobek firmy po wszystkich kosztach.' },
                      { label: 'Marża %', tip: 'Marża brutto = Zysk brutto ÷ Przychody × 100%. Nie uwzględnia OPEX.' },
                    ] as const).map(({ label, tip }) => (
                      <th key={label} title={tip} className="border-b bg-muted/50 px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap cursor-help">
                        {label}
                      </th>
                    ))}
                    <th className="border-b bg-muted/50 px-3 py-2 text-right font-medium text-muted-foreground">Faktury</th>
                    <th className="border-b bg-muted/50 px-3 py-2 text-right font-medium text-muted-foreground">PZ</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">
                        Brak danych dla wybranego okresu.
                      </td>
                    </tr>
                  ) : (
                    (data?.rows ?? []).map((row) => {
                      const profit = Number(row.grossProfit);
                      const opProfit = Number(row.operatingProfit ?? row.grossProfit);
                      const opex = Number(row.opex ?? 0);
                      const fixedCosts = Number(row.fixedCosts ?? 0);
                      const netProfit = Number(row.netProfit ?? row.operatingProfit ?? row.grossProfit);
                      const isExpanded = expandedMonth === row.month;
                      return (
                        <>
                          <tr
                            key={row.month}
                            className={cn('cursor-pointer hover:bg-muted/30', isExpanded && 'bg-muted/20')}
                            onClick={() => toggleMonth(row.month)}
                          >
                            <td className="border-b px-3 py-2 text-muted-foreground">
                              <svg
                                className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                              >
                                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </td>
                            <td className="border-b px-3 py-2 font-mono font-medium">{row.month}</td>
                            <td className="border-b px-3 py-2 text-right tabular-nums text-blue-600">{formatMoney(row.revenue)}</td>
                            <td className="border-b px-3 py-2 text-right tabular-nums text-red-500">{formatMoney(row.purchaseCosts)}</td>
                            <td className={cn('border-b px-3 py-2 text-right tabular-nums font-medium', profit >= 0 ? 'text-green-600' : 'text-red-600')}>
                              {formatMoney(row.grossProfit)}
                            </td>
                            <td className="border-b px-3 py-2 text-right tabular-nums text-orange-600">
                              {opex > 0 ? formatMoney(row.opex) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className={cn('border-b px-3 py-2 text-right tabular-nums font-medium', opProfit >= 0 ? 'text-green-700' : 'text-red-600')}>
                              {opex > 0 ? formatMoney(row.operatingProfit) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="border-b px-3 py-2 text-right tabular-nums text-purple-600">
                              {fixedCosts > 0 ? formatMoney(row.fixedCosts) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className={cn('border-b px-3 py-2 text-right tabular-nums font-semibold', netProfit >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                              {fixedCosts > 0 ? formatMoney(row.netProfit) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="border-b px-3 py-2 text-right tabular-nums text-muted-foreground">{formatPercent(row.marginPercent)}</td>
                            <td className="border-b px-3 py-2 text-right text-muted-foreground">
                              {row.invoiceCount > 0 ? (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{row.invoiceCount}</span>
                              ) : '—'}
                            </td>
                            <td className="border-b px-3 py-2 text-right text-muted-foreground">
                              {row.pzCount > 0 ? (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{row.pzCount}</span>
                              ) : '—'}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${row.month}-detail`}>
                              <td colSpan={12} className="border-b bg-muted/10 p-0">
                                <MonthDrillDown month={row.month} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

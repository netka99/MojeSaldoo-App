import { useState } from 'react';
import { format, subMonths, startOfMonth, startOfYear, endOfYear, subYears } from 'date-fns';
import { Link, Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useProductMarginQuery, useProductMarginDetailQuery } from '@/query/use-reports';
import { downloadCsv } from '@/lib/downloadCsv';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { RyczaltManagerialNotice } from '@/components/reports/RyczaltManagerialNotice';
import { ReportExpandIcon, ReportShell, reportButtonClass, reportCardClass, reportLabelClass, reportLinkClass, reportPresetClass, reportRowClass, reportSectionTitleClass, reportTdClass, reportTdMoneyClass, reportThClass, reportTitleClass, statusGoldClass } from '@/lib/reportSurface';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const qty4 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function formatCost(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'brak';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return 'brak';
  return qty4.format(n) + ' zł';
}

function formatQty(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isNaN(n) ? '—' : qty4.format(n);
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

const inputClass = 'date-pill';

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
    from: format(startOfYear(now), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
  };
}

const STATUS_PL: Record<string, string> = {
  draft: 'Szkic', issued: 'Wystawiona', sent: 'Wysłana', paid: 'Zapłacona',
  overdue: 'Przeterminowana', cancelled: 'Anulowana',
};

function PZLineCard({ line, colorClass, bgClass }: { line: { pz_id: string; document_number: string; issue_date: string; supplier_name: string; quantity: string | number; unit_cost: string | number; line_cost: string | number }; colorClass: string; bgClass: string }) {
  return (
    <div className={`rounded-lg ${bgClass} px-2.5 py-1.5 text-xs`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <Link to={`/delivery/${line.pz_id}`} className={`font-medium ${colorClass} hover:underline`}>
            {line.document_number || line.pz_id.slice(0, 8)}
          </Link>
          <span className="ml-1.5 text-muted-foreground">{line.supplier_name || '—'}</span>
          <span className="ml-1.5 text-muted-foreground">{line.issue_date}</span>
        </div>
        <span className={`ml-2 shrink-0 font-medium ${colorClass}`}>{formatMoney(line.line_cost)}</span>
      </div>
      <div className="mt-0.5 text-muted-foreground">
        {formatQty(line.quantity)} jm. × {formatCost(line.unit_cost)}/jm
      </div>
    </div>
  );
}

function ProductDrillDown({ productId, dateFrom, dateTo }: { productId: string; dateFrom: string; dateTo: string }) {
  const { data, isLoading } = useProductMarginDetailQuery(productId, dateFrom, dateTo);

  if (isLoading) return <p className="px-4 py-3 text-xs text-muted-foreground">Ładowanie szczegółów…</p>;
  if (!data) return null;

  return (
    <div className="space-y-4 px-4 pb-4 pt-2">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Invoice lines */}
        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-900">
            Sprzedaż — pozycje faktur ({data.invoice_lines.length})
          </p>
          {data.invoice_lines.length === 0 && (
            <p className="text-xs text-muted-foreground">Brak faktur z tym produktem w tym okresie.</p>
          )}
          <div className="space-y-1">
            {data.invoice_lines.map((line, i) => (
              <div key={`${line.invoice_id}-${i}`} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <Link to={`/invoices/${line.invoice_id}`} className={reportLinkClass}>
                      {line.invoice_number || line.invoice_id.slice(0, 8)}
                    </Link>
                    <span className="ml-1.5 text-muted-foreground">{line.customer_name}</span>
                    <span className="ml-1.5 text-muted-foreground">{line.issue_date}</span>
                  </div>
                  <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatMoney(line.line_gross)}</span>
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {formatQty(line.quantity)} szt. × {formatCost(line.unit_price_net)}/jm
                  <span className="ml-2">{STATUS_PL[line.status] ?? line.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PZ lines in period */}
        <div>
          <p className="mb-1.5 text-sm font-semibold text-red-700">
            Zakupy w okresie — pozycje PZ ({data.pz_lines.length})
          </p>
          {data.pz_lines.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Brak zaksięgowanych PZ z tym produktem w tym okresie.
              {' '}Śr. koszt pochodzi z wcześniejszych przyjęć — patrz historia poniżej.
            </p>
          )}
          <div className="space-y-1">
            {data.pz_lines.map((line, i) => (
              <PZLineCard key={`${line.pz_id}-${i}`} line={line} colorClass="text-red-700" bgClass="bg-red-50" />
            ))}
          </div>
        </div>
      </div>

      {/* Cost history */}
      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <p className="text-sm font-semibold text-orange-700">
            Śr. koszt zakupu — skąd pochodzi
          </p>
          <span className="text-xs text-muted-foreground">
            Aktualny śr. koszt: <span className="font-medium text-orange-700">{formatCost(data.avg_cost)}</span>
            {data.last_cost != null && (
              <> · Ostatni: <span className="font-medium">{formatCost(data.last_cost)}</span></>
            )}
            {data.avg_cost_updated_at && (
              <> · akt. {data.avg_cost_updated_at.slice(0, 10)}</>
            )}
          </span>
        </div>

        {/* Production orders (manufactured goods) */}
        {data.production_history.length > 0 && (
          <>
            <p className="mb-1 text-xs font-medium text-purple-700">Zlecenia produkcji (ostatnie {data.production_history.length})</p>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {data.production_history.map((po, i) => (
                <div key={`${po.order_number}-${i}`} className="rounded-lg bg-purple-50 px-2.5 py-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-purple-700">{po.order_number}</span>
                    <span className="ml-2 shrink-0 font-medium text-purple-700">{formatCost(po.real_unit_cost)}/jm</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {formatQty(po.quantity_produced)} szt. · łączny koszt {formatMoney(po.total_input_cost)}
                    {po.completed_at && <span className="ml-1.5">{po.completed_at}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* PZ receipts (purchased goods) */}
        {data.cost_history.length > 0 && (
          <>
            {data.production_history.length > 0 && <div className="mt-2" />}
            <p className="mb-1 text-xs font-medium text-orange-700">Przyjęcia PZ (ostatnie {data.cost_history.length})</p>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {data.cost_history.map((line, i) => (
                <PZLineCard key={`hist-${line.pz_id}-${i}`} line={line} colorClass="text-orange-700" bgClass="bg-orange-50" />
              ))}
            </div>
          </>
        )}

        {data.cost_history.length === 0 && data.production_history.length === 0 && (
          <p className="text-xs text-muted-foreground">Brak zaksięgowanych PZ ani zleceń produkcji dla tego produktu.</p>
        )}
      </div>
    </div>
  );
}

export function ProductMarginPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const defaults = defaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const { data: rows = [], isLoading, isError } = useProductMarginQuery(dateFrom, dateTo);

  const presets = getPresets();
  const hasCostData = rows.some((r) => r.avgCost !== null || r.estimatedCogs !== null);

  function applyPreset(p: Preset) {
    setDateFrom(p.from);
    setDateTo(p.to);
    setExpandedProduct(null);
  }

  function toggleProduct(productId: string) {
    setExpandedProduct((prev) => (prev === productId ? null : productId));
  }

  return (
    <ReportShell>
      <div className="flex items-center justify-between gap-3">
        <h1 className={reportTitleClass}>Marże na produktach</h1>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => void downloadCsv('/reports/product-margin/', { date_from: dateFrom, date_to: dateTo }, 'marze-produktow.csv')}
            className={reportButtonClass}
          >
            Pobierz CSV
          </button>
        )}
      </div>

      <RyczaltManagerialNotice />

      {/* Filters */}
      <Card className={reportCardClass}>
        <CardContent className="pt-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  reportPresetClass,
                  dateFrom === p.from && dateTo === p.to
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className={reportLabelClass}>Od</label>
              <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={reportLabelClass}>Do</label>
              <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* No cost data notice */}
      {!isLoading && !isError && rows.length > 0 && !hasCostData && (
        <div className={cn('rounded-2xl border px-4 py-3 text-sm text-yellow-800', statusGoldClass)}>
          Koszt zakupu (avg_cost) nie jest jeszcze obliczony dla żadnego produktu. Utwórz dokumenty PZ, dodaj receptury lub wpisz koszt ręcznie na produkcie.
        </div>
      )}
      {!isLoading && !isError && rows.some((r) => r.estimatedCogs !== null) && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span className="font-medium">~</span> Niektóre produkty nie mają kosztu z PZ/produkcji — marża szacunkowa obliczona z receptury.
        </div>
      )}

      {/* Table */}
      <Card className={reportCardClass}>
        <CardHeader>
          <CardTitle className={reportSectionTitleClass}>
            Produkty wg przychodu (top 50)
            <span className="ml-2 text-xs font-normal text-muted-foreground">— kliknij wiersz, żeby zobaczyć faktury i PZ</span>
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
                    <th className="w-6 border-b border-slate-200 bg-white px-3 py-3" />
                    <th className={reportThClass}>Produkt</th>
                    <th className={cn(reportThClass, 'text-right')}>Sprzedana ilość</th>
                    <th className={cn(reportThClass, 'text-right')}>Przychód</th>
                    <th className={cn(reportThClass, 'text-right')}>Śr. koszt</th>
                    <th className={cn(reportThClass, 'text-right')}>COGS</th>
                    <th className={cn(reportThClass, 'text-right')}>~COGS (est.)</th>
                    <th className={cn(reportThClass, 'text-right')}>Zysk brutto</th>
                    <th className={cn(reportThClass, 'text-right')}>Marża %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                        Brak faktur w wybranym okresie.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => {
                      const pid = row.productId ?? String(i);
                      const isExpanded = expandedProduct === pid;
                      const canExpand = Boolean(row.productId);
                      return (
                        <>
                          <tr
                            key={pid}
                            className={cn(
                              canExpand && cn(reportRowClass, 'cursor-pointer'),
                              isExpanded && 'bg-slate-50',
                            )}
                            onClick={() => canExpand && toggleProduct(pid)}
                          >
                            <td className="w-8 px-2 py-3">
                              {canExpand && <ReportExpandIcon open={isExpanded} />}
                            </td>
                            <td className={reportTdClass}>{row.productName || '—'}</td>
                            <td className={cn(reportTdClass, 'text-right tabular-nums')}>
                              {typeof row.totalQty === 'number' ? row.totalQty.toFixed(2) : Number(row.totalQty).toFixed(2)}
                            </td>
                            <td className={reportTdMoneyClass}>
                              {formatMoney(row.totalRevenue)}
                            </td>
                            <td className={cn(reportTdClass, 'text-right tabular-nums')}>
                              <span>{formatCost(row.avgCost)}</span>
                              {row.costSource && (
                                <span className={cn(
                                  'ml-1.5 rounded px-1 py-0.5 text-xs font-medium',
                                  row.costSource === 'production' ? 'bg-purple-100 text-purple-700' :
                                  row.costSource === 'pz' ? 'bg-green-100 text-green-700' :
                                  row.costSource === 'manual' ? 'bg-gray-100 text-gray-600' : ''
                                )}>
                                  {row.costSource === 'production' ? 'prod.' : row.costSource === 'pz' ? 'PZ' : row.costSource === 'manual' ? 'ręczny' : ''}
                                </span>
                              )}
                            </td>
                            <td className={reportTdMoneyClass}>
                              {formatMoney(row.cogs)}
                            </td>
                            <td className={cn(reportTdClass, 'text-right tabular-nums')}>
                              {row.estimatedCogs != null ? (
                                <span title="Szacunek z receptury">~ {formatMoney(row.estimatedCogs)}</span>
                              ) : '—'}
                            </td>
                            <td className={cn(reportTdMoneyClass, 'font-normal')}>
                              <span className={
                                (row.grossProfit ?? row.estimatedGrossProfit) !== null &&
                                Number(row.grossProfit ?? row.estimatedGrossProfit) >= 0
                                  ? 'text-green-600' : 'text-red-600'
                              }>
                                {formatMoney(row.grossProfit ?? row.estimatedGrossProfit)}
                                {row.grossProfit === null && row.estimatedGrossProfit !== null && (
                                  <span className="ml-1 text-xs text-slate-500">~</span>
                                )}
                              </span>
                            </td>
                            <td className={cn(reportTdMoneyClass, marginClass(row.marginPercent ?? row.estimatedMarginPercent))}>
                              {formatPercent(row.marginPercent ?? row.estimatedMarginPercent)}
                              {row.marginPercent === null && row.estimatedMarginPercent !== null && (
                                <span className="ml-1 text-xs text-slate-500">~</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && row.productId && (
                            <tr key={`${pid}-detail`}>
                              <td colSpan={9} className="border-b border-slate-100 bg-slate-50 p-0">
                                <ProductDrillDown
                                  productId={row.productId}
                                  dateFrom={dateFrom}
                                  dateTo={dateTo}
                                />
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
    </ReportShell>
  );
}

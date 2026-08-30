import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { usePeriodSummaryQuery, useHistoryQuery, useExpenseChartQuery } from '@/query/use-cashflow';
import { CashFlowSkeleton } from './CashFlowSkeleton';
import { QUICK_EXPENSE_CATEGORY_LABELS } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

const CATEGORY_COLORS: Record<string, string> = {
  raw_materials:       '#f59e0b',
  packaging:           '#10b981',
  fuel:                '#3b82f6',
  transport:           '#6366f1',
  utilities:           '#8b5cf6',
  rent:                '#ec4899',
  services:            '#14b8a6',
  marketing:           '#f97316',
  salaries:            '#ef4444',
  repair:              '#84cc16',
  other:               '#64748b',
  fixed_wynagrodzenia: '#ef4444',
  fixed_zus_zdrowotne: '#f97316',
  fixed_czynsz:        '#ec4899',
  fixed_leasing:       '#8b5cf6',
  fixed_ubezpieczenia: '#6366f1',
  fixed_ksiegowosc:    '#14b8a6',
  fixed_subskrypcje:   '#10b981',
  fixed_paliwo:        '#3b82f6',
  fixed_inne:          '#94a3b8',
};

const CATEGORY_LABELS: Record<string, string> = {
  ...QUICK_EXPENSE_CATEGORY_LABELS,
  fixed_wynagrodzenia: 'Wynagrodzenia',
  fixed_zus_zdrowotne: 'ZUS / Zdrowotne',
  fixed_czynsz:        'Czynsz / Najem',
  fixed_leasing:       'Leasing / Raty',
  fixed_ubezpieczenia: 'Ubezpieczenia',
  fixed_ksiegowosc:    'Biuro rachunkowe',
  fixed_subskrypcje:   'Subskrypcje',
  fixed_paliwo:        'Paliwo (stały)',
  fixed_inne:          'Inne stałe',
};

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type PeriodMode = 'this_year' | 'last_year' | 'custom';

function getPeriodDates(
  mode: PeriodMode,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const now = new Date();
  if (mode === 'this_year') {
    return { from: `${now.getFullYear()}-01-01`, to: format(now, 'yyyy-MM-dd') };
  }
  if (mode === 'last_year') {
    const y = now.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: customFrom, to: customTo };
}

function monthsInRange(from: string, to: string): number {
  if (!from || !to) return 12;
  const f = new Date(from);
  const t = new Date(to);
  return (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1;
}

function labelForCat(cat: string): string {
  if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
  const key = cat.startsWith('fixed_') ? cat.slice(6) : cat;
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

function shortMonth(period: string): string {
  try {
    return format(parseISO(`${period}-01`), 'MMM yy', { locale: pl });
  } catch {
    return period;
  }
}

// ---------------------------------------------------------------------------
// Revenue / Result trend chart
// ---------------------------------------------------------------------------

interface TrendChartProps {
  from: string;
  to: string;
}

function TrendChart({ from, to }: TrendChartProps) {
  const { data: history = [], isLoading } = useHistoryQuery();

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</div>;

  // filter to period
  const filtered = history
    .filter((m) => m.period >= from.slice(0, 7) && m.period <= to.slice(0, 7))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (filtered.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Brak danych w tym okresie.
      </p>
    );
  }

  const chartData = filtered.map((m) => ({
    name: shortMonth(m.period),
    przychod: m.revenue_total,
    koszty: m.costs_total,
    wynik: m.really_yours,
    isLoss: m.is_loss,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} barGap={2}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          width={52}
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ReferenceLine y={0} stroke="#e2e8f0" />
        <Tooltip
          formatter={(value: ValueType, name: NameType) => {
            const labels: Record<string, string> = {
              przychod: 'Przychód',
              koszty: 'Koszty',
              wynik: 'Wynik',
            };
            return [pln.format(Number(value ?? 0)), labels[String(name)] ?? String(name)];
          }}
        />
        <Bar dataKey="przychod" fill="#22c55e" radius={[3, 3, 0, 0]} opacity={0.7} />
        <Bar dataKey="koszty" fill="#f97316" radius={[3, 3, 0, 0]} opacity={0.7} />
        <Bar dataKey="wynik" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.isLoss ? '#ef4444' : '#16a34a'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Expense breakdown trend chart (stacked bars by category)
// ---------------------------------------------------------------------------

interface ExpenseTrendChartProps {
  from: string;
  to: string;
}

function ExpenseTrendChart({ from, to }: ExpenseTrendChartProps) {
  const months = monthsInRange(from, to);
  const multiParams = { months: Math.min(months, 12) };
  const { data = [], isLoading } = useExpenseChartQuery(multiParams);

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</div>;

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Brak danych kosztów w tym okresie.
      </p>
    );
  }

  const allCats = Array.from(
    new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== 'period' && k !== 'total'))),
  ).sort();

  // aggregate totals per category across all periods for legend ordering
  const catTotals = allCats.map((cat) => ({
    cat,
    total: data.reduce((s, d) => s + ((d[cat] as number) ?? 0), 0),
  })).sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={data.map((d) => ({ ...d, period: shortMonth(d.period as string) }))}
          margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
        >
          <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            width={52}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: ValueType, name: NameType) => [
              pln.format(Number(value ?? 0)),
              labelForCat(String(name)),
            ]}
          />
          {catTotals.map(({ cat }) => (
            <Bar
              key={cat}
              dataKey={cat}
              stackId="a"
              fill={CATEGORY_COLORS[cat] ?? '#94a3b8'}
              radius={cat === catTotals[catTotals.length - 1].cat ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {catTotals.filter((c) => c.total > 0).map(({ cat, total }) => (
          <div key={cat} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[cat] ?? '#94a3b8' }}
            />
            <span className="text-muted-foreground">{labelForCat(cat)}</span>
            <span className="font-medium tabular-nums">{pln.format(total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Tab
// ---------------------------------------------------------------------------

export function PeriodSummaryTab() {
  const [mode, setMode] = useState<PeriodMode>('this_year');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { from, to } = getPeriodDates(mode, customFrom, customTo);
  const enabled = mode !== 'custom' || (Boolean(customFrom) && Boolean(customTo));
  const { data, isLoading } = usePeriodSummaryQuery(enabled ? from : '', enabled ? to : '');

  const tabClass = (m: PeriodMode) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      mode === m
        ? 'bg-primary text-white shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="space-y-6">
      {/* Period picker */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-muted p-1 gap-1">
          <button onClick={() => setMode('this_year')} className={tabClass('this_year')}>
            Ten rok
          </button>
          <button onClick={() => setMode('last_year')} className={tabClass('last_year')}>
            Poprzedni rok
          </button>
          <button onClick={() => setMode('custom')} className={tabClass('custom')}>
            Własny zakres
          </button>
        </div>
      </div>

      {/* Custom date inputs */}
      {mode === 'custom' && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Od</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Do</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && <CashFlowSkeleton variant="month" />}

      {/* Waiting for custom range */}
      {!isLoading && !data && mode === 'custom' && !(customFrom && customTo) && (
        <p className="text-center text-sm text-muted-foreground py-8">
          Wybierz datę początkową i końcową, żeby zobaczyć podsumowanie.
        </p>
      )}

      {!isLoading && data && (
        <>
          <p className="text-xs text-muted-foreground">{data.date_from} – {data.date_to}</p>

          {/* Summary cards 2×2 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Przychód */}
            <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Mój przychód</p>
              <p className="text-3xl font-bold tracking-tight text-green-700">
                {pln.format(data.revenue_total)}
              </p>
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Faktury opłacone</span>
                  <span className="font-medium">{pln.format(data.revenue_b2b_paid)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Sprzedaż gotówkowa</span>
                  <span className="font-medium">{pln.format(data.revenue_b2c)}</span>
                </div>
              </div>
            </div>

            {/* Zysk / strata */}
            {(() => {
              const isLoss = data.profit_net < 0;
              const margin = data.revenue_total > 0
                ? Math.round((data.profit_net / data.revenue_total) * 100)
                : null;
              return (
                <div className={`rounded-2xl border p-5 ${isLoss ? 'border-red-200 bg-red-50' : 'border-primary/20 bg-primary/5'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="mb-2 text-sm font-medium text-muted-foreground">
                        {isLoss ? 'Strata' : 'Twój zysk'}
                      </p>
                      <p className={`text-3xl font-bold tracking-tight ${isLoss ? 'text-destructive' : 'text-foreground'}`}>
                        {pln.format(data.profit_net)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">Po kosztach i podatkach</p>
                    </div>
                    {margin !== null && (
                      <div className={`rounded-xl px-3 py-1.5 text-center ${isLoss ? 'bg-red-100' : 'bg-primary/10'}`}>
                        <p className={`text-xl font-bold ${isLoss ? 'text-destructive' : 'text-primary'}`}>{margin}%</p>
                        <p className="text-[10px] text-muted-foreground">marży</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Podatki */}
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Zapłaciłam państwu</p>
              <p className="text-3xl font-bold tracking-tight text-red-700">
                {pln.format(data.taxes_total)}
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-red-700 hover:underline underline-offset-2">
                  Szczegóły ▾
                </summary>
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>VAT</span>
                    <span className="font-medium">{pln.format(data.taxes_vat)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>ZUS społeczny</span>
                    <span className="font-medium">{pln.format(data.taxes_zus_social)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Składka zdrowotna</span>
                    <span className="font-medium">{pln.format(data.taxes_zus_health)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Podatek dochodowy</span>
                    <span className="font-medium">{pln.format(data.taxes_pit)}</span>
                  </div>
                </div>
              </details>
            </div>

            {/* Koszty */}
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Zapłaciłam dostawcom</p>
              <p className="text-3xl font-bold tracking-tight text-orange-700">
                {pln.format(data.costs_suppliers + data.costs_quick + data.costs_fixed_total)}
              </p>
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Faktury zakupowe (KSeF)</span>
                  <span className="font-medium">{pln.format(data.costs_suppliers)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Inne zakupy i wydatki</span>
                  <span className="font-medium">{pln.format(data.costs_quick)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Koszty stałe</span>
                  <span className="font-medium">{pln.format(data.costs_fixed_total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trend: przychód vs koszty vs wynik */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Trend miesięczny
              </h3>
            </div>
            <div className="px-4 pb-4 pt-3 space-y-3">
              {/* Legend */}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500 opacity-70" />
                  Przychód
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-orange-500 opacity-70" />
                  Koszty
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-700" />
                  Wynik
                </span>
              </div>
              <TrendChart from={from} to={to} />
            </div>
          </div>

          {/* Expense breakdown by category */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Na co idą pieniądze — miesiąc do miesiąca
              </h3>
            </div>
            <div className="px-4 pb-4 pt-3">
              <ExpenseTrendChart from={from} to={to} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

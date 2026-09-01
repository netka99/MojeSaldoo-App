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
  raw_materials:       '#fb923c',
  packaging:           '#bef264',
  fuel:                '#60a5fa',
  transport:           '#a78bfa',
  utilities:           '#c084fc',
  rent:                '#f472b6',
  services:            '#2dd4bf',
  marketing:           '#fb7185',
  salaries:            '#f87171',
  repair:              '#a3e635',
  other:               '#94a3b8',
  // FixedCost categories — standard
  fixed_wynagrodzenia: '#f87171',
  fixed_zus_zdrowotne: '#fdba74',
  fixed_czynsz:        '#f472b6',
  fixed_leasing:       '#c084fc',
  fixed_ubezpieczenia: '#818cf8',
  fixed_ksiegowosc:    '#34d399',
  fixed_subskrypcje:   '#5eead4',
  fixed_paliwo:        '#60a5fa',
  fixed_inne:          '#94a3b8',
  // FixedCost categories — common non-standard keys
  fixed_pracownicy:    '#fca5a5',
  fixed_wynajem:       '#e879f9',
  fixed_energia:       '#fbbf24',
  fixed_prad:          '#fde68a',
  fixed_gaz:           '#38bdf8',
  fixed_woda:          '#67e8f9',
  fixed_internet:      '#4ade80',
  fixed_telefon:       '#86efac',
  fixed_ubezp:         '#a5b4fc',
  fixed_serwis:        '#a3e635',
  fixed_media:         '#7dd3fc',
};

const FALLBACK_PALETTE = [
  '#a78bfa', '#60a5fa', '#34d399', '#fb923c',
  '#f472b6', '#2dd4bf', '#a3e635', '#fb7185', '#818cf8',
];

function colorForCat(cat: string): string {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  const hash = cat.split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1), 0);
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

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
        <Bar dataKey="przychod" fill="#4ade80" radius={[3, 3, 0, 0]} />
        <Bar dataKey="koszty" fill="#f87171" radius={[3, 3, 0, 0]} />
        <Bar dataKey="wynik" fill="#818cf8" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Top-5 cost breakdown (horizontal bars)
// ---------------------------------------------------------------------------

interface TopCostsProps {
  from: string;
  to: string;
}

function TopCosts({ from, to }: TopCostsProps) {
  const months = monthsInRange(from, to);
  const { data = [], isLoading } = useExpenseChartQuery({ months: Math.min(months, 12) });

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</div>;

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Brak skategoryzowanych kosztów w tym okresie.
      </p>
    );
  }

  const allCats = Array.from(
    new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== 'period' && k !== 'total'))),
  );

  const allTotals = allCats
    .map((cat) => ({
      category: cat,
      name: labelForCat(cat),
      value: data.reduce((s, d) => s + ((d[cat] as number) ?? 0), 0),
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  const top5 = allTotals.slice(0, 5);
  const restValue = allTotals.slice(5).reduce((s, c) => s + c.value, 0);
  const items = restValue > 0 ? [...top5, { category: 'other_rest', name: 'Inne', value: restValue }] : top5;

  const total = items.reduce((s, c) => s + c.value, 0);
  const max = Math.max(...items.map((c) => c.value), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const barPct = Math.max((item.value / max) * 100, 2);
        const totalPct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        const color = item.category === 'other_rest' ? '#94a3b8' : colorForCat(item.category);
        return (
          <div key={item.category} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-muted-foreground">{item.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {totalPct > 0 && <span className="text-muted-foreground/60">{totalPct}%</span>}
                <span className="font-semibold tabular-nums">{pln.format(item.value)}</span>
              </div>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${barPct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
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

  // Best / worst month from history
  const { data: history = [] } = useHistoryQuery();
  const periodMonths = history
    .filter((m) => m.period >= from.slice(0, 7) && m.period <= to.slice(0, 7))
    .sort((a, b) => a.period.localeCompare(b.period));
  const bestMonth = periodMonths.length >= 2
    ? periodMonths.reduce((best, m) => m.really_yours > best.really_yours ? m : best, periodMonths[0])
    : null;
  const worstMonth = periodMonths.length >= 2
    ? periodMonths.reduce((worst, m) => m.really_yours < worst.really_yours ? m : worst, periodMonths[0])
    : null;
  const showBestWorst = bestMonth && worstMonth && bestMonth.period !== worstMonth.period;

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

      {isLoading && <CashFlowSkeleton variant="month" />}

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
                      <div className={`group relative cursor-help rounded-xl px-3 py-1.5 text-center ${isLoss ? 'bg-red-100' : 'bg-primary/10'}`}>
                        <p className={`text-xl font-bold ${isLoss ? 'text-destructive' : 'text-primary'}`}>{margin}%</p>
                        <p className="text-[10px] text-muted-foreground">marży netto</p>
                        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 rounded-xl border border-border bg-card p-3 text-left shadow-xl opacity-0 transition-opacity group-hover:opacity-100 text-xs space-y-1.5">
                          <p className="font-semibold text-foreground">Jak liczymy marżę?</p>
                          <div className="space-y-1 text-muted-foreground">
                            <p>Zysk netto = Przychód</p>
                            <p className="pl-2">− Koszty (faktury, zakupy, stałe)</p>
                            <p className="pl-2">− VAT do zapłaty</p>
                            <p className="pl-2">− ZUS społeczny + zdrowotny</p>
                            <p className="pl-2">− Podatek dochodowy (PIT)</p>
                            <p className="pt-1 font-medium text-foreground">Marża = Zysk netto ÷ Przychód × 100%</p>
                          </div>
                          <p className="text-muted-foreground/70 text-[10px] pt-1 border-t border-border">
                            Pokazuje ile ze każdej złotówki przychodu zostaje po wszystkich kosztach i podatkach.
                          </p>
                        </div>
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

          {/* Best / worst month */}
          {showBestWorst && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Najlepszy miesiąc</p>
                <p className="mt-0.5 font-semibold capitalize text-sm">
                  {format(parseISO(`${bestMonth!.period}-01`), 'LLLL yyyy', { locale: pl })}
                </p>
                <p className="text-sm font-bold tabular-nums" style={{ color: '#4ade80' }}>
                  +{pln.format(bestMonth!.really_yours)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Najgorszy miesiąc</p>
                <p className="mt-0.5 font-semibold capitalize text-sm">
                  {format(parseISO(`${worstMonth!.period}-01`), 'LLLL yyyy', { locale: pl })}
                </p>
                <p className="text-sm font-bold tabular-nums" style={{ color: '#f87171' }}>
                  {pln.format(worstMonth!.really_yours)}
                </p>
              </div>
            </div>
          )}

          {/* Trend chart */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Trend miesięczny
              </h3>
            </div>
            <div className="px-4 pb-4 pt-3 space-y-3">
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#4ade80' }} />
                  Przychód
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#f87171' }} />
                  Koszty
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#818cf8' }} />
                  Wynik
                </span>
              </div>
              <TrendChart from={from} to={to} />
            </div>
          </div>

          {/* Top 5 cost breakdown */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Największe koszty
              </h3>
            </div>
            <div className="px-4 pb-4 pt-3">
              <TopCosts from={from} to={to} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

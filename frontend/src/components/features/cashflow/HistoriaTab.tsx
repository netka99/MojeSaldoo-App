import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { pl } from 'date-fns/locale';
import { useHistoryQuery, useExpenseChartQuery } from '@/query/use-cashflow';
import { QUICK_EXPENSE_CATEGORY_LABELS } from '@/types/cashflow.types';
import { CashFlowSkeleton } from './CashFlowSkeleton';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

const FALLBACK_PALETTE = [
  '#a78bfa', '#60a5fa', '#34d399', '#fb923c',
  '#f472b6', '#2dd4bf', '#a3e635', '#fb7185', '#818cf8',
];

function colorForCat(cat: string): string {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  const hash = cat.split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1), 0);
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

function labelForCat(cat: string): string {
  if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
  const key = cat.startsWith('fixed_') ? cat.slice(6) : cat;
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RangePreset = '3m' | '6m' | '12m' | 'custom';

interface HistoriaTabProps {
  onSelectMonth: (month: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortMonthLabel(period: string): string {
  return format(parseISO(`${period}-01`), 'LLL yy', { locale: pl });
}

function computeRange(preset: RangePreset, customFrom: string, customTo: string) {
  const now = new Date();

  if (preset === 'custom') {
    const dateFrom = customFrom ? `${customFrom}-01` : format(startOfMonth(subMonths(now, 5)), 'yyyy-MM-dd');
    const dateTo = customTo ? format(endOfMonth(parseISO(`${customTo}-01`)), 'yyyy-MM-dd') : format(endOfMonth(now), 'yyyy-MM-dd');
    return { dateFrom, dateTo };
  }

  const monthsBack = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
  const dateFrom = format(startOfMonth(subMonths(now, monthsBack - 1)), 'yyyy-MM-dd');
  const dateTo = format(endOfMonth(now), 'yyyy-MM-dd');
  return { dateFrom, dateTo };
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const revenue = payload.find((p) => p.name === 'Przychód')?.value ?? 0;
  const costs = payload.find((p) => p.name === 'Koszty')?.value ?? 0;
  const net = payload.find((p) => p.name === 'Wynik')?.value ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-xs space-y-1">
      <p className="font-semibold capitalize text-foreground">{label}</p>
      <p style={{ color: '#4ade80' }}>Przychód: <span className="font-semibold tabular-nums">{pln.format(revenue)}</span></p>
      <p style={{ color: '#f87171' }}>Koszty: <span className="font-semibold tabular-nums">{pln.format(costs)}</span></p>
      <p style={{ color: '#818cf8' }}>Wynik: <span className="font-semibold tabular-nums">{pln.format(net)}</span></p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HistoriaTab({ onSelectMonth }: HistoriaTabProps) {
  const [range, setRange] = useState<RangePreset>('6m');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const now = new Date();
    return format(startOfMonth(subMonths(now, 5)), 'yyyy-MM');
  });
  const [customTo, setCustomTo] = useState<string>(() => {
    return format(new Date(), 'yyyy-MM');
  });

  const { data, isLoading } = useHistoryQuery();

  const { dateFrom, dateTo } = useMemo(
    () => computeRange(range, customFrom, customTo),
    [range, customFrom, customTo],
  );

  const fromMonth = dateFrom.slice(0, 7);
  const toMonth = dateTo.slice(0, 7);

  const filtered = useMemo(
    () =>
      (data ?? [])
        .filter((m) => m.period >= fromMonth && m.period <= toMonth)
        .sort((a, b) => a.period.localeCompare(b.period)),
    [data, fromMonth, toMonth],
  );

  const { data: expenseData = [], isLoading: expenseLoading } = useExpenseChartQuery({
    date_from: dateFrom,
    date_to: dateTo,
  });

  // --- Aggregated KPIs ---
  const totalRevenue = filtered.reduce((s, m) => s + m.revenue_total, 0);
  const totalCosts = filtered.reduce((s, m) => s + m.costs_total, 0);
  const totalNet = filtered.reduce((s, m) => s + m.really_yours, 0);
  const avgMargin =
    filtered.length > 0
      ? filtered.filter((m) => m.margin_pct !== null && Math.abs(m.margin_pct) <= 200).reduce((s, m) => s + (m.margin_pct ?? 0), 0) /
        Math.max(filtered.filter((m) => m.margin_pct !== null && Math.abs(m.margin_pct) <= 200).length, 1)
      : null;

  const bestMonth = filtered.length > 0
    ? filtered.reduce((best, m) => (m.really_yours > best.really_yours ? m : best), filtered[0])
    : null;
  const worstMonth = filtered.length > 0
    ? filtered.reduce((worst, m) => (m.really_yours < worst.really_yours ? m : worst), filtered[0])
    : null;

  // --- Chart data ---
  const chartData = filtered.map((m) => ({
    name: shortMonthLabel(m.period),
    Przychód: m.revenue_total,
    Koszty: m.costs_total,
    Wynik: m.really_yours,
  }));

  // --- Top 5 costs + "Inne" ---
  const allCategories = Array.from(
    new Set(
      expenseData.flatMap((d) =>
        Object.keys(d).filter((k) => k !== 'period' && k !== 'total'),
      ),
    ),
  );

  const allCategoryTotals = allCategories
    .map((cat) => ({
      category: cat,
      name: labelForCat(cat),
      value: expenseData.reduce((s, d) => s + ((d[cat] as number) ?? 0), 0),
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  const top5 = allCategoryTotals.slice(0, 5);
  const restValue = allCategoryTotals.slice(5).reduce((s, c) => s + c.value, 0);
  const categoryTotals = restValue > 0 ? [...top5, { category: 'other', name: 'Inne', value: restValue }] : top5;

  const catTotal = categoryTotals.reduce((s, c) => s + c.value, 0);
  const catMax = Math.max(...categoryTotals.map((c) => c.value), 1);

  const RANGE_OPTIONS: { key: RangePreset; label: string }[] = [
    { key: '3m', label: '3 mies' },
    { key: '6m', label: '6 mies' },
    { key: '12m', label: 'Rok' },
    { key: 'custom', label: 'Własny' },
  ];

  if (isLoading) return <CashFlowSkeleton variant="month" />;

  return (
    <div className="space-y-5">
      {/* 1. Range selector */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setRange(opt.key)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              range === opt.key
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}

        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <input
              type="month"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Brak danych dla wybranego okresu.
        </p>
      )}

      {filtered.length > 0 && (
        <>
          {/* 2. KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Przychód</p>
              <p className="mt-1 text-base font-bold tabular-nums" style={{ color: '#4ade80' }}>
                +{pln.format(totalRevenue)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Koszty</p>
              <p className="mt-1 text-base font-bold tabular-nums" style={{ color: '#f87171' }}>
                −{pln.format(totalCosts)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Zostaje</p>
              <p
                className="mt-1 text-base font-bold tabular-nums"
                style={{ color: totalNet >= 0 ? '#4ade80' : '#f87171' }}
              >
                {pln.format(totalNet)}
              </p>
            </div>
            <div className="group relative rounded-xl border border-border bg-card p-3 text-center cursor-help">
              <p className="text-xs text-muted-foreground">Śr. marża</p>
              <p
                className="mt-1 text-base font-bold tabular-nums"
                style={{
                  color: avgMargin === null ? '#94a3b8' : avgMargin >= 0 ? '#4ade80' : '#f87171',
                }}
              >
                {avgMargin !== null ? `${Math.round(avgMargin)}%` : '—'}
              </p>
              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-xl border border-border bg-card p-3 text-left shadow-xl opacity-0 transition-opacity group-hover:opacity-100 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">Jak liczymy marżę?</p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Zostaje</span> = Przychód − Koszty − VAT − ZUS − PIT
                </p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Marża</span> = Zostaje ÷ Przychód × 100%
                </p>
                <p className="text-muted-foreground/70 text-[10px] pt-1 border-t border-border">
                  Średnia z wszystkich miesięcy w wybranym zakresie. Pokazuje ile ze każdej złotówki przychodu faktycznie zostaje po wszystkich kosztach i podatkach.
                </p>
              </div>
            </div>
          </div>

          {/* 3. Best / worst month */}
          {filtered.length >= 2 && bestMonth && worstMonth && bestMonth.period !== worstMonth.period && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Najlepszy miesiąc</p>
                <p className="mt-0.5 font-semibold capitalize text-sm">
                  {format(parseISO(`${bestMonth.period}-01`), 'LLLL yyyy', { locale: pl })}
                </p>
                <p className="text-sm font-bold tabular-nums" style={{ color: '#4ade80' }}>
                  +{pln.format(bestMonth.really_yours)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Najgorszy miesiąc</p>
                <p className="mt-0.5 font-semibold capitalize text-sm">
                  {format(parseISO(`${worstMonth.period}-01`), 'LLLL yyyy', { locale: pl })}
                </p>
                <p className="text-sm font-bold tabular-nums" style={{ color: '#f87171' }}>
                  {pln.format(worstMonth.really_yours)}
                </p>
              </div>
            </div>
          )}

          {/* 4. Revenue vs Costs trend chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-border bg-card px-2 pb-3 pt-4">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Trend miesiąc do miesiąca
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                    }
                    width={36}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="Przychód" fill="#4ade80" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="Koszty" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line
                    type="monotone"
                    dataKey="Wynik"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#818cf8' }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 justify-center text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#4ade80' }} />
                  Przychód
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: '#f87171' }} />
                  Koszty
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3" style={{ backgroundColor: '#818cf8' }} />
                  Wynik
                </span>
              </div>
            </div>
          )}

          {/* 5. Top 5 cost categories + "Inne" */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Największe koszty
              </h3>
              {catTotal > 0 && (
                <span className="text-xs text-muted-foreground">
                  Łącznie:{' '}
                  <span className="font-semibold text-foreground">{pln.format(catTotal)}</span>
                </span>
              )}
            </div>

            <div className="space-y-3 px-4 pb-4 pt-3">
              {expenseLoading && (
                <p className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</p>
              )}

              {!expenseLoading && categoryTotals.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Brak skategoryzowanych kosztów w wybranym okresie.
                </p>
              )}

              {!expenseLoading &&
                categoryTotals.map((item) => {
                  const barPct = Math.max((item.value / catMax) * 100, 2);
                  const totalPct = catTotal > 0 ? Math.round((item.value / catTotal) * 100) : 0;
                  const color = colorForCat(item.category);
                  return (
                    <div key={item.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-muted-foreground">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {totalPct > 0 && (
                            <span className="text-muted-foreground/60">{totalPct}%</span>
                          )}
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
          </div>

          {/* 6. Month table */}
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Miesiące
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Miesiąc</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Przychód</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Koszty</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Zostaje</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      <span className="group relative inline-flex items-center gap-1 cursor-help">
                        Marża
                        <svg className="h-3 w-3 text-muted-foreground/50" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM7 7h1v5H7V7z"/>
                        </svg>
                        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-56 rounded-xl border border-border bg-card p-3 text-left shadow-xl opacity-0 transition-opacity group-hover:opacity-100 text-xs space-y-1 normal-case font-normal">
                          <p className="font-semibold text-foreground">Marża netto</p>
                          <p className="text-muted-foreground">Zostaje ÷ Przychód × 100%</p>
                          <p className="text-muted-foreground/70 text-[10px] pt-1 border-t border-border">„Zostaje" to przychód po odliczeniu kosztów, VAT, ZUS i PIT.</p>
                        </div>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...filtered].reverse().map((item) => {
                    const isLoss = item.is_loss;
                    const marginAbs = item.margin_pct !== null ? Math.abs(item.margin_pct) : null;
                    const showMargin = marginAbs !== null && marginAbs <= 200;
                    const isBest = bestMonth?.period === item.period && filtered.length >= 2;
                    const isWorst = worstMonth?.period === item.period && filtered.length >= 2 && bestMonth?.period !== worstMonth?.period;

                    return (
                      <tr
                        key={item.period}
                        onClick={() => onSelectMonth(item.period)}
                        className="cursor-pointer border-b border-border/50 last:border-0 transition-colors hover:bg-primary/5 active:bg-primary/10"
                      >
                        <td className="px-4 py-2.5 font-medium capitalize">
                          <span className="flex items-center gap-2">
                            {format(parseISO(`${item.period}-01`), 'LLLL yyyy', { locale: pl })}
                            {isBest && (
                              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                                najlepszy
                              </span>
                            )}
                            {isWorst && (
                              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                                najgorszy
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: '#4ade80' }}>
                          {pln.format(item.revenue_total)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: '#f87171' }}>
                          {pln.format(item.costs_total)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right tabular-nums font-semibold"
                          style={{ color: isLoss ? '#f87171' : '#4ade80' }}
                        >
                          {pln.format(item.really_yours)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {showMargin ? (
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                                isLoss ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {item.margin_pct}%
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

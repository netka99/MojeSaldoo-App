import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { useExpenseChartQuery } from '@/query/use-cashflow';
import { QUICK_EXPENSE_CATEGORY_LABELS } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  raw_materials: '#f59e0b',
  packaging:     '#10b981',
  fuel:          '#3b82f6',
  transport:     '#6366f1',
  utilities:     '#8b5cf6',
  rent:          '#ec4899',
  services:      '#14b8a6',
  marketing:     '#f97316',
  salaries:      '#ef4444',
  repair:        '#84cc16',
  fixed:         '#94a3b8',
  other:         '#64748b',
};

const CATEGORY_LABELS: Record<string, string> = {
  ...QUICK_EXPENSE_CATEGORY_LABELS,
  fixed: 'Koszty stałe',
};

type ViewMode = 'month' | '6months' | 'year' | 'custom';

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

// ---------------------------------------------------------------------------
// Single-period bar list (pure CSS — no squishing on mobile)
// ---------------------------------------------------------------------------

interface BarItem {
  name: string;
  value: number;
  category: string;
}

function SinglePeriodBars({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.category}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-semibold tabular-nums">{pln.format(item.value)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max((item.value / max) * 100, 2)}%`,
                backgroundColor: CATEGORY_COLORS[item.category] ?? '#94a3b8',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpenseChart() {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const params =
    viewMode === 'custom'
      ? { date_from: dateFrom, date_to: dateTo }
      : viewMode === '6months'
        ? { months: 6 }
        : viewMode === 'year'
          ? { months: 12 }
          : { months: 1 };

  const enabled = viewMode !== 'custom' || (Boolean(dateFrom) && Boolean(dateTo));
  const { data = [], isLoading } = useExpenseChartQuery(enabled ? params : { months: 1 });

  const allCategories = Array.from(
    new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== 'period' && k !== 'total'))),
  );

  const isSinglePeriod = viewMode === 'month' || viewMode === 'custom';

  const singlePeriodData: BarItem[] =
    isSinglePeriod && data[0]
      ? allCategories
          .map((cat) => ({
            name: CATEGORY_LABELS[cat] ?? cat,
            value: (data[0][cat] as number) ?? 0,
            category: cat,
          }))
          .filter((d) => d.value > 0)
          .sort((a, b) => b.value - a.value)
      : [];

  const VIEW_LABELS: Record<ViewMode, string> = {
    month: 'Miesiąc',
    '6months': '6 mies.',
    year: 'Rok',
    custom: 'Zakres',
  };

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      {/* Header + mode buttons */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Koszty wg kategorii
        </h3>
        <div className="flex gap-1">
          {(['month', '6months', 'year', 'custom'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                viewMode === mode
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {VIEW_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Date pickers for custom range */}
      {viewMode === 'custom' && (
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
          <span className="shrink-0 text-muted-foreground text-sm">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <p className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</p>
      )}

      {/* Single period: empty state */}
      {!isLoading && isSinglePeriod && singlePeriodData.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Brak skategoryzowanych kosztów w tym okresie.
        </p>
      )}

      {/* Single period: CSS bar list — no Recharts squishing */}
      {!isLoading && isSinglePeriod && singlePeriodData.length > 0 && (
        <SinglePeriodBars items={singlePeriodData} />
      )}

      {/* Multi-period: stacked bar */}
      {!isLoading && !isSinglePeriod && data.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ left: 0, right: 4, top: 4, bottom: 4 }}>
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis
              width={48}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(value: ValueType | undefined, name: NameType | undefined) =>
                [
                  pln.format(Number(value ?? 0)),
                  CATEGORY_LABELS[String(name ?? '')] ?? String(name ?? ''),
                ] as [string, string]
              }
            />
            <Legend
              formatter={(value: string) => CATEGORY_LABELS[value] ?? value}
              wrapperStyle={{ fontSize: 11 }}
            />
            {allCategories.map((cat) => (
              <Bar
                key={cat}
                dataKey={cat}
                stackId="a"
                fill={CATEGORY_COLORS[cat] ?? '#94a3b8'}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Multi-period: empty state */}
      {!isLoading && !isSinglePeriod && data.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Brak danych.</p>
      )}

      {/* Total for single period */}
      {!isLoading && isSinglePeriod && (data[0]?.total as number) > 0 && (
        <div className="border-t border-border pt-2 flex justify-between text-sm">
          <span className="text-muted-foreground">Łącznie</span>
          <span className="font-bold">{pln.format(data[0].total as number)}</span>
        </div>
      )}
    </div>
  );
}

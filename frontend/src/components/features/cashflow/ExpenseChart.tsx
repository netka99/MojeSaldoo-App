import { useExpenseChartQuery } from '@/query/use-cashflow';
import { QUICK_EXPENSE_CATEGORY_LABELS } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  // QuickExpense categories
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
  // FixedCost categories (prefixed fixed_)
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
  // FixedCost categories
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

function labelForCat(cat: string): string {
  if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
  const key = cat.startsWith('fixed_') ? cat.slice(6) : cat;
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExpenseChartProps {
  /** YYYY-MM — when provided, fetches data for that specific month */
  month?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpenseChart({ month }: ExpenseChartProps) {
  const params = month ? { date_from: `${month}-01`, date_to: lastDayOf(month) } : { months: 1 };
  const { data = [], isLoading } = useExpenseChartQuery(params);

  const allCategories = Array.from(
    new Set(data.flatMap((d) => Object.keys(d).filter((k) => k !== 'period' && k !== 'total'))),
  );

  const items =
    data[0]
      ? allCategories
          .map((cat) => ({
            name: labelForCat(cat),
            value: (data[0][cat] as number) ?? 0,
            category: cat,
          }))
          .filter((d) => d.value > 0)
          .sort((a, b) => b.value - a.value)
      : [];

  const total = (data[0]?.total as number) ?? 0;
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Na co idą pieniądze?
        </h3>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            Łącznie: <span className="font-semibold text-foreground">{pln.format(total)}</span>
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 pb-4 pt-3">
        {isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Ładowanie…</p>
        )}

        {!isLoading && items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Brak skategoryzowanych kosztów w tym miesiącu.
          </p>
        )}

        {!isLoading && items.map((item) => {
          const pct = Math.max((item.value / max) * 100, 2);
          const totalPct = total > 0 ? Math.round((item.value / total) * 100) : 0;
          return (
            <div key={item.category} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? '#94a3b8' }}
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
                  style={{
                    width: `${pct}%`,
                    backgroundColor: CATEGORY_COLORS[item.category] ?? '#94a3b8',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

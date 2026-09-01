import { useExpenseChartQuery } from '@/query/use-cashflow';
import { QUICK_EXPENSE_CATEGORY_LABELS } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  // QuickExpense categories
  raw_materials:       '#fb923c',
  packaging:           '#34d399',
  fuel:                '#60a5fa',
  transport:           '#a78bfa',
  utilities:           '#c084fc',
  rent:                '#f472b6',
  services:            '#2dd4bf',
  marketing:           '#fb7185',
  salaries:            '#f87171',
  repair:              '#a3e635',
  other:               '#94a3b8',
  // FixedCost categories (prefixed fixed_) — standard
  fixed_wynagrodzenia: '#f87171',
  fixed_zus_zdrowotne: '#fb923c',
  fixed_czynsz:        '#f472b6',
  fixed_leasing:       '#c084fc',
  fixed_ubezpieczenia: '#a78bfa',
  fixed_ksiegowosc:    '#2dd4bf',
  fixed_subskrypcje:   '#34d399',
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
  fixed_ubezp:         '#818cf8',
  fixed_serwis:        '#a3e635',
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

const FALLBACK_PALETTE = [
  '#a78bfa', '#60a5fa', '#34d399', '#fb923c',
  '#f472b6', '#2dd4bf', '#a3e635', '#fb7185', '#818cf8',
];

function colorForCat(cat: string): string {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  // Positional hash avoids collisions for strings sharing the same characters
  const hash = cat.split('').reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1), 0);
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

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
                    style={{ backgroundColor: colorForCat(item.category) }}
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
                    backgroundColor: colorForCat(item.category),
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

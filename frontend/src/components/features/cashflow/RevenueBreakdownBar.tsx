import type { CashFlowMonth } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

interface RevenueBreakdownBarProps {
  month: CashFlowMonth;
}

interface ExpenseRow {
  label: string;
  value: number;
  color: string;
  bgColor: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RevenueBreakdownBar({ month }: RevenueBreakdownBarProps) {
  const totalRevenue = month.revenue_paid + month.b2c_revenue;

  if (totalRevenue <= 0) return null;

  const totalCosts = month.costs_ksef + month.costs_quick + month.costs_fixed;
  const totalTaxes = month.zus_monthly + month.vat_to_pay + month.pit_estimate;
  const totalOutgoings = totalCosts + totalTaxes;
  const isLoss = month.really_yours_estimate < 0;
  const coveragePct = Math.min(Math.round((totalRevenue / totalOutgoings) * 100), 100);
  const outstanding = month.revenue_outstanding;

  // Expense rows shown in loss view — relative to max value for bar widths
  const expenseRows: ExpenseRow[] = [
    { label: 'Koszty stałe + inne', value: totalCosts,         color: '#64748b', bgColor: 'bg-slate-400' },
    { label: 'ZUS',                  value: month.zus_monthly,  color: '#eab308', bgColor: 'bg-yellow-400' },
    { label: 'VAT',                  value: month.vat_to_pay,   color: '#f97316', bgColor: 'bg-orange-400' },
    { label: 'Podatek doch.',        value: month.pit_estimate,  color: '#ef4444', bgColor: 'bg-red-400' },
  ].filter((r) => r.value > 0);

  const maxExpense = Math.max(...expenseRows.map((r) => r.value), totalRevenue);

  // For profit view — stacked bar segments
  const barSegments = [
    { label: 'Koszty',        value: totalCosts,                  color: '#94a3b8' },
    { label: 'ZUS',           value: month.zus_monthly,           color: '#eab308' },
    { label: 'VAT',           value: month.vat_to_pay,            color: '#f97316' },
    { label: 'Podatek doch.', value: month.pit_estimate,          color: '#ef4444' },
    { label: 'Twój wynik',   value: month.really_yours_estimate,  color: '#22c55e' },
  ].filter((s) => s.value > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Co się dzieje z przychodem?
        </h3>
        <span className="text-xs text-muted-foreground">
          Wpłynęło: {pln.format(totalRevenue)}
        </span>
      </div>

      <div className="space-y-4 px-4 pb-4 pt-3">
      {isLoss ? (
        /* ── LOSS VIEW ── */
        <div className="space-y-4">
          {/* Coverage indicator */}
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <div>
                <span className="text-2xl font-bold text-destructive">{coveragePct}%</span>
                <span className="ml-1.5 text-sm text-muted-foreground">wydatków pokryte</span>
              </div>
              <span className="text-xs text-muted-foreground">
                brakuje{' '}
                <span className="font-semibold text-destructive">
                  {pln.format(Math.abs(month.really_yours_estimate))}
                </span>
              </span>
            </div>

            {/* Coverage bar */}
            <div className="relative h-5 w-full overflow-hidden rounded-full bg-red-100">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${coveragePct}%` }}
              />
              {/* Divider label */}
              <div
                className="absolute top-0 bottom-0 flex items-center"
                style={{ left: `${coveragePct}%` }}
              >
                <div className="h-full w-0.5 bg-white/60" />
              </div>
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-green-700 font-medium">{pln.format(totalRevenue)} przychód</span>
              <span className="text-destructive font-medium">{pln.format(totalOutgoings)} wydatki</span>
            </div>
          </div>

          {/* Expense breakdown — relative bars */}
          <div className="space-y-3 border-t border-border pt-3">
            {/* Income row for comparison */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Przychód</span>
                <span className="font-semibold text-green-700 tabular-nums">{pln.format(totalRevenue)}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500"
                  style={{ width: `${Math.max((totalRevenue / maxExpense) * 100, 2)}%` }}
                />
              </div>
            </div>

            {expenseRows.map((row, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: row.color }}>{pln.format(row.value)}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${row.bgColor}`}
                    style={{ width: `${Math.max((row.value / maxExpense) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {outstanding > 0 && (
            <p className="text-xs text-muted-foreground border-t border-border pt-2">
              + {pln.format(outstanding)} oczekuje na zapłatę — po wpłacie wynik:{' '}
              <span className={month.really_yours_estimate + outstanding >= 0 ? 'font-semibold text-green-600' : 'font-semibold text-destructive'}>
                {pln.format(month.really_yours_estimate + outstanding)}
              </span>
            </p>
          )}
        </div>
      ) : (
        /* ── PROFIT VIEW — stacked bar ── */
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex h-8 w-full overflow-hidden rounded-xl">
              {barSegments.map((seg, i) => {
                const pct = totalRevenue > 0 ? (seg.value / totalRevenue) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center overflow-hidden transition-all"
                    style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: seg.color }}
                    title={`${seg.label}: ${pln.format(seg.value)}`}
                  >
                    {pct > 10 && (
                      <span className="text-[10px] font-semibold text-white drop-shadow">
                        {Math.round(pct)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {outstanding > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2 w-4 rounded-sm"
                  style={{ backgroundColor: '#cbd5e1', border: '1px dashed #94a3b8' }}
                />
                + {pln.format(outstanding)} oczekuje na zapłatę
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-border pt-3">
            {barSegments.map((seg, i) => {
              const isResult = seg.label === 'Twój wynik';
              return (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className={isResult ? 'font-medium' : 'text-muted-foreground'}>{seg.label}</span>
                  </div>
                  <span className={`tabular-nums ml-2 ${isResult ? 'font-semibold text-green-600' : 'text-muted-foreground'}`}>
                    {pln.format(seg.value)}
                  </span>
                </div>
              );
            })}
          </div>

          {outstanding > 0 && (
            <p className="text-xs text-muted-foreground text-center border-t border-border pt-2">
              Z nierozliczonymi należnościami wynik mógłby wynieść{' '}
              <span className="font-semibold text-green-600">
                {pln.format(month.really_yours_estimate + outstanding)}
              </span>
            </p>
          )}
        </div>
      )}
      </div>{/* space-y-4 wrapper */}
    </div>
  );
}

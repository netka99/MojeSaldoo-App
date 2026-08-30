import { format, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';
import { useHistoryQuery } from '@/query/use-cashflow';
import { CashFlowSkeleton } from './CashFlowSkeleton';

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

interface HistoriaTabProps {
  onSelectMonth: (month: string) => void;
}

export function HistoriaTab({ onSelectMonth }: HistoriaTabProps) {
  const { data, isLoading } = useHistoryQuery();

  if (isLoading) return <CashFlowSkeleton variant="month" />;

  if (!data || data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Brak danych historycznych. Dodaj przychody lub koszty, żeby zobaczyć historię.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.length} {data.length === 1 ? 'miesiąc' : data.length < 5 ? 'miesiące' : 'miesięcy'} z danymi
      </p>

      {data.map((item) => {
        const isLoss = item.is_loss;
        const marginAbs = item.margin_pct !== null ? Math.abs(item.margin_pct) : null;
        const showMargin = marginAbs !== null && marginAbs <= 200;

        return (
          <button
            key={item.period}
            onClick={() => onSelectMonth(item.period)}
            className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              {/* Left: month label + revenue/costs */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold capitalize">
                  {format(parseISO(`${item.period}-01`), 'LLLL yyyy', { locale: pl })}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>
                    Przychód:{' '}
                    <span className="font-medium text-foreground">{pln.format(item.revenue_total)}</span>
                  </span>
                  <span>
                    Koszty:{' '}
                    <span className="font-medium text-foreground">{pln.format(item.costs_total)}</span>
                  </span>
                </div>
              </div>

              {/* Right: zysk + margin badge */}
              <div className="shrink-0 text-right">
                <p
                  className={`text-base font-bold tabular-nums ${
                    isLoss ? 'text-destructive' : 'text-green-600'
                  }`}
                >
                  {pln.format(item.really_yours)}
                </p>
                {showMargin && (
                  <span
                    className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isLoss
                        ? 'bg-red-100 text-destructive'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {item.margin_pct}%
                  </span>
                )}
              </div>
            </div>

            <p className="mt-2 text-right text-xs text-muted-foreground">
              Kliknij, żeby zobaczyć szczegóły →
            </p>
          </button>
        );
      })}
    </div>
  );
}

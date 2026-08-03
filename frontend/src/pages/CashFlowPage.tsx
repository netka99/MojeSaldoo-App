import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, addMonths, subMonths, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';

import { useCashFlowDashboardQuery, useQuickExpensesQuery } from '@/query/use-cashflow';
import { ExpenseChart } from '@/components/features/cashflow/ExpenseChart';
import { KosztySheet } from '@/components/features/cashflow/KosztySheet';
import { TaxConfigSetup } from '@/components/features/cashflow/TaxConfigSetup';
import { QUICK_EXPENSE_CATEGORY_LABELS } from '@/types/cashflow.types';
import type { TaxObligation, QuickExpense } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 });

function formatPln(value: number): string {
  return pln.format(value);
}

function obligationBadge(daysUntil: number): string {
  if (daysUntil < 3) return 'bg-destructive/10 text-destructive';
  if (daysUntil < 7) return 'bg-orange-500/10 text-orange-600';
  if (daysUntil < 14) return 'bg-yellow-500/10 text-yellow-600';
  return 'bg-green-500/10 text-green-700';
}

// ---------------------------------------------------------------------------
// Today Tab
// ---------------------------------------------------------------------------

const plnSmall = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 });

interface TodayTabProps {
  currentMonth: string;
  onOpenConfig: () => void;
  onOpenKoszty: () => void;
}

function TodayTab({ currentMonth, onOpenConfig, onOpenKoszty }: TodayTabProps) {
  const { data, isLoading } = useCashFlowDashboardQuery();
  const { data: expenses = [] } = useQuickExpensesQuery(currentMonth);
  const today = data?.today;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  if (!today) return null;

  const balanceIsStale = !today.balance_updated_at;

  return (
    <div className="space-y-5">
      {/* Missing balance banner */}
      {balanceIsStale && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 dark:border-yellow-700 dark:bg-yellow-950">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Nie podano salda kont. Aktualizuj saldo, żeby zobaczyć realne środki.
          </p>
          <button
            onClick={onOpenConfig}
            className="mt-1 text-sm font-semibold text-yellow-900 underline dark:text-yellow-100"
          >
            Wpisz saldo
          </button>
        </div>
      )}

      {/* Main number */}
      <div className="rounded-2xl bg-primary/5 p-5 text-center">
        <p className="mb-1 text-sm font-medium text-muted-foreground">Naprawdę Twoje</p>
        <p
          className={`text-4xl font-bold tracking-tight ${today.really_yours < 0 ? 'text-destructive' : 'text-foreground'}`}
        >
          {formatPln(today.really_yours)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Gotówka {formatPln(today.cash_balance)} + Konto {formatPln(today.bank_balance)} − Zarezerwowane{' '}
          {formatPln(today.total_reserved)}
        </p>
        {today.balance_updated_at && (
          <p className="mt-1 text-xs text-muted-foreground">
            Saldo z {format(parseISO(today.balance_updated_at), 'd MMM HH:mm', { locale: pl })}
          </p>
        )}
      </div>

      {/* Balances row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground">Gotówka</p>
          <p className="mt-1 text-lg font-semibold">{formatPln(today.cash_balance)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground">Konto firmowe</p>
          <p className="mt-1 text-lg font-semibold">{formatPln(today.bank_balance)}</p>
        </div>
      </div>

      {/* Upcoming obligations */}
      {today.upcoming_obligations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Nadchodzące płatności
          </h3>
          {today.upcoming_obligations.map((ob: TaxObligation, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl border border-border p-3">
              <div>
                <p className="text-sm font-medium">{ob.label}</p>
                <p className="text-xs text-muted-foreground">
                  Termin: {format(parseISO(ob.due_date), 'd MMM yyyy', { locale: pl })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{formatPln(ob.amount)}</p>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${obligationBadge(ob.days_until)}`}
                >
                  {ob.days_until === 0
                    ? 'Dziś!'
                    : ob.days_until < 0
                      ? `${Math.abs(ob.days_until)} dni po terminie`
                      : `za ${ob.days_until} dni`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {today.upcoming_obligations.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">Brak nadchodzących zobowiązań.</p>
      )}

      {/* Quick expenses */}
      <div className="rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Koszty gotówkowe
          </h3>
          <button
            onClick={onOpenKoszty}
            className="text-xs font-medium text-primary hover:underline underline-offset-2"
          >
            + Dodaj
          </button>
        </div>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak kosztów w tym miesiącu.</p>
        ) : (
          <>
            {expenses.slice(0, 3).map((exp: QuickExpense) => (
              <div key={exp.id} className="flex items-center justify-between text-sm">
                <span className="truncate text-muted-foreground">
                  {QUICK_EXPENSE_CATEGORY_LABELS[exp.category]}
                  {exp.vendor ? ` · ${exp.vendor}` : ''}
                </span>
                <span className="ml-2 shrink-0 font-medium">
                  {plnSmall.format(parseFloat(exp.amount))}
                </span>
              </div>
            ))}
          </>
        )}
        <button
          onClick={onOpenKoszty}
          className="mt-1 text-xs font-medium text-primary hover:underline underline-offset-2"
        >
          {expenses.length > 3
            ? `Zobacz wszystkie (${expenses.length}) →`
            : expenses.length > 0
              ? 'Zarządzaj kosztami →'
              : null}
        </button>
      </div>

      {/* Actions */}
      <button
        onClick={onOpenConfig}
        className="w-full rounded-xl border border-primary py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
      >
        Aktualizuj saldo
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month Tab
// ---------------------------------------------------------------------------

interface MonthTabProps {
  currentMonth: string;
  setCurrentMonth: (m: string) => void;
  onOpenKoszty: () => void;
}

function MonthTab({ currentMonth, setCurrentMonth, onOpenKoszty }: MonthTabProps) {
  const now = new Date();
  const { data, isLoading } = useCashFlowDashboardQuery(currentMonth);
  const month = data?.month;

  const prevMonth = () =>
    setCurrentMonth(format(subMonths(parseISO(`${currentMonth}-01`), 1), 'yyyy-MM'));
  const nextMonth = () =>
    setCurrentMonth(format(addMonths(parseISO(`${currentMonth}-01`), 1), 'yyyy-MM'));

  const isCurrentMonth =
    currentMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Month picker */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          aria-label="Poprzedni miesiąc"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          ←
        </button>
        <span className="text-sm font-semibold">
          {format(parseISO(`${currentMonth}-01`), 'LLLL yyyy', { locale: pl })}
        </span>
        <button
          onClick={nextMonth}
          disabled={isCurrentMonth}
          aria-label="Następny miesiąc"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          →
        </button>
      </div>

      {/* Uncategorized invoices warning banner */}
      {month && month.uncategorized_ksef_count > 0 && (
        <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 dark:border-orange-700 dark:bg-orange-950">
          <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
            {month.uncategorized_ksef_count === 1
              ? '1 faktura zakupowa bez kategorii'
              : `${month.uncategorized_ksef_count} faktury zakupowe bez kategorii`}{' '}
            — nie są wliczone w koszty.
          </p>
          <Link
            to="/ksef/inbox"
            className="mt-1 inline-block text-sm font-semibold text-orange-900 underline underline-offset-2 dark:text-orange-100"
          >
            Przypisz kategorie →
          </Link>
        </div>
      )}

      {month ? (
        <>
          {/* Revenue block */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Przychody</h3>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Faktury opłacone (B2B)</span>
              <span className="font-medium">{formatPln(month.revenue_paid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Faktury oczekujące (B2B)</span>
              <span className="font-medium text-yellow-600">{formatPln(month.revenue_outstanding)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Sprzedaż B2C (kasa)</span>
              <span className="font-medium">{formatPln(month.b2c_revenue)}</span>
            </div>
          </div>

          {/* Costs block */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Koszty</h3>
              <button
                onClick={onOpenKoszty}
                className="text-xs font-medium text-primary hover:underline underline-offset-2"
              >
                + Dodaj koszt
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Faktury zakupowe (KSeF)</span>
              <span className="font-medium">{formatPln(month.costs_ksef)}</span>
            </div>
            <button
              onClick={onOpenKoszty}
              className="flex w-full items-center justify-between text-sm hover:bg-muted/50 rounded-lg px-1 py-0.5 -mx-1 transition-colors"
            >
              <span className="text-muted-foreground">Koszty gotówkowe</span>
              <span className="font-medium">{formatPln(month.costs_quick)}</span>
            </button>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Koszty stałe</span>
              <span className="font-medium">{formatPln(month.costs_fixed)}</span>
            </div>
          </div>

          {/* Tax reservations */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zarezerwuj na podatki</h3>

            {/* VAT row with breakdown */}
            <div className="space-y-1">
              <div className="flex items-start justify-between text-sm">
                <div>
                  <span className="text-muted-foreground">VAT do zapłaty</span>
                  {month.vat_due_date && (
                    <p className="text-xs text-muted-foreground">
                      Termin: {format(parseISO(month.vat_due_date), 'd MMM', { locale: pl })}
                    </p>
                  )}
                  {/* Breakdown: output - input */}
                  <p className="text-xs text-muted-foreground">
                    Należny: {formatPln(month.vat_output)} − Naliczony: {formatPln(month.vat_input)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-medium">{formatPln(month.vat_to_pay)}</span>
                  {month.vat_surplus > 0 && (
                    <p className="text-xs text-green-600">
                      nadpłata {formatPln(month.vat_surplus)}
                    </p>
                  )}
                </div>
              </div>

              {/* Invoices contributing to VAT input */}
              {month.vat_input_invoices.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-primary hover:underline underline-offset-2 list-none">
                    Faktury odliczające VAT ({month.vat_input_invoices.length}) ▾
                  </summary>
                  <div className="mt-1.5 space-y-1 rounded-lg bg-muted/50 p-2">
                    {month.vat_input_invoices.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between">
                        <span className="truncate text-muted-foreground">
                          {inv.vendor || 'Nieznany dostawca'} · {format(parseISO(inv.issue_date), 'd MMM', { locale: pl })}
                        </span>
                        <span className="ml-2 shrink-0 font-medium text-foreground">
                          {formatPln(inv.vat_amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {month.vat_input_invoices.length === 0 && month.vat_input === 0 && (
                <p className="text-xs text-muted-foreground">
                  Brak skategoryzowanych faktur zakupowych z VAT.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="text-muted-foreground">ZUS</span>
                {month.zus_due_date && (
                  <p className="text-xs text-muted-foreground">
                    Termin: {format(parseISO(month.zus_due_date), 'd MMM', { locale: pl })}
                  </p>
                )}
              </div>
              <span className="font-medium">{formatPln(month.zus_monthly)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="text-muted-foreground">PIT</span>
                {month.pit_is_estimate && (
                  <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    ~szacunek
                  </span>
                )}
              </div>
              <span className="font-medium">{formatPln(month.pit_estimate)}</span>
            </div>
          </div>

          {/* Really yours estimate */}
          <div className="rounded-2xl bg-primary/5 p-5 text-center">
            <p className="mb-1 text-sm font-medium text-muted-foreground">Szacowany Twój wynik</p>
            <p
              className={`text-3xl font-bold tracking-tight ${month.really_yours_estimate < 0 ? 'text-destructive' : 'text-foreground'}`}
            >
              {formatPln(month.really_yours_estimate)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Po odliczeniu kosztów i podatków (szacunek)
            </p>
          </div>

          {/* Expense breakdown chart */}
          <ExpenseChart />
        </>
      ) : (
        <p className="text-center text-sm text-muted-foreground">Brak danych za wybrany miesiąc.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function nowMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function CashFlowPage() {
  const [activeTab, setActiveTab] = useState<'today' | 'month'>('today');
  const [currentMonth, setCurrentMonth] = useState(nowMonth);
  const [kosztyOpen, setKosztyOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="min-h-screen pb-10">
      <div className="mx-auto max-w-lg px-4 pt-5">
        {/* Header */}
        <h1 className="mb-4 text-xl font-bold tracking-tight">Saldo i Podatki</h1>

        {/* Tabs */}
        <div className="mb-5 flex rounded-xl bg-muted p-1">
          <button
            onClick={() => setActiveTab('today')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              activeTab === 'today'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Dziś
          </button>
          <button
            onClick={() => setActiveTab('month')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              activeTab === 'month'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Miesiąc
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'today' ? (
          <TodayTab
            currentMonth={currentMonth}
            onOpenConfig={() => setConfigOpen(true)}
            onOpenKoszty={() => setKosztyOpen(true)}
          />
        ) : (
          <MonthTab
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            onOpenKoszty={() => setKosztyOpen(true)}
          />
        )}
      </div>

      {/* Sheets */}
      <KosztySheet
        open={kosztyOpen}
        onClose={() => setKosztyOpen(false)}
        month={currentMonth}
      />
      <TaxConfigSetup open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}

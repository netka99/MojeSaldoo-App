import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, addMonths, subMonths, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';

import { useCashFlowDashboardQuery, useQuickExpensesQuery } from '@/query/use-cashflow';
import { CashFlowSkeleton } from '@/components/features/cashflow/CashFlowSkeleton';
import { ExpenseChart } from '@/components/features/cashflow/ExpenseChart';
import { KosztySheet } from '@/components/features/cashflow/KosztySheet';
import { HistoriaTab } from '@/components/features/cashflow/HistoriaTab';
import { PeriodSummaryTab } from '@/components/features/cashflow/PeriodSummaryTab';
import { TaxConfigSetup } from '@/components/features/cashflow/TaxConfigSetup';
import { TaxSettingsModal } from '@/components/features/cashflow/TaxSettingsModal';
import type { CashFlowMonth, TaxObligation, Receivable, PayablesData } from '@/types/cashflow.types';

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

function obligationBorderColor(daysUntil: number, amount: number): string {
  if (amount === 0) return '#e2e8f0';
  if (daysUntil < 3) return '#ef4444';
  if (daysUntil < 7) return '#f97316';
  if (daysUntil < 14) return '#eab308';
  return '#22c55e';
}

function daysBadge(days: number): string {
  if (days < 0) return 'bg-destructive/10 text-destructive';
  if (days < 3) return 'bg-destructive/10 text-destructive';
  if (days < 7) return 'bg-orange-500/10 text-orange-600';
  if (days < 14) return 'bg-yellow-500/10 text-yellow-600';
  return 'bg-green-500/10 text-green-700';
}

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} dni po terminie`;
  if (days === 0) return 'Dziś!';
  return `za ${days} dni`;
}

// Categories treated as variable/operational costs for the waterfall
const VARIABLE_COST_SLUGS = new Set([
  'raw_materials', 'packaging', 'fuel', 'transport',
]);

function plFaktura(n: number): string {
  if (n === 1) return 'faktura';
  if (n >= 2 && n <= 4) return 'faktury';
  return 'faktur';
}

// ---------------------------------------------------------------------------
// TaxPaymentRow — expandable tax obligation row
// ---------------------------------------------------------------------------

interface TaxPaymentRowProps {
  label: React.ReactNode;
  amount: number;
  dueDate?: string | null;
  daysUntil?: number;
  surplus?: number;
  children?: React.ReactNode;
}

function TaxPaymentRow({ label, amount, dueDate, daysUntil, surplus, children }: TaxPaymentRowProps) {
  const [open, setOpen] = useState(false);
  const hasDue = daysUntil !== undefined;
  const borderColor = hasDue ? obligationBorderColor(daysUntil!, amount) : '#e2e8f0';

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        className="w-full flex items-start justify-between p-3 border-l-4 bg-card hover:bg-muted/40 transition-colors text-left"
        style={{ borderLeftColor: borderColor }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          {dueDate && (
            <p className="text-xs text-muted-foreground">
              Termin: {format(parseISO(dueDate), 'd MMM yyyy', { locale: pl })}
            </p>
          )}
          {surplus !== undefined && surplus > 0 && (
            <p className="text-xs text-green-600">nadpłata {formatPln(surplus)}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <div className="text-right">
            <p className="text-sm font-semibold">{formatPln(amount)}</p>
            {hasDue && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${obligationBadge(daysUntil!)}`}>
                {daysUntil === 0
                  ? 'Dziś!'
                  : daysUntil! < 0
                    ? `${Math.abs(daysUntil!)} dni po terminie`
                    : `za ${daysUntil} dni`}
              </span>
            )}
          </div>
          {children && (
            <span className="text-xs text-muted-foreground">{open ? '▲' : '▼'}</span>
          )}
        </div>
      </button>
      {open && children && (
        <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PrzychodyBlock
// ---------------------------------------------------------------------------

interface PrzychodyBlockProps {
  month: CashFlowMonth;
  receivables?: Receivable[];
}

function PrzychodyBlock({ month, receivables }: PrzychodyBlockProps) {
  const [paidOpen, setPaidOpen] = useState(false);
  const [outstandingOpen, setOutstandingOpen] = useState(false);

  // When receivables[] is provided (current month), use live data for count+total.
  // month.revenue_outstanding includes only THIS month's issued invoices,
  // while receivables[] contains ALL unpaid invoices (incl. older months).
  const outstandingCount = receivables ? receivables.length : (month.revenue_outstanding_count ?? 0);
  const outstandingTotal = receivables
    ? receivables.reduce((s, r) => s + r.amount, 0)
    : month.revenue_outstanding;

  const overdue = receivables?.filter((r) => (r.days_until ?? 0) < 0).reduce((s, r) => s + r.amount, 0) ?? 0;
  const soon = receivables?.filter((r) => { const d = r.days_until ?? 0; return d >= 0 && d <= 7; }).reduce((s, r) => s + r.amount, 0) ?? 0;
  const later = receivables?.filter((r) => (r.days_until ?? 0) > 7).reduce((s, r) => s + r.amount, 0) ?? 0;

  const hasPaidDetails = (month.revenue_paid_top?.length ?? 0) > 0;
  const hasOutstandingDetails = outstandingCount > 0 || (month.revenue_outstanding_top?.length ?? 0) > 0;
  const hasUrgencyPills = receivables && receivables.length > 0 && (overdue > 0 || soon > 0 || later > 0);

  const cashReceived = month.revenue_paid + month.b2c_revenue;

  return (
    <div className="overflow-hidden rounded-xl border border-border border-t-[3px] border-t-green-500">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-green-50/60 px-4 py-3 dark:bg-green-950/20">
        <h3 className="text-sm font-bold uppercase tracking-wide text-green-800 dark:text-green-300">
          Przychody
        </h3>
        <Link to="/invoices" className="text-xs font-medium text-green-700 hover:underline underline-offset-2 dark:text-green-400">
          Faktury →
        </Link>
      </div>

      {/* Faktury opłacone */}
      <button
        type="button"
        disabled={!hasPaidDetails}
        className="w-full flex items-start justify-between px-4 py-3.5 hover:bg-green-50/40 dark:hover:bg-green-950/10 transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
        onClick={() => hasPaidDetails && setPaidOpen((v) => !v)}
      >
        <div>
          <p className="text-sm font-medium">Faktury opłacone</p>
          <p className="text-xs text-muted-foreground">
            {month.revenue_paid_count ?? 0} {plFaktura(month.revenue_paid_count ?? 0)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-base font-bold ${month.revenue_paid > 0 ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}>
            {formatPln(month.revenue_paid)}
          </span>
          {hasPaidDetails && (
            <span className="text-xs text-muted-foreground">{paidOpen ? '▲' : '▼'}</span>
          )}
        </div>
      </button>
      {paidOpen && hasPaidDetails && (
        <div className="mx-4 mb-3 space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">Największe wpłaty:</p>
          {month.revenue_paid_top!.map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="max-w-[60%] truncate text-muted-foreground">{item.name}</span>
              <span className="font-medium tabular-nums">{formatPln(item.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Faktury oczekujące */}
      <div className="border-t-2 border-border/60">
        <button
          type="button"
          disabled={!hasOutstandingDetails}
          className="w-full flex items-start justify-between px-4 py-3.5 hover:bg-yellow-50/40 dark:hover:bg-yellow-950/10 transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => hasOutstandingDetails && setOutstandingOpen((v) => !v)}
        >
          <div>
            <p className="text-sm font-medium">Faktury oczekujące</p>
            <p className="text-xs text-muted-foreground">
              {outstandingCount} {plFaktura(outstandingCount)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-base font-bold ${outstandingTotal > 0 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
              {formatPln(outstandingTotal)}
            </span>
            {hasOutstandingDetails && (
              <span className="text-xs text-muted-foreground">{outstandingOpen ? '▲' : '▼'}</span>
            )}
          </div>
        </button>

        {/* Urgency pills */}
        {hasUrgencyPills && (
          <div className="flex gap-2 px-4 pb-3">
            {overdue > 0 && (
              <div className="flex-1 rounded-lg bg-destructive/10 px-2 py-2 text-center">
                <p className="text-xs font-semibold text-destructive">{formatPln(overdue)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Zaległe</p>
              </div>
            )}
            {soon > 0 && (
              <div className="flex-1 rounded-lg bg-orange-500/10 px-2 py-2 text-center">
                <p className="text-xs font-semibold text-orange-600">{formatPln(soon)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Do 7 dni</p>
              </div>
            )}
            {later > 0 && (
              <div className="flex-1 rounded-lg bg-green-500/10 px-2 py-2 text-center">
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">{formatPln(later)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Później</p>
              </div>
            )}
          </div>
        )}

        {/* Expanded: current month — individual invoices */}
        {outstandingOpen && receivables && receivables.length > 0 && (
          <div className="divide-y divide-border border-t border-border">
            {receivables.map((r) => (
              <Link
                key={r.id}
                to={`/invoices/${r.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <p className="truncate text-sm font-medium">{r.customer_name || r.invoice_number}</p>
                  {r.customer_name && r.invoice_number && (
                    <p className="text-xs text-muted-foreground">{r.invoice_number}</p>
                  )}
                  {r.due_date && (
                    <p className="text-xs text-muted-foreground">
                      Termin: {format(parseISO(r.due_date), 'd MMM', { locale: pl })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-yellow-600">{formatPln(r.amount)}</p>
                    {r.days_until !== null && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${daysBadge(r.days_until)}`}>
                        {daysLabel(r.days_until)}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Expanded: historical — top outstanding */}
        {outstandingOpen && !receivables && (month.revenue_outstanding_top?.length ?? 0) > 0 && (
          <div className="mx-4 mb-3 space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">Czekasz na zapłatę od:</p>
            {month.revenue_outstanding_top!.map((item, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="max-w-[60%] truncate text-muted-foreground">{item.name}</span>
                <span className="font-medium tabular-nums text-yellow-600">{formatPln(item.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sprzedaż gotówkowa */}
      <div className="flex items-center justify-between border-t-2 border-border/60 px-4 py-3.5">
        <div>
          <p className="text-sm font-medium">Sprzedaż gotówkowa / B2C</p>
          {(month.b2c_entries_count ?? 0) > 0 ? (
            <p className="text-xs text-muted-foreground">{month.b2c_entries_count} wpisów</p>
          ) : (
            <Link
              to={`/cash-flow/sprzedaz?month=${month.period}`}
              className="text-xs text-primary hover:underline"
            >
              + Dodaj wpis
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold">{formatPln(month.b2c_revenue)}</span>
          <Link
            to={`/cash-flow/sprzedaz?month=${month.period}`}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-sm font-bold leading-none"
            aria-label="Zarządzaj sprzedażą gotówkową"
          >
            +
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-green-50/60 px-4 py-3 dark:bg-green-950/20">
        <span className="text-xs text-muted-foreground">
          Wpłynęło:{' '}
          <span className={`text-sm font-bold ${cashReceived > 0 ? 'text-green-700 dark:text-green-400' : 'text-foreground'}`}>
            {formatPln(cashReceived)}
          </span>
        </span>
        {outstandingTotal > 0 && (
          <span className="text-xs text-muted-foreground">
            Oczekuje:{' '}
            <span className="text-sm font-bold text-yellow-600">{formatPln(outstandingTotal)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KosztyBlock
// ---------------------------------------------------------------------------

interface KosztyBlockProps {
  month: CashFlowMonth;
  payables?: PayablesData;
  onAddKoszty: () => void;
}

function KosztyBlock({ month, payables, onAddKoszty }: KosztyBlockProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [fixedOpen, setFixedOpen] = useState(false);
  const [payablesOpen, setPayablesOpen] = useState(false);

  const totalCosts = month.costs_ksef + month.costs_quick + month.costs_fixed;
  const overduePayables = payables?.items.filter((p) => p.days_until < 0).reduce((s, p) => s + p.amount, 0) ?? 0;
  const soonPayables = payables?.items.filter((p) => p.days_until >= 0 && p.days_until <= 7).reduce((s, p) => s + p.amount, 0) ?? 0;
  const laterPayables = payables?.items.filter((p) => p.days_until > 7).reduce((s, p) => s + p.amount, 0) ?? 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border border-t-[3px] border-t-orange-500">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-orange-50/60 px-4 py-3 dark:bg-orange-950/20">
        <h3 className="text-sm font-bold uppercase tracking-wide text-orange-800 dark:text-orange-300">
          Koszty i zobowiązania
        </h3>
        <button
          onClick={onAddKoszty}
          className="text-xs font-medium text-orange-700 hover:underline underline-offset-2 dark:text-orange-400"
        >
          + Dodaj
        </button>
      </div>

      {/* Faktury od dostawców (KSeF) */}
      <div className="flex items-start justify-between px-4 py-3.5">
        <div>
          <p className="text-sm font-medium">Faktury od dostawców (KSeF)</p>
          <p className="text-xs text-muted-foreground">
            {month.costs_ksef_count ?? 0}{' '}
            {(month.costs_ksef_count ?? 0) === 1
              ? 'faktura skategoryzowana'
              : (month.costs_ksef_count ?? 0) <= 4
                ? 'faktury skategoryzowane'
                : 'faktur skategoryzowanych'}
          </p>
        </div>
        <span className="text-base font-bold shrink-0 ml-2">{formatPln(month.costs_ksef)}</span>
      </div>

      {/* Inne zakupy i wydatki */}
      <div className="border-t-2 border-border/60">
        <button
          type="button"
          disabled={(month.costs_quick_by_category?.length ?? 0) === 0}
          className="w-full flex items-start justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => setQuickOpen((v) => !v)}
        >
          <div>
            <p className="text-sm font-medium">Inne zakupy i wydatki</p>
            <p className="text-xs text-muted-foreground">paliwo, materiały itp.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-base font-bold">{formatPln(month.costs_quick)}</span>
            {(month.costs_quick_by_category?.length ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">{quickOpen ? '▲' : '▼'}</span>
            )}
          </div>
        </button>
        {quickOpen && (month.costs_quick_by_category?.length ?? 0) > 0 && (
          <div className="mx-4 mb-3 space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            {month.costs_quick_by_category!.map((cat, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{cat.label}</span>
                  <span className="text-muted-foreground/60">
                    · {cat.count} {cat.count === 1 ? 'wpis' : 'wpisy'}
                  </span>
                </div>
                <span className="font-medium tabular-nums">{formatPln(cat.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Koszty stałe */}
      <div className="border-t-2 border-border/60">
        <button
          type="button"
          disabled={(month.costs_fixed_items?.length ?? 0) === 0}
          className="w-full flex items-start justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors text-left disabled:cursor-default disabled:hover:bg-transparent"
          onClick={() => setFixedOpen((v) => !v)}
        >
          <div>
            <p className="text-sm font-medium">Koszty stałe</p>
            {month.costs_fixed_items !== undefined && (
              <p className="text-xs text-muted-foreground">
                {month.costs_fixed_items.length}{' '}
                {month.costs_fixed_items.length === 1 ? 'pozycja' : 'pozycji'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-base font-bold">{formatPln(month.costs_fixed)}</span>
            {(month.costs_fixed_items?.length ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">{fixedOpen ? '▲' : '▼'}</span>
            )}
          </div>
        </button>
        {fixedOpen && (month.costs_fixed_items?.length ?? 0) > 0 && (
          <div className="mx-4 mb-3 space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            {month.costs_fixed_items!.map((item, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{item.description}</span>
                <span className="font-medium tabular-nums">{formatPln(item.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Niezapłacone faktury dostawców */}
      {payables && payables.total_count > 0 && (
        <div className="border-t-2 border-orange-200 dark:border-orange-800">
          {/* Sub-header */}
          <div className="flex items-center justify-between bg-orange-50/80 px-4 py-2 dark:bg-orange-950/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">
              Do zapłaty dostawcom
            </p>
            <button
              type="button"
              onClick={() => setPayablesOpen((v) => !v)}
              className="text-xs font-medium text-orange-700 dark:text-orange-400"
            >
              {payablesOpen ? 'Zwiń ▲' : 'Szczegóły ▼'}
            </button>
          </div>
          <button
            type="button"
            className="w-full flex items-start justify-between px-4 py-3.5 hover:bg-orange-50/40 dark:hover:bg-orange-950/20 transition-colors text-left"
            onClick={() => setPayablesOpen((v) => !v)}
          >
            <div>
              <p className="text-sm font-medium">Niezapłacone faktury dostawców</p>
              <p className="text-xs text-muted-foreground">
                {payables.total_count} {plFaktura(payables.total_count)} niezapłaconych
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-base font-bold text-orange-700 dark:text-orange-400">
                −{formatPln(payables.total_amount)}
              </span>
            </div>
          </button>

          {(overduePayables > 0 || soonPayables > 0 || laterPayables > 0) && (
            <div className="flex gap-2 px-4 pb-3">
              {overduePayables > 0 && (
                <div className="flex-1 rounded-lg bg-destructive/10 px-2 py-2 text-center">
                  <p className="text-xs font-semibold text-destructive">−{formatPln(overduePayables)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Zaległe</p>
                </div>
              )}
              {soonPayables > 0 && (
                <div className="flex-1 rounded-lg bg-orange-500/10 px-2 py-2 text-center">
                  <p className="text-xs font-semibold text-orange-600">−{formatPln(soonPayables)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Do 7 dni</p>
                </div>
              )}
              {laterPayables > 0 && (
                <div className="flex-1 rounded-lg bg-muted px-2 py-2 text-center">
                  <p className="text-xs font-semibold">−{formatPln(laterPayables)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Później</p>
                </div>
              )}
            </div>
          )}

          {payablesOpen && (
            <div className="divide-y divide-border border-t border-border">
              {payables.items.map((p) => (
                <Link
                  key={p.id}
                  to="/ksef/inbox?is_paid=false"
                  className="flex items-center justify-between px-4 py-3 hover:bg-orange-50/40 dark:hover:bg-orange-950/20 transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="truncate text-sm font-medium">{p.seller_name}</p>
                    {p.invoice_number && (
                      <p className="text-xs text-muted-foreground">{p.invoice_number}</p>
                    )}
                    {p.issue_date && (
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(p.issue_date), 'd MMM yyyy', { locale: pl })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                        −{formatPln(p.amount)}
                      </p>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${daysBadge(p.days_until)}`}>
                        {daysLabel(p.days_until)}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">→</span>
                  </div>
                </Link>
              ))}
              <Link
                to="/ksef/inbox?is_paid=false"
                className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium text-orange-700 dark:text-orange-400 hover:bg-orange-50/40 dark:hover:bg-orange-950/20 transition-colors"
              >
                Zobacz wszystkie niezapłacone ({payables.total_count}) →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-orange-50/60 px-4 py-3 dark:bg-orange-950/20">
        <span className="text-xs text-muted-foreground">
          Koszty:{' '}
          <span className="text-sm font-bold text-foreground">{formatPln(totalCosts)}</span>
        </span>
        {payables && payables.total_count > 0 && (
          <span className="text-xs text-muted-foreground">
            Do zapłaty dostawcom:{' '}
            <span className="text-sm font-bold text-orange-700 dark:text-orange-400">
              {formatPln(payables.total_amount)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WaterfallCard
// ---------------------------------------------------------------------------

interface WaterfallCardProps {
  grossMargin: number;
  grossMarginPct: number | null;
  variableCatEntries: [string, { label: string; total: number }][];
  overheadCosts: number;
  overheadCatEntries: [string, { label: string; total: number }][];
  fixedCosts: number;
  fixedItems?: { description: string; category: string; amount: number }[];
  taxTotal: number;
  vatToPay: number;
  zusSocial: number;
  zusHealth: number;
  pitEstimate: number;
  est: number;
  isLoss: boolean;
  uncategorizedKsefCount: number;
}

function WaterfallCard({
  grossMargin, grossMarginPct, variableCatEntries, overheadCosts, overheadCatEntries,
  fixedCosts, fixedItems, taxTotal, vatToPay, zusSocial, zusHealth, pitEstimate,
  est, isLoss, uncategorizedKsefCount,
}: WaterfallCardProps) {
  const [marginOpen, setMarginOpen] = useState(false);
  const [overheadOpen, setOverheadOpen] = useState(false);
  const [fixedOpen, setFixedOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);

  const hasMarginDetail = variableCatEntries.length > 0 || uncategorizedKsefCount > 0;
  const hasOverheadDetail = overheadCatEntries.length > 0;
  const hasFixedDetail = (fixedItems?.length ?? 0) > 0;
  const hasTaxDetail = taxTotal > 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Row: Marża brutto */}
      <button
        type="button"
        disabled={!hasMarginDetail}
        onClick={() => hasMarginDetail && setMarginOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/60 text-left hover:bg-muted/30 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
      >
        <div>
          <p className="text-xs font-medium">Marża brutto</p>
          <p className="text-[11px] text-muted-foreground">przychody − surowce, materiały, transport</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {grossMarginPct !== null && (
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${
              grossMargin < 0 ? 'bg-red-100 text-destructive' : 'bg-green-100 text-green-700'
            }`}>
              {grossMarginPct}%
            </span>
          )}
          <span className={`text-sm font-bold tabular-nums ${grossMargin < 0 ? 'text-destructive' : 'text-green-700 dark:text-green-400'}`}>
            {formatPln(grossMargin)}
          </span>
          {hasMarginDetail && <span className="text-[10px] text-muted-foreground">{marginOpen ? '▲' : '▼'}</span>}
        </div>
      </button>
      {marginOpen && variableCatEntries.length > 0 && (
        <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5 space-y-1">
          {variableCatEntries.map(([slug, { label, total }]) => (
            <div key={slug} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium tabular-nums">{formatPln(total)}</span>
            </div>
          ))}
        </div>
      )}
      {marginOpen && uncategorizedKsefCount > 0 && (
        <Link
          to="/ksef/inbox?categorized=false"
          className="flex items-center justify-between border-b border-border/60 bg-amber-50/80 dark:bg-amber-950/20 px-4 py-2.5 hover:bg-amber-100/60 transition-colors"
        >
          <span className="text-xs text-amber-700 dark:text-amber-400">
            ⚠ {uncategorizedKsefCount === 1
              ? '1 faktura bez kategorii — nie jest wliczona'
              : `${uncategorizedKsefCount} faktury bez kategorii — nie są wliczone`}
          </span>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Przypisz →</span>
        </Link>
      )}

      {/* Row: Inne koszty operacyjne (media, usługi, naprawa...) */}
      {overheadCosts > 0 && (
        <>
          <button
            type="button"
            disabled={!hasOverheadDetail}
            onClick={() => hasOverheadDetail && setOverheadOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/60 text-left hover:bg-muted/30 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
          >
            <div>
              <p className="text-xs font-medium text-muted-foreground">− Inne koszty</p>
              <p className="text-[11px] text-muted-foreground">media, usługi, naprawa, czynsz KSeF</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm tabular-nums text-muted-foreground">{formatPln(overheadCosts)}</span>
              {hasOverheadDetail && <span className="text-[10px] text-muted-foreground">{overheadOpen ? '▲' : '▼'}</span>}
            </div>
          </button>
          {overheadOpen && hasOverheadDetail && (
            <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5 space-y-1">
              {overheadCatEntries.map(([slug, { label, total }]) => (
                <div key={slug} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{formatPln(total)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Row: Koszty stałe */}
      <button
        type="button"
        disabled={!hasFixedDetail}
        onClick={() => hasFixedDetail && setFixedOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/60 text-left hover:bg-muted/30 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
      >
        <div>
          <p className="text-xs font-medium text-muted-foreground">− Koszty stałe</p>
          <p className="text-[11px] text-muted-foreground">czynsz, pracownicy, leasing</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm tabular-nums text-muted-foreground">{formatPln(fixedCosts)}</span>
          {hasFixedDetail && <span className="text-[10px] text-muted-foreground">{fixedOpen ? '▲' : '▼'}</span>}
        </div>
      </button>
      {fixedOpen && hasFixedDetail && (
        <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5 space-y-1">
          {fixedItems!.map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{item.description}</span>
              <span className="font-medium tabular-nums">{formatPln(item.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Row: Podatki i ZUS */}
      <button
        type="button"
        disabled={!hasTaxDetail}
        onClick={() => hasTaxDetail && setTaxOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/60 text-left hover:bg-muted/30 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
      >
        <div>
          <p className="text-xs font-medium text-muted-foreground">− Podatki i ZUS</p>
          <p className="text-[11px] text-muted-foreground">VAT, ZUS, PIT</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm tabular-nums text-muted-foreground">{formatPln(taxTotal)}</span>
          {hasTaxDetail && <span className="text-[10px] text-muted-foreground">{taxOpen ? '▲' : '▼'}</span>}
        </div>
      </button>
      {taxOpen && hasTaxDetail && (
        <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5 space-y-1">
          {vatToPay > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">VAT do zapłaty</span>
              <span className="font-medium tabular-nums">{formatPln(vatToPay)}</span>
            </div>
          )}
          {zusSocial > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">ZUS społeczny</span>
              <span className="font-medium tabular-nums">{formatPln(zusSocial)}</span>
            </div>
          )}
          {zusHealth > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Składka zdrowotna</span>
              <span className="font-medium tabular-nums">{formatPln(zusHealth)}</span>
            </div>
          )}
          {pitEstimate > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Podatek dochodowy</span>
              <span className="font-medium tabular-nums">{formatPln(pitEstimate)}</span>
            </div>
          )}
        </div>
      )}

      {/* Row: Wynik końcowy */}
      <div className={`flex items-center justify-between px-4 py-3 ${isLoss ? 'bg-red-50 dark:bg-red-950/20' : 'bg-green-50/50 dark:bg-green-950/10'}`}>
        <p className="text-sm font-semibold">{isLoss ? 'Szacowana strata' : 'Szacowany zysk'}</p>
        <span className={`text-base font-bold tabular-nums ${isLoss ? 'text-destructive' : 'text-green-700 dark:text-green-400'}`}>
          {formatPln(est)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Przegląd Tab
// ---------------------------------------------------------------------------

interface PrzegladTabProps {
  currentMonth: string;
  setCurrentMonth: (m: string) => void;
  onAddKoszty: () => void;
  onOpenConfig: () => void;
}

function PrzegladTab({ currentMonth, setCurrentMonth, onAddKoszty, onOpenConfig }: PrzegladTabProps) {
  const now = new Date();
  const { data, isLoading } = useCashFlowDashboardQuery(currentMonth);
  const { data: _expenses = [] } = useQuickExpensesQuery(currentMonth);
  const today = data?.today;
  const month = data?.month;

  const isCurrentMonth =
    currentMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const prevMonth = () =>
    setCurrentMonth(format(subMonths(parseISO(`${currentMonth}-01`), 1), 'yyyy-MM'));
  const nextMonth = () =>
    setCurrentMonth(format(addMonths(parseISO(`${currentMonth}-01`), 1), 'yyyy-MM'));

  if (isLoading) return <CashFlowSkeleton variant="month" />;
  if (!today || !month) return null;

  const est = month.really_yours_estimate;
  const isLoss = est < 0;
  const totalRevenue = month.revenue_paid + month.b2c_revenue;

  // Hero section computed values
  const outstandingForHero = today.receivables.reduce((s, r) => s + r.amount, 0);
  const taxTotalForHero = today.upcoming_obligations.reduce((s, ob) => s + ob.amount, 0);
  const payablesTotal = today.payables.total_amount;

  // Waterfall: variable costs from ksef+quick by category, fixed = costs_fixed
  const ksefByCat = month.costs_ksef_by_category ?? [];
  const quickByCat = month.costs_quick_by_category ?? [];

  // Merge ksef + quick by category slug
  const allCatMap = new Map<string, { label: string; total: number }>();
  for (const item of [...ksefByCat, ...quickByCat]) {
    const existing = allCatMap.get(item.category);
    allCatMap.set(item.category, {
      label: item.label,
      total: (existing?.total ?? 0) + item.total,
    });
  }

  // Variable costs: raw materials, packaging, fuel, transport → reduce gross margin
  const variableCatEntries = Array.from(allCatMap.entries())
    .filter(([slug]) => VARIABLE_COST_SLUGS.has(slug))
    .sort((a, b) => b[1].total - a[1].total);
  const variableCosts = variableCatEntries.reduce((s, [, v]) => s + v.total, 0);

  // Overhead KSeF/quick costs: rent, utilities, services, repair etc. → separate row
  const overheadCatEntries = Array.from(allCatMap.entries())
    .filter(([slug]) => !VARIABLE_COST_SLUGS.has(slug))
    .sort((a, b) => b[1].total - a[1].total);
  const overheadCosts = overheadCatEntries.reduce((s, [, v]) => s + v.total, 0);

  const grossMargin = totalRevenue - variableCosts;
  const grossMarginPct = totalRevenue > 0 ? Math.round((grossMargin / totalRevenue) * 100) : null;
  const fixedCosts = month.costs_fixed;
  const taxTotal = month.vat_to_pay + month.zus_social + month.zus_health + month.pit_estimate;


  const hasTaxes =
    month.vat_to_pay > 0 ||
    month.zus_social > 0 ||
    month.zus_health > 0 ||
    month.pit_estimate > 0;

  return (
    <div className="space-y-6">
      {/* ── Month navigator ── */}
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
          {!isCurrentMonth && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">· dane historyczne</span>
          )}
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

      {/* ── Hero — only current month ── */}
      {isCurrentMonth && (
        <div className="space-y-3">
          {/* Income + Obligations cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* LEFT: Income */}
            <div className="rounded-2xl border border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                Przychody
              </p>
              <p className="mt-1 text-xl font-bold tracking-tight text-green-700 dark:text-green-400 leading-tight">
                {formatPln(totalRevenue)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">wpłynęło w tym miesiącu</p>
              {outstandingForHero > 0 && (
                <div className="mt-2 border-t border-green-200/60 dark:border-green-800/60 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Oczekuje:{' '}
                    <span className="font-semibold text-yellow-600">{formatPln(outstandingForHero)}</span>
                  </p>
                </div>
              )}
            </div>

            {/* RIGHT: Obligations */}
            <div className={`rounded-2xl p-4 ${
              taxTotalForHero + payablesTotal > 0
                ? 'border border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20'
                : 'border border-border bg-muted/20'
            }`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">
                Do zapłaty
              </p>
              <p className="mt-1 text-xl font-bold tracking-tight text-orange-700 dark:text-orange-400 leading-tight">
                {formatPln(taxTotalForHero + payablesTotal)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">podatki i zobowiązania</p>
              {taxTotalForHero > 0 && payablesTotal > 0 && (
                <div className="mt-2 border-t border-orange-200/60 dark:border-orange-800/60 pt-2 space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    Podatki: <span className="font-medium">{formatPln(taxTotalForHero)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Dostawcy: <span className="font-medium">{formatPln(payablesTotal)}</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Balance row — only if balance was actually set and > 0 */}
          {today.balance_updated_at && today.total_available > 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Na koncie:{' '}
                  <span className="font-semibold text-foreground">{formatPln(today.total_available)}</span>
                </span>
                <span>
                  Wolne:{' '}
                  <span className={`font-semibold ${today.really_yours < 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {today.really_yours < 0
                      ? `brakuje ${formatPln(Math.abs(today.really_yours))}`
                      : formatPln(today.really_yours)}
                  </span>
                </span>
              </div>
              <button
                onClick={onOpenConfig}
                className="shrink-0 ml-2 text-xs font-medium text-primary hover:underline underline-offset-2"
              >
                Aktualizuj
              </button>
            </div>
          ) : (
            <div className="px-1">
              <button
                onClick={onOpenConfig}
                className="text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline transition-colors"
              >
                + Dodaj stan konta, żeby widzieć ile zostaje po podatkach
              </button>
            </div>
          )}

        </div>
      )}

      {/* ── Waterfall — shown for all months ── */}
      <WaterfallCard
        grossMargin={grossMargin}
        grossMarginPct={grossMarginPct}
        variableCatEntries={variableCatEntries}
        overheadCosts={overheadCosts}
        overheadCatEntries={overheadCatEntries}
        fixedCosts={fixedCosts}
        fixedItems={month.costs_fixed_items}
        taxTotal={taxTotal}
        vatToPay={month.vat_to_pay}
        zusSocial={month.zus_social}
        zusHealth={month.zus_health}
        pitEstimate={month.pit_estimate}
        uncategorizedKsefCount={month.uncategorized_ksef_count}
        est={est}
        isLoss={isLoss}
      />

      {/* ── Alerts ── */}
      {month.tax_threshold_alert && (
        <div className={`rounded-xl border px-4 py-3 ${month.tax_threshold_alert.type === 'crossed' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            <span className="shrink-0 text-lg">
              {month.tax_threshold_alert.type === 'crossed' ? '🔴' : '⚠️'}
            </span>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${month.tax_threshold_alert.type === 'crossed' ? 'text-red-800' : 'text-amber-800'}`}>
                {month.tax_threshold_alert.title}
              </p>
              <p className={`mt-0.5 text-xs ${month.tax_threshold_alert.type === 'crossed' ? 'text-red-600' : 'text-amber-700'}`}>
                {month.tax_threshold_alert.message}
              </p>
              {month.tax_threshold_alert.remaining > 0 && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all"
                    style={{ width: `${Math.min((month.tax_threshold_alert.ytd / month.tax_threshold_alert.threshold) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {month.uncategorized_ksef_count > 0 && (
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

      {/* ── Przychody ── */}
      <PrzychodyBlock
        month={month}
        receivables={isCurrentMonth ? today.receivables : undefined}
      />

      {/* ── Koszty i zobowiązania ── */}
      <KosztyBlock
        month={month}
        payables={isCurrentMonth && today.payables.total_count > 0 ? today.payables : undefined}
        onAddKoszty={onAddKoszty}
      />

      {/* ── Płatności (bieżący miesiąc) ── */}
      {isCurrentMonth && today.upcoming_obligations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              Płatności
            </h3>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          {today.upcoming_obligations.map((ob: TaxObligation, i) => {
            const breakdown: React.ReactNode =
              ob.type === 'vat' ? (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">VAT należny (ze sprzedaży)</span>
                    <span className="font-medium tabular-nums">{formatPln(month.vat_output)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">VAT naliczony (odliczenie)</span>
                    <span className="font-medium tabular-nums text-muted-foreground">− {formatPln(month.vat_input)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 text-xs">
                    <span className="font-medium">VAT do zapłaty</span>
                    <span className="font-semibold tabular-nums">{formatPln(month.vat_to_pay)}</span>
                  </div>
                  {month.vat_input_invoices.length > 0 && (
                    <details className="mt-1">
                      <summary className="list-none cursor-pointer text-xs text-primary hover:underline underline-offset-2">
                        Faktury odliczające VAT ({month.vat_input_invoices.length}) ▾
                      </summary>
                      <div className="mt-1 space-y-1 rounded-lg bg-muted/50 p-2">
                        {month.vat_input_invoices.map((inv) => (
                          <div key={inv.id} className="flex items-center justify-between text-xs">
                            <span className="truncate text-muted-foreground">
                              {inv.vendor || 'Nieznany dostawca'} ·{' '}
                              {format(parseISO(inv.issue_date), 'd MMM', { locale: pl })}
                            </span>
                            <span className="ml-2 shrink-0 font-medium">{formatPln(inv.vat_amount)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {month.vat_surplus > 0 && (
                    <p className="text-xs text-green-600">Nadpłata VAT: {formatPln(month.vat_surplus)}</p>
                  )}
                </>
              ) : ob.type === 'zus' ? (
                <>
                  {month.zus_breakdown?.map((row, j) => (
                    <div key={j} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium tabular-nums">{row.value}</span>
                    </div>
                  ))}
                </>
              ) : ob.type === 'zus_health' ? (
                <>
                  {month.health_breakdown?.map((row, j) => (
                    <div key={j} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium tabular-nums">{row.value}</span>
                    </div>
                  ))}
                </>
              ) : ob.type === 'pit' ? (
                <>
                  {month.pit_breakdown?.map((row, j) => (
                    <div
                      key={j}
                      className={`flex justify-between text-xs ${
                        row.label.startsWith('=') || row.label === 'Zaliczka podatku dochodowego'
                          ? 'border-t border-border pt-1.5 font-semibold'
                          : ''
                      }`}
                    >
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium tabular-nums">{row.value}</span>
                    </div>
                  ))}
                </>
              ) : ob.breakdown ? (
                <>
                  {ob.breakdown.map((row, j) => (
                    <div key={j} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-medium tabular-nums">{row.value}</span>
                    </div>
                  ))}
                </>
              ) : null;

            const label: React.ReactNode =
              ob.type === 'zus' ? (
                <span className="flex items-center gap-1">
                  {ob.label}
                  <span title="ZUS społeczny obniża podstawę opodatkowania PIT." className="cursor-help text-xs text-muted-foreground/60">ⓘ</span>
                </span>
              ) : ob.type === 'zus_health' ? (
                <span className="flex items-center gap-1">
                  {ob.label}
                  <span title="Na skali: 9% dochodu. Na liniówce: 4,9% dochodu." className="cursor-help text-xs text-muted-foreground/60">ⓘ</span>
                </span>
              ) : ob.type === 'pit' ? (
                <span className="flex items-center gap-1">
                  {ob.label}
                  {month.pit_is_estimate && (
                    <span title="Szacunek — rzeczywista zaliczka może się różnić." className="cursor-help text-xs text-muted-foreground/60">ⓘ</span>
                  )}
                </span>
              ) : ob.label;

            return (
              <TaxPaymentRow
                key={i}
                label={label}
                amount={ob.amount}
                dueDate={ob.due_date}
                daysUntil={ob.days_until}
              >
                {breakdown}
              </TaxPaymentRow>
            );
          })}
        </div>
      )}

      {/* ── Podatki i ZUS (miesiące historyczne) ── */}
      {!isCurrentMonth && hasTaxes && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              Podatki i ZUS
            </h3>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          {month.vat_to_pay > 0 && (
            <TaxPaymentRow
              label="VAT do zapłaty"
              amount={month.vat_to_pay}
              surplus={month.vat_surplus > 0 ? month.vat_surplus : undefined}
            >
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">VAT należny (ze sprzedaży)</span>
                <span className="font-medium tabular-nums">{formatPln(month.vat_output)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">VAT naliczony (odliczenie z zakupów)</span>
                <span className="font-medium tabular-nums text-muted-foreground">− {formatPln(month.vat_input)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 text-xs">
                <span className="font-medium">VAT do zapłaty</span>
                <span className="font-semibold tabular-nums">{formatPln(month.vat_to_pay)}</span>
              </div>
            </TaxPaymentRow>
          )}

          {month.zus_social > 0 && (
            <TaxPaymentRow label="ZUS społeczny" amount={month.zus_social}>
              {month.zus_breakdown?.map((row, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.value}</span>
                </div>
              ))}
            </TaxPaymentRow>
          )}

          {month.zus_health > 0 && (
            <TaxPaymentRow label="Składka zdrowotna" amount={month.zus_health}>
              {month.health_breakdown?.map((row, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.value}</span>
                </div>
              ))}
            </TaxPaymentRow>
          )}

          {month.pit_estimate > 0 && (
            <TaxPaymentRow label="Podatek dochodowy" amount={month.pit_estimate}>
              {month.pit_breakdown?.map((row, i) => (
                <div
                  key={i}
                  className={`flex justify-between text-xs ${
                    row.label.startsWith('=') || row.label === 'Zaliczka podatku dochodowego'
                      ? 'border-t border-border pt-1.5 font-semibold'
                      : ''
                  }`}
                >
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.value}</span>
                </div>
              ))}
            </TaxPaymentRow>
          )}
        </div>
      )}

      {/* ── Wykresy ── */}
      <div className="space-y-5">
        <ExpenseChart month={currentMonth} />
      </div>
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
  const [activeTab, setActiveTab] = useState<'today' | 'historia' | 'year'>('today');
  const [currentMonth, setCurrentMonth] = useState(nowMonth);
  const [kosztyOpen, setKosztyOpen] = useState(false);
  const [kosztyInitialView, setKosztyInitialView] = useState<'list' | 'form'>('list');
  const [configOpen, setConfigOpen] = useState(false);
  const [taxSettingsOpen, setTaxSettingsOpen] = useState(false);

  const tabClass = (tab: 'today' | 'historia' | 'year') =>
    `flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
      activeTab === tab
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="min-h-screen pb-10">
      <div className="mx-auto max-w-5xl px-4 pt-5 md:px-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">Saldo i Podatki</h1>
          <button
            onClick={() => setTaxSettingsOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ⚙ Ustawienia podatkowe
          </button>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex rounded-xl bg-muted p-1">
            <button onClick={() => setActiveTab('today')} className={tabClass('today')}>
              Przegląd
            </button>
            <button onClick={() => setActiveTab('historia')} className={tabClass('historia')}>
              Historia
            </button>
            <button onClick={() => setActiveTab('year')} className={tabClass('year')}>
              Rok
            </button>
          </div>
          <Link
            to="/cash-flow/harmonogram"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
          >
            📅 Harmonogram
          </Link>
        </div>

        {activeTab === 'today' && (
          <PrzegladTab
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            onAddKoszty={() => { setKosztyInitialView('form'); setKosztyOpen(true); }}
            onOpenConfig={() => setConfigOpen(true)}
          />
        )}
        {activeTab === 'historia' && (
          <HistoriaTab
            onSelectMonth={(month) => {
              setCurrentMonth(month);
              setActiveTab('today');
            }}
          />
        )}
        {activeTab === 'year' && <PeriodSummaryTab />}
      </div>

      {/* FAB — mobile only, Przegląd tab only */}
      {activeTab === 'today' && (
        <button
          onClick={() => { setKosztyInitialView('form'); setKosztyOpen(true); }}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-colors hover:bg-primary/90 md:hidden"
          aria-label="Dodaj dokument"
        >
          <span className="text-2xl font-light leading-none">+</span>
        </button>
      )}

      {/* Sheets */}
      <KosztySheet
        open={kosztyOpen}
        onClose={() => setKosztyOpen(false)}
        month={currentMonth}
        initialView={kosztyInitialView}
      />
      <TaxConfigSetup open={configOpen} onClose={() => setConfigOpen(false)} />
      <TaxSettingsModal open={taxSettingsOpen} onClose={() => setTaxSettingsOpen(false)} />
    </div>
  );
}

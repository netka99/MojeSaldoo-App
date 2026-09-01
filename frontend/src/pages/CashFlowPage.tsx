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
import { PageExplainer } from '@/components/ui/PageExplainer';
import type { TaxObligation } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 });
function formatPln(value: number): string { return pln.format(value); }

function obligationBadge(daysUntil: number): string {
  if (daysUntil < 3) return 'bg-destructive/10 text-destructive';
  if (daysUntil < 7) return 'bg-orange-500/10 text-orange-600';
  if (daysUntil < 14) return 'bg-yellow-500/10 text-yellow-600';
  return 'bg-green-500/10 text-green-700';
}

function plFaktura(n: number): string {
  if (n === 1) return 'faktura';
  if (n >= 2 && n <= 4) return 'faktury';
  return 'faktur';
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function DueBadge({ daysUntil, dueDate }: { daysUntil: number; dueDate?: string | null }) {
  const label = dueDate
    ? `→ do ${format(parseISO(dueDate), 'd MMM', { locale: pl })}`
    : daysUntil < 0
      ? `${Math.abs(daysUntil)} dni po terminie`
      : daysUntil === 0
        ? 'Dziś!'
        : `za ${daysUntil} dni`;

  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${obligationBadge(daysUntil)}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section — collapsible accordion panel
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  total: number;
  totalColor?: string;
  children: React.ReactNode;
}

function Section({ title, total, totalColor = 'text-foreground', children }: SectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-card hover:bg-muted/40 transition-colors text-left"
      >
        <span className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-base font-bold tabular-nums ${totalColor}`}>{formatPln(total)}</span>
          <span className="text-[10px] text-muted-foreground">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}


function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-4 border-t border-dashed border-border/70" />
      <div className="px-4 py-3 bg-muted/30">{children}</div>
    </>
  );
}

// Expandable inner row — for showing sub-lists within an accordion section
interface InnerExpandableProps {
  label: React.ReactNode;
  sub?: string;
  amount: number;
  amountColor?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  disabled?: boolean;
  children?: React.ReactNode;
}

function InnerExpandable({ label, sub, amount, amountColor = 'text-foreground', badge, action, disabled, children }: InnerExpandableProps) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!children;
  const canToggle = hasChildren && !disabled;

  return (
    <>
      <div className="w-full flex items-center justify-between border-b border-border/50 last:border-0 px-4 py-3 text-left">
        <button
          type="button"
          disabled={!canToggle}
          onClick={() => canToggle && setOpen(v => !v)}
          className="min-w-0 flex-1 pr-3 text-left hover:opacity-80 transition-opacity disabled:cursor-default"
        >
          <p className="text-sm font-medium">{label}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          {action}
          <button
            type="button"
            disabled={!canToggle}
            onClick={() => canToggle && setOpen(v => !v)}
            className="flex items-center gap-2 disabled:cursor-default"
          >
            <span className={`text-sm font-semibold tabular-nums ${amountColor}`}>{formatPln(amount)}</span>
            {canToggle && (
              <span className="text-[10px] text-muted-foreground w-3">{open ? '▲' : '▼'}</span>
            )}
          </button>
        </div>
      </div>
      {open && hasChildren && (
        <div className="border-b border-border/50 bg-muted/20 px-4 py-2.5 space-y-1.5">
          {children}
        </div>
      )}
    </>
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // ── Key numbers ──
  const totalRevenue = month.revenue_paid + month.b2c_revenue;
  const totalCosts = month.costs_ksef + month.costs_quick + month.costs_fixed;
  const taxTotal = month.vat_to_pay + month.zus_social + month.zus_health + month.pit_estimate;
  // Wynik = po wszystkim: koszty operacyjne + zarezerwowane podatki
  const wynik = month.really_yours_estimate;
  const isLoss = wynik < 0;
  // breakEven — ile brakuje do pokrycia kosztów operacyjnych (bez podatków, to osobna sekcja)
  const operatingResult = totalRevenue - totalCosts;
  const breakEven = operatingResult < 0 ? Math.abs(operatingResult) : 0;

  // Outstanding receivables
  const outstandingTotal = isCurrentMonth
    ? today.receivables.reduce((s, r) => s + r.amount, 0)
    : month.revenue_outstanding;
  const outstandingCount = isCurrentMonth
    ? today.receivables.length
    : (month.revenue_outstanding_count ?? 0);
  const overdueAmount = isCurrentMonth
    ? today.receivables.filter(r => (r.days_until ?? 0) < 0).reduce((s, r) => s + r.amount, 0)
    : 0;
  const soonAmount = isCurrentMonth
    ? today.receivables.filter(r => { const d = r.days_until ?? 0; return d >= 0 && d <= 7; }).reduce((s, r) => s + r.amount, 0)
    : 0;

  const zusTotal = month.zus_social + month.zus_health;

  // VAT period label
  const [periodYYYY, periodMM] = currentMonth.split('-');
  const vatLabel = `VAT ${parseInt(periodMM)}/${periodYYYY}`;

  // Obligations from today (current month only)
  const vatOb  = today.upcoming_obligations.find((ob: TaxObligation) => ob.type === 'vat');
  const zusOb  = today.upcoming_obligations.find((ob: TaxObligation) => ob.type === 'zus');
  const zusHOb = today.upcoming_obligations.find((ob: TaxObligation) => ob.type === 'zus_health');
  const pitOb  = today.upcoming_obligations.find((ob: TaxObligation) => ob.type === 'pit');

  const monthLabel = format(parseISO(`${currentMonth}-01`), 'LLLL yyyy', { locale: pl });

  // Fixed costs labels
  const fixedSub = month.costs_fixed_items?.slice(0, 3).map(i => i.description).join(', ');

  return (
    <div className="space-y-4">
      {/* ── Month navigator ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          aria-label="Poprzedni miesiąc"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          ←
        </button>
        <span className="text-sm font-semibold capitalize">
          {monthLabel}
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

      {/* ── 3-column summary ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Wpłynęło</p>
          <p className="mt-1 text-base font-bold tabular-nums text-green-700">{formatPln(totalRevenue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Koszty</p>
          <p className="mt-1 text-base font-bold tabular-nums text-foreground">{formatPln(totalCosts)}</p>
        </div>
        <div className={`rounded-xl border p-3 ${isLoss ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20' : 'border-green-200 bg-green-50/40 dark:border-green-900 dark:bg-green-950/20'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Wynik</p>
          <p className={`mt-1 text-base font-bold tabular-nums ${isLoss ? 'text-destructive' : 'text-green-700'}`}>
            {formatPln(wynik)}
          </p>
        </div>
      </div>

      {/* ── Outstanding banner — current month only ── */}
      {isCurrentMonth && outstandingTotal > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-yellow-200 bg-yellow-50/60 px-4 py-3 dark:border-yellow-800 dark:bg-yellow-950/20">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            <span className="font-semibold">+{formatPln(outstandingTotal)}</span> oczekuje
            {overdueAmount > 0 && (
              <span className="ml-2 text-xs font-medium text-destructive">
                · {formatPln(overdueAmount)} zaległe
              </span>
            )}
            {soonAmount > 0 && overdueAmount === 0 && (
              <span className="ml-2 text-xs font-medium text-orange-600">
                · {formatPln(soonAmount)} do 7 dni
              </span>
            )}
          </p>
          <Link
            to="/invoices"
            className="shrink-0 rounded-lg bg-yellow-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-yellow-700 transition-colors"
          >
            Przypomnij klientom
          </Link>
        </div>
      )}

      {/* ── Bank balance row ── */}
      {isCurrentMonth && (
        today.balance_updated_at && today.total_available > 0 ? (
          <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Na koncie:{' '}
                <span className="font-semibold text-foreground">{formatPln(today.total_available)}</span>
              </span>
              {today.vat_balance > 0 && (
                <span title="Środki zablokowane na rachunku VAT (split payment) — niedostępne do swobodnego użycia">
                  🔒 VAT:{' '}
                  <span className="font-semibold text-amber-600">{formatPln(today.vat_balance)}</span>
                </span>
              )}
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
          <button
            onClick={onOpenConfig}
            className="px-1 text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline transition-colors"
          >
            + Dodaj stan konta, żeby widzieć ile zostaje po podatkach
          </button>
        )
      )}

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

      {/* ── Accordion: WPŁYNĘŁO ── */}
      <Section title="Wpłynęło" total={totalRevenue} totalColor="text-green-700">
        {/* B2B paid — expandable invoice list */}
        <InnerExpandable
          label="Faktury B2B opłacone"
          sub={`${month.revenue_paid_count ?? 0} ${plFaktura(month.revenue_paid_count ?? 0)}`}
          amount={month.revenue_paid}
          amountColor={month.revenue_paid > 0 ? 'text-green-700' : 'text-muted-foreground'}
          disabled={(month.revenue_paid_top?.length ?? 0) === 0}
        >
          {(month.revenue_paid_top?.length ?? 0) > 0 && month.revenue_paid_top!.map(item => (
            <Link
              key={item.id}
              to={`/invoices/${item.id}`}
              className="flex items-center justify-between -mx-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1 pr-2">
                <p className="truncate text-xs font-medium">{item.name}</p>
                <p className="text-[10px] text-muted-foreground">{item.invoice_number}</p>
                {item.date && (
                  <p className="text-[10px] text-muted-foreground">
                    Opłacono: {format(parseISO(item.date), 'd MMM', { locale: pl })}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-green-700">{formatPln(item.amount)}</span>
            </Link>
          ))}
          <div className="pt-1 border-t border-border/40 mt-1">
            <Link
              to={`/invoices?status=paid&month=${month.period}`}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
            >
              <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Wszystkie faktury opłacone ({month.revenue_paid_count ?? 0})
            </Link>
          </div>
        </InnerExpandable>

        {/* B2C */}
        <InnerExpandable
          label="Sprzedaż gotówkowa B2C"
          sub={(month.b2c_entries_count ?? 0) > 0 ? `${month.b2c_entries_count} wpisów` : undefined}
          amount={month.b2c_revenue}
          amountColor={month.b2c_revenue > 0 ? 'text-green-700' : 'text-muted-foreground'}
          disabled={(month.b2c_top?.length ?? 0) === 0}
          action={
            <Link
              to={`/cash-flow/sprzedaz?month=${month.period}`}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-sm font-bold leading-none"
              aria-label="Dodaj sprzedaż B2C"
            >
              +
            </Link>
          }
        >
          {(month.b2c_top?.length ?? 0) > 0 && month.b2c_top!.map(item => (
            <div key={item.uuid} className="py-1.5 border-b border-border/30 last:border-0">
              <div className="flex items-start justify-between">
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(item.date), 'EEEE d MMM', { locale: pl })}
                </p>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-green-700 ml-2">{formatPln(item.amount)}</span>
              </div>
              {/* Product lines breakdown */}
              {item.lines.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {item.lines.map((line, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate max-w-[65%]">
                        {line.qty > 1 ? `${line.qty} × ` : ''}{line.name}
                      </span>
                      <span className="tabular-nums">{formatPln(line.line_revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Manual entry note */}
              {item.sale_type === 'manual' && item.notes && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{item.notes}</p>
              )}
            </div>
          ))}
          <div className="pt-1 border-t border-border/40 mt-1">
            <Link
              to={`/cash-flow/sprzedaz?month=${month.period}`}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
            >
              <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Wszystkie wpisy B2C ({month.b2c_entries_count ?? 0})
            </Link>
          </div>
        </InnerExpandable>

        {/* Outstanding — expandable receivables list */}
        {outstandingTotal > 0 && (
          <>
            <div className="mx-4 border-t border-dashed border-border/70" />
            <InnerExpandable
              label={`⏳ Oczekuje (${outstandingCount} ${plFaktura(outstandingCount)})`}
              sub={[
                overdueAmount > 0 ? `${formatPln(overdueAmount)} po terminie` : '',
                soonAmount > 0 ? `${formatPln(soonAmount)} do 7 dni` : '',
              ].filter(Boolean).join(' · ') || undefined}
              amount={outstandingTotal}
              amountColor="text-yellow-600"
              disabled={isCurrentMonth ? today.receivables.length === 0 : (month.revenue_outstanding_top?.length ?? 0) === 0}
            >
              {/* Current month: individual receivable links */}
              {isCurrentMonth && today.receivables.length > 0 && today.receivables.map(r => (
                <Link
                  key={r.id}
                  to={`/invoices/${r.id}`}
                  className="flex items-center justify-between -mx-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="truncate text-xs font-medium">{r.customer_name || r.invoice_number}</p>
                    {r.customer_name && r.invoice_number && (
                      <p className="text-[10px] text-muted-foreground">{r.invoice_number}</p>
                    )}
                    {r.due_date && (
                      <p className="text-[10px] text-muted-foreground">
                        Termin: {format(parseISO(r.due_date), 'd MMM', { locale: pl })}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-yellow-600">{formatPln(r.amount)}</p>
                    {r.days_until !== null && (
                      <span className={`text-[10px] font-medium ${r.days_until < 0 ? 'text-destructive' : r.days_until <= 7 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                        {r.days_until < 0 ? `${Math.abs(r.days_until)} dni po terminie` : r.days_until === 0 ? 'Dziś!' : `za ${r.days_until} dni`}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
              {/* Historical: top outstanding with invoice details */}
              {!isCurrentMonth && (month.revenue_outstanding_top?.length ?? 0) > 0 && (
                month.revenue_outstanding_top!.map(item => (
                  <Link
                    key={item.id}
                    to={`/invoices/${item.id}`}
                    className="flex items-center justify-between -mx-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="truncate text-xs font-medium">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground">{item.invoice_number}</p>
                      {item.due_date && (
                        <p className="text-[10px] text-muted-foreground">
                          Termin: {format(parseISO(item.due_date), 'd MMM', { locale: pl })}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-semibold tabular-nums text-yellow-600">{formatPln(item.amount)}</p>
                      {(item.days_overdue ?? 0) > 0 && (
                        <p className="text-[10px] text-destructive">{item.days_overdue} dni po terminie</p>
                      )}
                    </div>
                  </Link>
                ))
              )}
              <div className="pt-1 border-t border-border/40 mt-1">
                <Link
                  to="/invoices?status=outstanding"
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                >
                  <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Wszystkie nierozliczone ({outstandingCount})
                </Link>
              </div>
            </InnerExpandable>
          </>
        )}
      </Section>

      {/* ── Accordion: KOSZTY ── */}
      <Section title="Koszty" total={totalCosts}>
        {/* KSeF invoices — expandable: invoice list + category breakdown */}
        <InnerExpandable
          label="Faktury dostawców (KSeF)"
          sub={`${month.costs_ksef_count ?? 0} ${
            (month.costs_ksef_count ?? 0) === 1 ? 'faktura' :
            (month.costs_ksef_count ?? 0) <= 4 ? 'faktury' : 'faktur'
          }`}
          amount={month.costs_ksef}
          disabled={(month.costs_ksef_items?.length ?? 0) === 0 && (month.costs_ksef_by_category?.length ?? 0) === 0}
        >
          {/* Individual invoice list */}
          {(month.costs_ksef_items?.length ?? 0) > 0 && month.costs_ksef_items!.map(inv => (
            <Link
              key={inv.id}
              to={`/ksef/inbox/${inv.id}`}
              className="flex items-start justify-between -mx-2 px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1 pr-2">
                <p className="truncate text-xs font-medium">{inv.seller_name}</p>
                <p className="text-[10px] text-muted-foreground">{inv.invoice_number} · {format(parseISO(inv.issue_date), 'd MMM', { locale: pl })}</p>
                {inv.category_labels.length > 0 && (
                  <p className="text-[10px] text-primary/80 mt-0.5">{inv.category_labels.join(', ')}</p>
                )}
                {inv.net_amount != null && inv.vat_amount != null && (
                  <p className="text-[10px] text-muted-foreground/70">
                    netto {formatPln(inv.net_amount)} + VAT {formatPln(inv.vat_amount)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold tabular-nums">{formatPln(inv.amount)}</p>
                {inv.due_date && (
                  <p className="text-[10px] text-muted-foreground">
                    {inv.is_paid ? '✓ opłacone' : `→ ${format(parseISO(inv.due_date), 'd MMM', { locale: pl })}`}
                  </p>
                )}
              </div>
            </Link>
          ))}
          {/* Category breakdown if available */}
          {(month.costs_ksef_by_category?.length ?? 0) > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground mt-1 mb-0.5 uppercase tracking-wide">Wg kategorii</p>
              {month.costs_ksef_by_category!.map((cat, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{cat.label}</span>
                  <span className="font-medium tabular-nums">{formatPln(cat.total)}</span>
                </div>
              ))}
            </>
          )}
          <div className="pt-1 border-t border-border/40 mt-1">
            <Link
              to="/ksef/inbox"
              className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
            >
              <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Wszystkie faktury dostawców ({month.costs_ksef_count ?? 0})
            </Link>
          </div>
        </InnerExpandable>

        {/* Other quick expenses — expandable: individual list + category summary */}
        <InnerExpandable
          label="Inne wydatki"
          sub={(month.costs_quick_by_category?.length ?? 0) > 0
            ? month.costs_quick_by_category!.map(c => c.label).join(', ')
            : 'paliwo, materiały, usługi...'}
          amount={month.costs_quick}
          action={
            <button
              onClick={onAddKoszty}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-sm font-bold leading-none"
              aria-label="Dodaj wydatek"
            >
              +
            </button>
          }
          disabled={month.recent_quick_expenses.length === 0}
        >
          {/* Individual expense rows */}
          {month.recent_quick_expenses.map(exp => (
            <div key={exp.id} className="flex items-center justify-between py-1">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-xs font-medium truncate">{exp.vendor || exp.category_label}</p>
                <p className="text-[10px] text-muted-foreground">
                  {exp.category_label}{exp.vendor ? ` · ${format(parseISO(exp.date), 'd MMM', { locale: pl })}` : ` · ${format(parseISO(exp.date), 'd MMM', { locale: pl })}`}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums">{formatPln(parseFloat(exp.amount))}</span>
            </div>
          ))}
          {/* Category summary */}
          {(month.costs_quick_by_category?.length ?? 0) > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground mt-1 mb-0.5 uppercase tracking-wide">Wg kategorii</p>
              {month.costs_quick_by_category!.map((cat, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {cat.label}
                    <span className="ml-1 text-muted-foreground/60">· {cat.count} {cat.count === 1 ? 'wpis' : 'wpisy'}</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatPln(cat.total)}</span>
                </div>
              ))}
            </>
          )}
        </InnerExpandable>

        {/* Fixed costs — expandable item list */}
        <InnerExpandable
          label="Koszty stałe"
          sub={fixedSub || 'wynajem, płace, leasing...'}
          amount={month.costs_fixed}
          disabled={(month.costs_fixed_items?.length ?? 0) === 0}
        >
          {(month.costs_fixed_items?.length ?? 0) > 0 && month.costs_fixed_items!.map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{item.description}</span>
              <span className="font-medium tabular-nums">{formatPln(item.amount)}</span>
            </div>
          ))}
        </InnerExpandable>

        {/* Unpaid supplier invoices (payables) */}
        {isCurrentMonth && today.payables.total_count > 0 && (
          <>
            <div className="mx-4 border-t border-dashed border-border/70" />
            <InnerExpandable
              label="Niezapłacone faktury dostawców"
              sub={`${today.payables.total_count} ${plFaktura(today.payables.total_count)} niezapłaconych`}
              amount={today.payables.total_amount}
              amountColor="text-orange-700"
              disabled={today.payables.items.length === 0}
            >
              {today.payables.items.map(p => (
                <Link
                  key={p.id}
                  to="/ksef/inbox?is_paid=false"
                  className="flex items-center justify-between -mx-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="truncate text-xs font-medium">{p.seller_name}</p>
                    {p.invoice_number && <p className="text-[10px] text-muted-foreground">{p.invoice_number}</p>}
                    {p.issue_date && <p className="text-[10px] text-muted-foreground">{format(parseISO(p.issue_date), 'd MMM yyyy', { locale: pl })}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-orange-700">−{formatPln(p.amount)}</p>
                    <span className={`text-[10px] font-medium ${p.days_until < 0 ? 'text-destructive' : p.days_until <= 7 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                      {p.days_until < 0 ? `${Math.abs(p.days_until)} dni po terminie` : p.days_until === 0 ? 'Dziś!' : `za ${p.days_until} dni`}
                    </span>
                  </div>
                </Link>
              ))}
              <Link
                to="/ksef/inbox?is_paid=false"
                className="mt-1 block text-center text-xs font-medium text-orange-700 hover:underline"
              >
                Zobacz wszystkie ({today.payables.total_count}) →
              </Link>
            </InnerExpandable>
          </>
        )}

        {/* Breakeven insight */}
        {breakEven > 0 && (
          <SectionDivider>
            <p className="text-xs text-amber-800 dark:text-amber-400">
              💡 Żeby wyjść na zero potrzebujesz jeszcze{' '}
              <span className="font-semibold">{formatPln(breakEven)}</span>{' '}
              przychodów w tym miesiącu
            </p>
          </SectionDivider>
        )}
      </Section>

      {/* ── Accordion: ZAREZERWUJ NA PODATKI ── */}
      {taxTotal > 0 && (
        <Section title="Zarezerwuj na podatki" total={taxTotal}>
          {/* VAT — expandable breakdown */}
          {month.vat_to_pay > 0 && (
            <InnerExpandable
              label={vatLabel}
              amount={month.vat_to_pay}
              badge={vatOb && isCurrentMonth ? <DueBadge daysUntil={vatOb.days_until} dueDate={vatOb.due_date} /> : undefined}
              disabled={month.vat_output === 0}
            >
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
              {(month.vat_input_invoices?.length ?? 0) > 0 && (
                <details className="mt-1">
                  <summary className="list-none cursor-pointer text-xs text-primary hover:underline underline-offset-2">
                    Faktury odliczające VAT ({month.vat_input_invoices.length}) ▾
                  </summary>
                  <div className="mt-1 space-y-1 rounded-lg bg-muted/50 p-2">
                    {month.vat_input_invoices.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between text-xs">
                        <span className="truncate text-muted-foreground">
                          {inv.vendor || 'Nieznany dostawca'} · {format(parseISO(inv.issue_date), 'd MMM', { locale: pl })}
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
            </InnerExpandable>
          )}

          {/* ZUS społeczny — expandable breakdown */}
          {month.zus_social > 0 && (
            <InnerExpandable
              label="ZUS społeczny"
              amount={month.zus_social}
              badge={zusOb && isCurrentMonth ? <DueBadge daysUntil={zusOb.days_until} dueDate={zusOb.due_date} /> : undefined}
              disabled={(month.zus_breakdown?.length ?? 0) === 0}
            >
              {month.zus_breakdown?.map((row, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.value}</span>
                </div>
              ))}
            </InnerExpandable>
          )}

          {/* Składka zdrowotna — expandable breakdown */}
          {month.zus_health > 0 && (
            <InnerExpandable
              label="Składka zdrowotna"
              amount={month.zus_health}
              badge={zusHOb && isCurrentMonth ? <DueBadge daysUntil={zusHOb.days_until} dueDate={zusHOb.due_date} /> : undefined}
              disabled={(month.health_breakdown?.length ?? 0) === 0}
            >
              {month.health_breakdown?.map((row, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.value}</span>
                </div>
              ))}
            </InnerExpandable>
          )}

          {/* PIT — expandable breakdown */}
          <InnerExpandable
            label={
              <span className="flex items-center gap-1">
                PIT
                {month.pit_is_estimate && (
                  <span title="Szacunek — rzeczywista zaliczka może się różnić." className="cursor-help text-xs text-muted-foreground/60">ⓘ</span>
                )}
              </span>
            }
            amount={month.pit_estimate}
            badge={pitOb && isCurrentMonth && month.pit_estimate > 0 ? <DueBadge daysUntil={pitOb.days_until} dueDate={pitOb.due_date} /> : undefined}
            disabled={(month.pit_breakdown?.length ?? 0) === 0}
          >
            {month.pit_breakdown?.map((row, i) => (
              <div key={i} className={`flex justify-between text-xs ${row.label.startsWith('=') || row.label === 'Zaliczka podatku dochodowego' ? 'border-t border-border pt-1.5 font-semibold' : ''}`}>
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
          </InnerExpandable>

          {/* Smart insight — only for current month with live receivables */}
          {isCurrentMonth && outstandingTotal > 0 && zusTotal > 0 && (
            <SectionDivider>
              {outstandingTotal >= zusTotal ? (
                <p className="text-xs text-blue-800 dark:text-blue-300">
                  💡 Oczekujące faktury (
                  <span className="font-semibold">{formatPln(outstandingTotal)}</span>
                  ) pokryją ZUS (
                  <span className="font-semibold">{formatPln(zusTotal)}</span>
                  ){zusOb?.due_date && ` przed terminem ${format(parseISO(zusOb.due_date), 'd MMM', { locale: pl })}`}
                  {' '}— warto przypomnieć klientom o płatności.
                </p>
              ) : (
                <p className="text-xs text-blue-800 dark:text-blue-300">
                  💡 Oczekujące faktury (
                  <span className="font-semibold">{formatPln(outstandingTotal)}</span>
                  ) częściowo pokryją ZUS (
                  <span className="font-semibold">{formatPln(zusTotal)}</span>
                  ) — brakuje jeszcze{' '}
                  <span className="font-semibold">{formatPln(zusTotal - outstandingTotal)}</span>.
                </p>
              )}
            </SectionDivider>
          )}
        </Section>
      )}

      {/* ── Chart ── */}
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
    `rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
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

        <PageExplainer
          summary="Jak są liczone te kwoty?"
          items={[
            {
              icon: '📊',
              label: 'Przychód = faktury już opłacone',
              description: 'Tylko pieniądze które realnie wpłynęły. Faktury wystawione ale nieopłacone nie są liczone — widać je w sekcji "Oczekuje".',
            },
            {
              icon: '🧾',
              label: 'Koszty = wg daty wystawienia faktury',
              description: 'Faktura kosztowa wystawiona w sierpniu zalicza się do sierpnia — nawet jeśli termin płatności jest we wrześniu.',
            },
            {
              icon: '🏛️',
              label: 'Podatki i ZUS',
              description: 'Szacunki na podstawie Twoich ustawień podatkowych. PIT to przybliżenie — ostateczną kwotę wylicza księgowy.',
            },
            {
              icon: '💡',
              label: '"Zostaje dla Ciebie"',
              description: 'Przychód minus koszty minus podatki i ZUS. To ile realnie możesz wypłacić jako wynagrodzenie lub reinwestować.',
            },
          ]}
          example="Wystawiłaś fakturę 28 sierpnia za 5000 zł z terminem płatności 15 września. Klient zapłacił 2 września. W sierpniu: 0 zł przychodu (nieopłacona). We wrześniu: +5000 zł przychodu (wpłynęła). Koszt faktury od dostawcy wystawionej w sierpniu → sierpień, niezależnie kiedy zapłacisz."
          exampleLabel="Przykład"
        />

        <div className="mb-5 flex items-center gap-3">
          <div className="flex rounded-xl bg-muted p-1 gap-1">
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

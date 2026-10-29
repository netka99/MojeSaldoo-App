import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { formatMoneyGross } from '@/lib/order-utils';
import { reportingService } from '@/services/reporting.service';
import {
  ReportShell,
  reportTitleClass,
  reportSubtitleClass,
  reportLabelClass,
  reportPresetClass,
  reportThClass,
  reportRowClass,
  reportTableClass,
} from '@/lib/reportSurface';
import type { CustomerFlowReport, FlowCustomerRow, FlowInvoiceEntry, FlowManualInvoice, FlowOrderDetail, FlowOrderLine, FlowProblem, FlowWzEntry } from '@/types/reporting.types';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';

/* ── Date helpers ──────────────────────────────────────────────── */
function toIso(d: Date) { return d.toISOString().slice(0, 10); }
function startOfMonth(now = new Date()) { return toIso(new Date(now.getFullYear(), now.getMonth(), 1)); }
function endOfMonth(now = new Date()) { return toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
function periodPresets(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  return [
    { label: 'Ten miesiąc',  from: toIso(new Date(y, m, 1)),     to: toIso(new Date(y, m + 1, 0)) },
    { label: 'Poprzedni',    from: toIso(new Date(y, m - 1, 1)),  to: toIso(new Date(y, m, 0)) },
    { label: '3 miesiące',   from: toIso(new Date(y, m - 2, 1)),  to: toIso(new Date(y, m + 1, 0)) },
    { label: 'Ten rok',      from: `${y}-01-01`,                  to: `${y}-12-31` },
  ];
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}
function plnFmt(v: string | number | null | undefined) {
  if (v == null || v === '') return '—';
  return formatMoneyGross(v);
}

/* ── Status labels ─────────────────────────────────────────────── */
const INV_STATUS_PL: Record<string, string> = {
  draft: 'szkic', issued: 'wystawiona', sent: 'wysłana', paid: 'opłacona',
  overdue: 'zaległa', cancelled: 'anulowana', corrected: 'skorygowana', refund_due: 'do zwrotu',
};
const WZ_STATUS_PL: Record<string, string> = {
  draft: 'szkic', saved: 'zapisany', in_transit: 'w trasie',
  delivered: 'dostarczony', cancelled: 'anulowany', corrected: 'skorygowany',
};

/* ── Problem config ────────────────────────────────────────────── */
type ProblemKey = FlowProblem | 'all' | 'ok';

const PROBLEM_CONFIG: Record<FlowProblem, { label: string; short: string; color: string; pill: string }> = {
  delivered_no_invoice: {
    label: 'Dostarczone bez faktury',
    short: 'Brak faktury',
    color: 'text-amber-700',
    pill: 'bg-amber-100 text-amber-800',
  },
  delivered_no_wz: {
    label: 'Dostarczone bez WZ',
    short: 'Brak WZ',
    color: 'text-orange-700',
    pill: 'bg-orange-100 text-orange-800',
  },
  wz_no_invoice: {
    label: 'WZ bez faktury',
    short: 'WZ bez FV',
    color: 'text-amber-700',
    pill: 'bg-amber-100 text-amber-800',
  },
  invoice_overdue: {
    label: 'Faktura zaległa',
    short: 'Zaległa FV',
    color: 'text-red-600',
    pill: 'bg-red-100 text-red-700',
  },
  wz_zw_no_fvkor: {
    label: 'ZW bez korekty FV',
    short: 'ZW bez FV-KOR',
    color: 'text-purple-700',
    pill: 'bg-purple-100 text-purple-800',
  },
};

/* ── Icons ─────────────────────────────────────────────────────── */
function BackIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronDown({ open }: { open: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} stroke="currentColor" strokeWidth={2} aria-hidden><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function OkIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-emerald-500" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function WarnIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-amber-500" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 9v4M12 17h.01" strokeLinecap="round" /></svg>;
}
function ErrIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-red-500" stroke="currentColor" strokeWidth={2} aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" /></svg>;
}

/* ── Row-level status badge ────────────────────────────────────── */
function ProblemBadge({ problem }: { problem: FlowProblem | null }) {
  if (!problem) return null;
  const cfg = PROBLEM_CONFIG[problem];
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', cfg.pill)}>
      {cfg.short}
    </span>
  );
}

/* ── Lines table ───────────────────────────────────────────────── */
function fmtQty(v: string) {
  const n = parseFloat(v);
  return isNaN(n) ? '—' : (n % 1 === 0 ? n.toString() : n.toFixed(2));
}

function LinesTable({ lines }: { lines: FlowOrderLine[] }) {
  if (lines.length === 0) return <p className="px-3 py-2 text-xs text-slate-400 italic">Brak linii</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-100">
          <th className="py-1.5 pl-3 pr-2 text-left font-medium text-slate-400 uppercase tracking-wide">Produkt</th>
          <th className="py-1.5 px-2 text-right font-medium text-slate-400 uppercase tracking-wide">Zamów.</th>
          <th className="py-1.5 px-2 text-right font-medium text-slate-400 uppercase tracking-wide">Dost.</th>
          <th className="py-1.5 px-2 text-right font-medium text-slate-400 uppercase tracking-wide">Zwrot</th>
          <th className="py-1.5 pl-2 pr-3 text-right font-medium text-slate-400 uppercase tracking-wide">Zafakt.</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {lines.map((l, i) => {
          const invoiced = parseFloat(l.invoiced_qty);
          const delivered = parseFloat(l.delivered_qty);
          const returned = parseFloat(l.returned_qty);
          const net = delivered - returned;
          const diff = invoiced - net;
          const hasGap = Math.abs(diff) > 0.001 && invoiced > 0;
          return (
            <tr key={l.product_id ?? i} className="hover:bg-slate-50/60">
              <td className="py-1.5 pl-3 pr-2 font-medium text-slate-700">
                {l.product_name}
                {l.unit && <span className="ml-1 text-slate-400 font-normal">{l.unit}</span>}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{fmtQty(l.ordered_qty)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{fmtQty(l.delivered_qty)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                {parseFloat(l.returned_qty) > 0 ? <span className="text-amber-600">−{fmtQty(l.returned_qty)}</span> : '—'}
              </td>
              <td className="py-1.5 pl-2 pr-3 text-right tabular-nums">
                <span className={hasGap ? 'font-semibold text-amber-600' : 'text-slate-600'}>
                  {invoiced > 0 ? fmtQty(l.invoiced_qty) : '—'}
                </span>
                {hasGap && (
                  <span className="ml-1 text-[10px] text-amber-500">({diff > 0 ? '+' : ''}{fmtQty(diff.toFixed(2))})</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Customer aggregate lines ──────────────────────────────────── */
function aggregateLines(orders: FlowOrderDetail[]): FlowOrderLine[] {
  const map = new Map<string, FlowOrderLine>();
  for (const o of orders) {
    for (const l of o.lines) {
      const key = l.product_id ?? l.product_name;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...l });
      } else {
        existing.ordered_qty   = (parseFloat(existing.ordered_qty)   + parseFloat(l.ordered_qty)).toString();
        existing.delivered_qty = (parseFloat(existing.delivered_qty) + parseFloat(l.delivered_qty)).toString();
        existing.returned_qty  = (parseFloat(existing.returned_qty)  + parseFloat(l.returned_qty)).toString();
        existing.invoiced_qty  = (parseFloat(existing.invoiced_qty)  + parseFloat(l.invoiced_qty)).toString();
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.product_name.localeCompare(b.product_name, 'pl'));
}

/* ── Drill-down row ────────────────────────────────────────────── */
function OrderDetailRow({ row, striped }: { row: FlowOrderDetail; striped: boolean }) {
  const [linesOpen, setLinesOpen] = useState(false);
  const statusLabel = row.status ? (ORDER_STATUS_LABELS_PL[row.status as keyof typeof ORDER_STATUS_LABELS_PL] ?? row.status) : '—';
  const hasLines = row.lines.length > 0;

  return (
    <div className={cn(
      'border-t border-slate-200',
      !row.ok ? 'bg-amber-50' : striped ? 'bg-slate-100' : 'bg-white',
    )}>
      <div className="grid grid-cols-3 divide-x divide-slate-200">
        <div className="min-w-0 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {row.id ? (
                <Link to={`/orders/${row.id}`} className="text-sm font-medium text-primary hover:underline">
                  {row.order_number ?? '—'}
                </Link>
              ) : (
                <p className="text-sm text-slate-400">—</p>
              )}
              <p className="text-xs text-slate-500">
                {row.status ? `${statusLabel} · ${fmtDate(row.delivery_date)}` : '—'}
              </p>
              {row.total_gross && (
                <p className="text-xs font-medium tabular-nums text-slate-700">{plnFmt(row.total_gross)}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {row.problem === 'invoice_overdue' ? <ErrIcon /> : row.ok ? <OkIcon /> : <WarnIcon />}
              <ProblemBadge problem={row.problem} />
              {hasLines && (
                <button
                  type="button"
                  onClick={() => setLinesOpen((v) => !v)}
                  className="flex items-center rounded-lg px-1 py-0.5 text-slate-500 hover:bg-slate-100"
                  title="Pokaż linie produktów"
                  aria-expanded={linesOpen}
                >
                  <ChevronDown open={linesOpen} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 px-3 py-2.5">
          {row.wz.length === 0 ? (
            <p className="text-sm text-slate-400">—</p>
          ) : (
            <div className="flex flex-col gap-2">
              {row.wz.map((wz: FlowWzEntry) => (
                <div key={wz.id}>
                  <Link to={`/delivery/${wz.id}`} className="text-sm font-medium text-emerald-700 hover:underline">
                    {wz.number ?? 'WZ'}
                  </Link>
                  <p className="text-xs text-slate-500">{WZ_STATUS_PL[wz.status] ?? wz.status}</p>
                  {wz.zw?.map((zw) => (
                    <div key={zw.id} className="mt-1">
                      <Link to={`/delivery/${zw.id}`} className="text-sm font-medium text-amber-700 hover:underline">
                        {zw.number ?? 'ZW'}
                      </Link>
                      <p className="text-xs text-slate-500">zwrot</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 px-3 py-2.5">
          {row.invoices.length === 0 ? (
            <p className="text-sm text-slate-400">—</p>
          ) : (
            <div className="flex flex-col gap-2">
              {row.invoices.map((inv: FlowInvoiceEntry) => (
                <div key={inv.id}>
                  <div className="flex flex-wrap items-center gap-1">
                    <Link to={`/invoices/${inv.id}`}
                      className={cn('text-sm font-medium hover:underline',
                        inv.status === 'overdue' ? 'text-red-600' :
                        inv.status === 'paid' ? 'text-emerald-700' : 'text-sky-700')}>
                      {inv.number ?? 'FV'}
                    </Link>
                    {inv.cross_period && (
                      <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
                        title="Ta faktura obejmuje zamówienia spoza wybranego okresu">
                        spoza okresu
                      </span>
                    )}
                    {inv.corrections.length > 0 && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {inv.corrections.length} KOR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {INV_STATUS_PL[inv.status] ?? inv.status}
                    {inv.due_date && ` · ${fmtDate(inv.due_date)}`}
                  </p>
                  <p className="text-xs font-medium tabular-nums text-slate-700">{plnFmt(inv.total_gross)}</p>
                  {inv.corrections.map((kor) => (
                    <div key={kor.id} className="mt-1">
                      <Link to={`/invoices/${kor.id}`} className="text-sm font-medium text-violet-600 hover:underline">
                        {kor.number ?? 'FV-KOR'}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {INV_STATUS_PL[kor.status] ?? kor.status}
                        {kor.issue_date && ` · ${fmtDate(kor.issue_date)}`}
                      </p>
                      <p className="text-xs font-medium tabular-nums text-slate-700">{plnFmt(kor.total_gross)}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {linesOpen && hasLines && (
        <div className="border-t border-slate-100 bg-white">
          <LinesTable lines={row.lines} />
        </div>
      )}
    </div>
  );
}

/* ── Manual invoice row ────────────────────────────────────────── */
function ManualInvoiceRow({ inv }: { inv: FlowManualInvoice }) {
  const isOverdue = inv.status === 'overdue'
    || (inv.status === 'issued' && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10));
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <Link to={`/invoices/${inv.id}`}
          className={cn('text-sm font-medium hover:underline',
            isOverdue ? 'text-red-600' :
            inv.status === 'paid' ? 'text-emerald-700' : 'text-sky-700')}>
          {inv.number ?? 'FV'}
        </Link>
        <p className="text-xs text-slate-500">
          {INV_STATUS_PL[inv.status] ?? inv.status}
          {inv.issue_date && ` · ${fmtDate(inv.issue_date)}`}
          {inv.due_date && ` · termin ${fmtDate(inv.due_date)}`}
        </p>
        <p className="text-xs font-medium tabular-nums text-slate-700">{plnFmt(inv.total_gross)}</p>
        {inv.lines.length > 0 && (
          <p className="mt-0.5 text-xs text-slate-400">
            {inv.lines.map((l) => `${l.product_name} ×${l.quantity}${l.unit ? ' ' + l.unit : ''}`).join(', ')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isOverdue ? <ErrIcon /> : <OkIcon />}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
          ręczna
        </span>
      </div>
    </div>
  );
}

function pozycjeCount(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    n === 1
      ? 'pozycja'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'pozycje'
        : 'pozycji';
  return `${n} ${word}`;
}

/* ── Product summary (collapsible) ─────────────────────────────── */
function ProductSummaryBlock({ lines }: { lines: FlowOrderLine[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">Podsumowanie produktów</span>
          <span className="text-xs font-normal tabular-nums text-slate-500">{pozycjeCount(lines.length)}</span>
        </span>
        <ChevronDown open={open} />
      </button>
      {open && (
        <div className="border-t border-slate-200">
          <LinesTable lines={lines} />
        </div>
      )}
    </div>
  );
}

/* ── Manual invoices (collapsible) ─────────────────────────────── */
function ManualInvoicesBlock({ invoices }: { invoices: FlowManualInvoice[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">Faktury bez zamówienia</span>
          <span className="text-xs font-normal tabular-nums text-slate-500">{pozycjeCount(invoices.length)}</span>
        </span>
        <ChevronDown open={open} />
      </button>
      {open && (
        <div className="divide-y divide-slate-100 border-t border-slate-200">
          {invoices.map((inv) => (
            <ManualInvoiceRow key={inv.id} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Orders block (one container) ──────────────────────────────── */
function OrdersBlock({ orders }: { orders: FlowOrderDetail[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">Zamówienia</span>
          <span className="text-xs font-normal tabular-nums text-slate-500">{pozycjeCount(orders.length)}</span>
        </span>
        <ChevronDown open={open} />
      </button>
      {open && (
        <>
          <div className="grid grid-cols-3 divide-x divide-slate-200 border-t border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-400">
            <span className="px-3 py-1.5">Zamówienie</span>
            <span className="px-3 py-1.5">WZ</span>
            <span className="px-3 py-1.5">Faktura</span>
          </div>
          {orders.length === 0 ? (
            <p className="border-t border-slate-100 px-3 py-2 text-sm text-slate-400">Brak pozycji.</p>
          ) : (
            orders.map((detail, i) => (
              <OrderDetailRow key={detail.id ?? `stan-${i}`} row={detail} striped={i % 2 === 1} />
            ))
          )}
        </>
      )}
    </div>
  );
}

/* ── Customer row (collapsible) ────────────────────────────────── */
function CustomerRow({ row, wzRequired }: { row: FlowCustomerRow; wzRequired: boolean }) {
  const [open, setOpen] = useState(false);
  const hasProblems = row.problems.length > 0;
  const worstProblem = row.problems.includes('invoice_overdue') ? 'invoice_overdue'
    : row.problems.length > 0 ? row.problems[0]! : null;

  return (
    <div className={cn(
      'overflow-hidden rounded-2xl border bg-white md:rounded-3xl',
      hasProblems ? 'border-amber-200' : 'border-slate-200',
    )}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div className="grid items-center gap-3 px-4 py-3 md:px-5
          grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(60px,1fr))_auto_auto]">

          {/* Customer name + problems */}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{row.customer_name}</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {row.problems.map((p) => (
                <span key={p} className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', PROBLEM_CONFIG[p].pill)}>
                  {PROBLEM_CONFIG[p].short}
                </span>
              ))}
            </div>
          </div>

          {/* Zamówienia */}
          <div className="text-center">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">Zamówienia</p>
            <p className="text-base font-bold tabular-nums text-slate-900">{row.orders.total}</p>
            <p className="text-[11px] tabular-nums text-slate-500">
              {row.orders.open > 0 && <span className="text-amber-600">{row.orders.open} otwarte</span>}
              {row.orders.open > 0 && row.orders.cancelled > 0 && ' · '}
              {row.orders.cancelled > 0 && <span className="text-slate-400">{row.orders.cancelled} anu.</span>}
              {row.orders.open === 0 && row.orders.cancelled === 0 && <span className="text-emerald-600">{row.orders.invoiced} zafakt.</span>}
            </p>
          </div>

          {/* WZ */}
          <div className="text-center">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">WZ</p>
            <p className={cn('text-base font-bold tabular-nums', row.wz.without_invoice > 0 ? 'text-amber-600' : 'text-slate-900')}>
              {row.wz.total}
            </p>
            {row.wz.without_invoice > 0 ? (
              <p className="text-[11px] tabular-nums text-amber-600">{row.wz.without_invoice} bez FV</p>
            ) : (
              <p className="text-[11px] text-slate-400">—</p>
            )}
          </div>

          {/* Faktury */}
          <div className="text-center">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">Faktury</p>
            <p className={cn('text-base font-bold tabular-nums', row.invoices.overdue > 0 ? 'text-red-600' : 'text-slate-900')}>
              {row.invoices.total}
            </p>
            <p className="text-[11px] tabular-nums text-slate-600">{plnFmt(row.invoices.total_gross)}</p>
            {row.invoices.overdue > 0 && (
              <p className="text-[11px] tabular-nums text-red-600">{row.invoices.overdue} zaległa</p>
            )}
          </div>

          {/* OK icon */}
          <div>
            {!hasProblems ? <OkIcon /> : worstProblem === 'invoice_overdue' ? <ErrIcon /> : <WarnIcon />}
          </div>

          <ChevronDown open={open} />
        </div>
      </button>

      {/* Drill-down */}
      {open && (
        <div className="flex flex-col gap-5 border-t border-slate-100 bg-[#F2F2F7] px-4 py-4 md:px-5">
          {(() => {
            const agg = aggregateLines(row.orders_detail);
            return agg.length > 0 ? <ProductSummaryBlock lines={agg} /> : null;
          })()}

          <OrdersBlock orders={row.orders_detail} />

          {row.manual_invoices.length > 0 && (
            <ManualInvoicesBlock invoices={row.manual_invoices} />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Filter pills ──────────────────────────────────────────────── */
const FILTER_OPTIONS: { key: ProblemKey; label: string }[] = [
  { key: 'all',                   label: 'Wszyscy' },
  { key: 'delivered_no_invoice',  label: 'Brak faktury' },
  { key: 'wz_no_invoice',         label: 'WZ bez FV' },
  { key: 'invoice_overdue',       label: 'Zaległe FV' },
  { key: 'wz_zw_no_fvkor',        label: 'ZW bez FV-KOR' },
];

/* ── Summary bar ───────────────────────────────────────────────── */
function SummaryBar({ data }: { data: CustomerFlowReport }) {
  const totalCustomers = data.customers.length;
  const withProblems   = data.customers.filter((c) => c.problems.length > 0).length;
  const totalOrders    = data.customers.reduce((s, c) => s + c.orders.total, 0);
  const totalWz        = data.customers.reduce((s, c) => s + c.wz.total, 0);
  const totalInvoices  = data.customers.reduce((s, c) => s + c.invoices.total, 0);
  const wzNoInv        = data.customers.reduce((s, c) => s + c.wz.without_invoice, 0);
  const overdue        = data.customers.reduce((s, c) => s + c.invoices.overdue, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {[
        { label: 'Klientów', value: totalCustomers, sub: withProblems > 0 ? `${withProblems} z problemem` : 'wszystko ok', subColor: withProblems > 0 ? 'text-amber-600' : 'text-emerald-600' },
        { label: 'Zamówień', value: totalOrders, sub: null, subColor: '' },
        { label: 'WZ', value: totalWz, sub: wzNoInv > 0 ? `${wzNoInv} bez faktury` : null, subColor: 'text-amber-600' },
        { label: 'Faktur', value: totalInvoices, sub: overdue > 0 ? `${overdue} zaległych` : null, subColor: 'text-red-600' },
        { label: 'Problemów', value: withProblems, sub: null, subColor: '', accent: withProblems > 0 },
      ].map((s) => (
        <div key={s.label} className={cn(
          'rounded-2xl border p-3 md:rounded-3xl',
          s.accent ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white',
        )}>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{s.label}</p>
          <p className={cn('mt-0.5 text-2xl font-bold tabular-nums', s.accent ? 'text-amber-700' : 'text-slate-900')}>{s.value}</p>
          {s.sub && <p className={cn('text-[11px] font-medium', s.subColor)}>{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */
export function CustomerFlowReportPage() {
  const navigate = useNavigate();
  const presets = periodPresets();
  const [dateFrom, setDateFrom] = useState(startOfMonth());
  const [dateTo,   setDateTo]   = useState(endOfMonth());
  const [filter,   setFilter]   = useState<ProblemKey>('all');
  const [search,   setSearch]   = useState('');

  const { data, isLoading, isError } = useQuery<CustomerFlowReport>({
    queryKey: ['report-customer-flow', dateFrom, dateTo],
    queryFn: () => reportingService.fetchCustomerFlow({ date_from: dateFrom, date_to: dateTo }),
    enabled: Boolean(dateFrom && dateTo),
    staleTime: 60 * 1000,
  });

  const [okSectionOpen, setOkSectionOpen] = useState(false);

  const { withProblems, okRows } = useMemo(() => {
    if (!data) return { withProblems: [], okRows: [] };
    let rows = data.customers;
    if (filter !== 'all') rows = rows.filter((r) => r.problems.includes(filter as FlowProblem));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.customer_name.toLowerCase().includes(q));
    }
    return {
      withProblems: rows.filter((r) => r.problems.length > 0),
      okRows: filter === 'all' ? (data.customers.filter((r) => r.problems.length === 0 && (!search.trim() || r.customer_name.toLowerCase().includes(search.trim().toLowerCase())))) : [],
    };
  }, [data, filter, search]);

  const filterControlClass = 'border-[#D4D2EE] bg-white font-normal text-slate-900 placeholder:text-slate-500 focus:border-primary focus:bg-white';

  return (
    <ReportShell>
      {/* Header */}
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 md:h-10 md:w-10"
          aria-label="Wróć">
          <BackIcon />
        </button>
        <div className="min-w-0">
          <h1 className={reportTitleClass}>Przepływ rozliczeniowy</h1>
          <p className={reportSubtitleClass}>Zamówienia → WZ → Faktury per klient</p>
        </div>
      </header>

      {/* Filters */}
      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 md:rounded-3xl md:px-5">
        <div className="mb-3 flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = dateFrom === p.from && dateTo === p.to;
            return (
              <button key={p.label} type="button"
                onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                className={cn(reportPresetClass, active
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
                aria-pressed={active}>
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full sm:w-auto">
            <span className={reportLabelClass}>Od</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className={cn('date-pill w-full sm:w-52', filterControlClass)} />
          </label>
          <label className="block w-full sm:w-auto">
            <span className={reportLabelClass}>Do</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className={cn('date-pill w-full sm:w-52', filterControlClass)} />
          </label>
        </div>
      </section>

      {isLoading && (
        <div className="flex justify-center py-16" role="status" aria-busy="true">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      {isError && (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          Nie udało się wczytać raportu.
        </p>
      )}

      {data && (
        <>
          <SummaryBar data={data} />

          {/* Filter pills + search */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTIONS.filter((opt) => {
                if (opt.key === 'wz_zw_no_fvkor') return data.returns_mode === 'fv_kor';
                if (opt.key === 'delivered_no_invoice') return data.returns_mode === 'fv_kor';
                return true;
              }).map((opt) => (
                <button key={opt.key} type="button"
                  onClick={() => setFilter(opt.key)}
                  className={cn(
                    'rounded-2xl border px-3 py-1.5 text-sm font-medium transition-colors',
                    filter === opt.key
                      ? 'border-primary bg-primary text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}>
                  {opt.label}
                  {opt.key !== 'all' && opt.key !== 'ok' && (
                    <span className="ml-1.5 tabular-nums">
                      {data.customers.filter((c) => c.problems.includes(opt.key as FlowProblem)).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Szukaj klienta…" className={cn('field-ios w-full pl-9', filterControlClass)} />
            </div>
          </div>

          {/* Z problemami */}
          {withProblems.length === 0 && filter === 'all' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-5 text-center md:rounded-3xl">
              <p className="text-sm font-semibold text-emerald-700">Wszyscy klienci domknięci ✓</p>
              <p className="mt-0.5 text-xs text-emerald-600">Brak niezafakturowanych WZ ani zaległych faktur.</p>
            </div>
          ) : withProblems.length === 0 && filter !== 'all' ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 md:rounded-3xl">
              Brak klientów z tym problemem.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {withProblems.map((row) => (
                <CustomerRow key={row.customer_id} row={row} wzRequired={data.wz_required} />
              ))}
            </div>
          )}

          {/* Domknięci — zwinięta sekcja */}
          {filter === 'all' && okRows.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
              <button
                type="button"
                onClick={() => setOkSectionOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="flex items-center gap-2">
                  <OkIcon />
                  <span className="text-sm font-medium text-slate-700">
                    Domknięci — {okRows.length} {okRows.length === 1 ? 'klient' : okRows.length < 5 ? 'klienci' : 'klientów'}
                  </span>
                </div>
                <ChevronDown open={okSectionOpen} />
              </button>
              {okSectionOpen && (
                <div className="flex flex-col gap-2 border-t border-slate-100 p-3">
                  {okRows.map((row) => (
                    <CustomerRow key={row.customer_id} row={row} wzRequired={data.wz_required} />
                  ))}
                </div>
              )}
            </div>
          )}

          {(data.wz_required || data.returns_mode === 'fv_kor') && (
            <div className="flex flex-col gap-0.5 px-1">
              {data.wz_required && (
                <p className="text-xs text-slate-400">* WZ wymagane przed fakturą (ustawienie firmy aktywne)</p>
              )}
              {data.returns_mode === 'fv_kor' && (
                <p className="text-xs text-slate-400">* Tryb zwrotów: oddzielna korekta FV-KOR — raport sprawdza, czy do ZW wystawiono FV-KOR</p>
              )}
              {data.returns_mode !== 'fv_kor' && (
                <p className="text-xs text-slate-400">* Tryb zwrotów: zwroty ujmowane na WZ — korekty ZW nie są śledzone oddzielnie</p>
              )}
            </div>
          )}
        </>
      )}
    </ReportShell>
  );
}

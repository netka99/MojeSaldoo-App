import { useState } from 'react';
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
  reportButtonClass,
  reportThClass,
  reportTdClass,
  reportTdMutedClass,
  reportRowClass,
  reportTableClass,
} from '@/lib/reportSurface';
import type {
  ReconciliationReport,
  ReconciliationOrderRow,
  ReconciliationInvoiceRow,
  ReconciliationDeliveryRow,
} from '@/types/reporting.types';

/* ── Date helpers ──────────────────────────────────────────────── */
function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function startOfMonth(now = new Date()) {
  return toIso(new Date(now.getFullYear(), now.getMonth(), 1));
}
function endOfMonth(now = new Date()) {
  return toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}
function periodPresets(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { label: 'Ten miesiąc',   from: toIso(new Date(y, m, 1)),   to: toIso(new Date(y, m + 1, 0)) },
    { label: 'Poprzedni',     from: toIso(new Date(y, m - 1, 1)), to: toIso(new Date(y, m, 0)) },
    { label: 'Ten rok',       from: `${y}-01-01`,                to: `${y}-12-31` },
  ];
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
}
function plnFmt(v: string | number | null | undefined) {
  if (v == null || v === '') return '—';
  return formatMoneyGross(v);
}

/* ── Labels ────────────────────────────────────────────────────── */
const ORDER_STATUS_PL: Record<string, string> = {
  draft: 'Szkic', confirmed: 'Potwierdzone', in_preparation: 'W przygotowaniu',
  loaded: 'Załadowane', in_delivery: 'W dostawie', partially_delivered: 'Częściowo dost.',
  delivered: 'Dostarczone', invoiced: 'Zafakturowane', cancelled: 'Anulowane',
};
const INV_STATUS_PL: Record<string, string> = {
  draft: 'Szkic', issued: 'Wystawiona', sent: 'Wysłana', paid: 'Opłacona',
  overdue: 'Zaległa', cancelled: 'Anulowana', corrected: 'Skorygowana', refund_due: 'Do zwrotu',
};
const DOC_TYPE_PL: Record<string, string> = {
  WZ: 'WZ', 'WZ-KOR': 'WZ-KOR', ZW: 'ZW', MM: 'MM', PZ: 'PZ', 'PZ-KOR': 'PZ-KOR', RW: 'RW',
};
const DOC_STATUS_PL: Record<string, string> = {
  draft: 'Szkic', saved: 'Zapisany', in_transit: 'W trasie',
  delivered: 'Dostarczony', cancelled: 'Anulowany', corrected: 'Skorygowany',
};

/* ── Color helpers ─────────────────────────────────────────────── */
function orderStatusColor(status: string) {
  if (status === 'invoiced') return 'text-violet-700';
  if (status === 'delivered') return 'text-emerald-700';
  if (status === 'cancelled') return 'text-red-600';
  if (['confirmed', 'in_delivery', 'loaded', 'in_preparation'].includes(status)) return 'text-amber-700';
  return 'text-slate-600';
}
function invStatusColor(status: string) {
  if (status === 'paid') return 'text-emerald-700';
  if (['overdue', 'cancelled', 'refund_due'].includes(status)) return 'text-red-600';
  if (['issued', 'sent'].includes(status)) return 'text-sky-700';
  return 'text-slate-600';
}
function docTypeColor(type: string) {
  if (type === 'WZ') return 'bg-emerald-50 text-emerald-700';
  if (type === 'WZ-KOR') return 'bg-purple-50 text-purple-700';
  if (type === 'ZW') return 'bg-amber-50 text-amber-700';
  if (type === 'PZ') return 'bg-sky-50 text-sky-700';
  if (type === 'PZ-KOR') return 'bg-violet-50 text-violet-700';
  if (type === 'RW') return 'bg-rose-50 text-rose-700';
  return 'bg-slate-100 text-slate-600';
}

/* ── Stat card ─────────────────────────────────────────────────── */
function StatCard({ label, count, gross, accent = 'slate' }: {
  label: string; count: number; gross?: string; accent?: 'slate' | 'emerald' | 'violet' | 'red' | 'amber';
}) {
  const accentMap = {
    slate:   'border-slate-200   bg-white',
    emerald: 'border-emerald-200 bg-emerald-50/40',
    violet:  'border-violet-200  bg-violet-50/40',
    red:     'border-red-200     bg-red-50/40',
    amber:   'border-amber-200   bg-amber-50/40',
  };
  const countMap = {
    slate: 'text-slate-900', emerald: 'text-emerald-700', violet: 'text-violet-700',
    red: 'text-red-600', amber: 'text-amber-700',
  };
  return (
    <div className={cn('rounded-2xl border p-4 md:rounded-3xl', accentMap[accent])}>
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={cn('mt-1 text-3xl font-bold tabular-nums', countMap[accent])}>{count}</p>
      {gross != null && (
        <p className="mt-0.5 text-sm font-medium tabular-nums text-slate-600">{plnFmt(gross)}</p>
      )}
    </div>
  );
}

/* ── Section header ────────────────────────────────────────────── */
function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <h2 className="text-sm font-semibold text-slate-900">{children}</h2>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────── */
function BackIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function OrderIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function TruckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>;
}
function InvIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8} aria-hidden><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6M9 11h6M9 15h4" strokeLinecap="round" /></svg>;
}
function AlertIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 9v4M12 17h.01" strokeLinecap="round" /></svg>;
}

/* ── Delivery breakdown grouped by type ───────────────────────── */
function DeliveryBreakdown({ rows }: { rows: ReconciliationDeliveryRow[] }) {
  const byType = rows.reduce<Record<string, ReconciliationDeliveryRow[]>>((acc, r) => {
    (acc[r.document_type] ??= []).push(r);
    return acc;
  }, {});

  const docTypes = ['WZ', 'WZ-KOR', 'ZW', 'PZ', 'PZ-KOR', 'MM', 'RW'].filter((t) => byType[t]);

  if (docTypes.length === 0) return <p className="text-sm text-slate-500 py-4 text-center">Brak dokumentów w tym okresie.</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {docTypes.map((type) => {
        const typeRows = byType[type]!;
        const total = typeRows.reduce((s, r) => s + r.count, 0);
        return (
          <div key={type} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className={cn('flex items-center justify-between px-3 py-2 border-b border-slate-100')}>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', docTypeColor(type))}>
                {DOC_TYPE_PL[type] ?? type}
              </span>
              <span className="text-sm font-bold tabular-nums text-slate-800">{total}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {typeRows.map((r) => (
                <div key={r.status} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-slate-500">{DOC_STATUS_PL[r.status] ?? r.status}</span>
                  <span className="font-medium tabular-nums text-slate-700">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────── */
export function ReconciliationReportPage() {
  const navigate = useNavigate();
  const presets = periodPresets();
  const [dateFrom, setDateFrom] = useState(startOfMonth());
  const [dateTo, setDateTo] = useState(endOfMonth());

  const { data, isLoading, isError } = useQuery<ReconciliationReport>({
    queryKey: ['report-reconciliation', dateFrom, dateTo],
    queryFn: () => reportingService.fetchReconciliation({ date_from: dateFrom, date_to: dateTo }),
    enabled: Boolean(dateFrom && dateTo),
    staleTime: 60 * 1000,
  });

  const filterControlClass = 'border-[#D4D2EE] bg-white font-normal text-slate-900 placeholder:text-slate-500 focus:border-primary focus:bg-white';

  /* Derived counts */
  const orderByStatus = (status: string) =>
    data?.orders.by_status.find((r) => r.status === status);
  const invByStatus = (status: string) =>
    data?.invoices.by_status.find((r) => r.status === status);

  const deliveredCount = (orderByStatus('delivered')?.count ?? 0) + (orderByStatus('invoiced')?.count ?? 0);
  const invoicedCount  = orderByStatus('invoiced')?.count ?? 0;
  const cancelledOrders = orderByStatus('cancelled')?.count ?? 0;
  const invPaid = (invByStatus('paid')?.count ?? 0);
  const invActive = (data?.invoices.by_status ?? [])
    .filter((r) => ['issued', 'sent', 'paid', 'overdue'].includes(r.status))
    .reduce((s, r) => s + r.count, 0);

  return (
    <ReportShell>
      {/* Header */}
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 md:h-10 md:w-10"
          aria-label="Wróć"
        >
          <BackIcon />
        </button>
        <div className="min-w-0">
          <h1 className={reportTitleClass}>Raport rozliczeniowy</h1>
          <p className={reportSubtitleClass}>Zamówienia · Dokumenty WZ · Faktury</p>
        </div>
      </header>

      {/* Filters */}
      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 md:rounded-3xl md:px-5">
        <div className="mb-3 flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = dateFrom === p.from && dateTo === p.to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                className={cn(reportPresetClass, active
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
                aria-pressed={active}
              >
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
        {data && (
          <p className="mt-2 text-xs text-slate-400">
            Okres: {fmtDate(data.period.date_from)} — {fmtDate(data.period.date_to)}
          </p>
        )}
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
          {/* ── Top KPIs ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Wszystkich zamówień" count={data.orders.total_count} gross={data.orders.total_gross} />
            <StatCard label="Anulowane zamówienia" count={cancelledOrders} accent="red" />
            <StatCard label="Faktury wystawione" count={invActive} gross={data.invoices.total_gross} accent="violet" />
            <StatCard label={`Niezafakturowane (do. lub inv.)`} count={data.gaps.count} accent={data.gaps.count > 0 ? 'amber' : 'emerald'} />
          </div>

          {/* ── Orders by status ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 md:rounded-3xl md:p-5 space-y-4">
            <SectionTitle icon={<OrderIcon />}>Zamówienia wg statusu</SectionTitle>
            <div className="overflow-x-auto">
              <table className={cn(reportTableClass, 'min-w-full')} aria-label="Zamówienia wg statusu">
                <thead>
                  <tr>
                    <th scope="col" className={reportThClass}>Status</th>
                    <th scope="col" className={cn(reportThClass, 'text-right')}>Liczba</th>
                    <th scope="col" className={cn(reportThClass, 'text-right')}>Wartość brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.by_status.map((r) => (
                    <tr key={r.status} className={reportRowClass}>
                      <td className={cn(reportTdClass, orderStatusColor(r.status), 'font-medium')}>
                        {ORDER_STATUS_PL[r.status] ?? r.status}
                      </td>
                      <td className={cn(reportTdMutedClass, 'text-right tabular-nums font-medium text-slate-800')}>{r.count}</td>
                      <td className={cn('whitespace-nowrap px-3 py-3 text-right tabular-nums text-sm font-medium text-slate-900')}>{plnFmt(r.gross)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-2.5 text-sm text-slate-800">Razem</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm text-slate-900">{data.orders.total_count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm text-slate-900">{plnFmt(data.orders.total_gross)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Delivery docs ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 md:rounded-3xl md:p-5 space-y-4">
            <SectionTitle icon={<TruckIcon />}>Dokumenty magazynowe i dostawcze</SectionTitle>
            <DeliveryBreakdown rows={data.delivery.by_type_status} />
          </section>

          {/* ── Invoices by status ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 md:rounded-3xl md:p-5 space-y-4">
            <SectionTitle icon={<InvIcon />}>Faktury wg statusu</SectionTitle>
            <div className="overflow-x-auto">
              <table className={cn(reportTableClass, 'min-w-full')} aria-label="Faktury wg statusu">
                <thead>
                  <tr>
                    <th scope="col" className={reportThClass}>Status</th>
                    <th scope="col" className={cn(reportThClass, 'text-right')}>Liczba</th>
                    <th scope="col" className={cn(reportThClass, 'text-right')}>Wartość brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.by_status.map((r) => (
                    <tr key={r.status} className={reportRowClass}>
                      <td className={cn(reportTdClass, invStatusColor(r.status), 'font-medium')}>
                        {INV_STATUS_PL[r.status] ?? r.status}
                      </td>
                      <td className={cn(reportTdMutedClass, 'text-right tabular-nums font-medium text-slate-800')}>{r.count}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-sm font-medium text-slate-900">{plnFmt(r.gross)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-2.5 text-sm text-slate-800">Razem</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm text-slate-900">{data.invoices.total_count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm text-slate-900">{plnFmt(data.invoices.total_gross)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Gaps ── */}
          <section className={cn(
            'rounded-2xl border p-4 md:rounded-3xl md:p-5 space-y-4',
            data.gaps.count > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white',
          )}>
            <div className="flex items-center justify-between gap-3">
              <SectionTitle icon={<AlertIcon />}>
                Dostarczone bez faktury
              </SectionTitle>
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                data.gaps.count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700',
              )}>
                {data.gaps.count > 0 ? `${data.gaps.count} brakujące` : 'Wszystko ok'}
              </span>
            </div>

            {data.gaps.count === 0 && (
              <p className="text-sm text-emerald-700 font-medium">
                Wszystkie dostarczone zamówienia mają fakturę. ✓
              </p>
            )}

            {data.gaps.count > 0 && (
              <div className="overflow-x-auto">
                <table className={cn(reportTableClass, 'min-w-full')} aria-label="Zamówienia bez faktury">
                  <thead>
                    <tr>
                      <th scope="col" className={reportThClass}>Numer</th>
                      <th scope="col" className={reportThClass}>Klient</th>
                      <th scope="col" className={reportThClass}>Data dostawy</th>
                      <th scope="col" className={cn(reportThClass, 'text-right')}>Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.gaps.delivered_without_invoice.map((o) => (
                      <tr key={o.id} className={reportRowClass}>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Link to={`/orders/${o.id}`} className="text-sm font-medium text-primary hover:underline">
                            {o.order_number ?? '—'}
                          </Link>
                        </td>
                        <td className={cn(reportTdClass, 'max-w-[200px] truncate')}>{o.customer_name}</td>
                        <td className={reportTdMutedClass}>{fmtDate(o.delivery_date)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-medium tabular-nums text-slate-900">{plnFmt(o.total_gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </ReportShell>
  );
}

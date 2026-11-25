/**
 * ProductionFlowReportPage — raport produkcji (product flow).
 * Route: /reports/production-flow
 *
 * Layout: per finished-product card, table rows = one row per source order (ZAM).
 * Columns: ZAM → Klient → Ilość → PRD → RW/PW → WZ → FV
 */

import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useProductionFlowQuery } from '@/query/use-production';
import {
  ReportShell,
  reportTitleClass,
  ReportExpandIcon,
  formatReportDate,
} from '@/lib/reportSurface';
import type { ProductFlowItem, ProductFlowRun, ProductFlowSourceOrder, ProductFlowUnscheduledOrder } from '@/types/production.types';

/* ── Date helpers ─────────────────────────────────────────────────── */

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function startOfMonth(d: Date) { return isoDate(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return isoDate(last.getFullYear(), last.getMonth(), last.getDate());
}
function fmtMonthLabel(d: Date) {
  return d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
}

/* ── Formatters ───────────────────────────────────────────────────── */

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function fmtQty(value: string | number | null | undefined, unit: string): string {
  if (value == null) return '—';
  const n = toNum(value);
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(3)} ${unit}`;
}

/* ── Inline link button ──────────────────────────────────────────── */

function DocLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-primary hover:underline"
    >
      {label}
    </button>
  );
}

/* ── Alert badge ──────────────────────────────────────────────────── */

function AlertBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
      {label}
    </span>
  );
}

/* ── Status badge ─────────────────────────────────────────────────── */

function StatusDot({ status }: { status: 'draft' | 'completed' }) {
  return status === 'completed' ? (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" title="Zakończone" />
  ) : (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" title="W toku" />
  );
}

/* ── Table row: one source order (ZAM) ───────────────────────────── */

type FlowRowProps = {
  so: ProductFlowSourceOrder;
  run: ProductFlowRun;
  unit: string;
  /** true when this row shares the PRD cell with other rows — show PRD only on first */
  showPrd: boolean;
  /** number of rows that share the same PRD (for rowspan visual hint) */
  prdRowCount: number;
};

function FlowRow({ so, run, unit, showPrd }: FlowRowProps) {
  const navigate = useNavigate();

  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
      {/* ZAM */}
      <td className="py-2.5 pl-4 pr-4 align-middle">
        <button
          type="button"
          onClick={() => navigate(`/orders/${so.order_id}`)}
          className="text-xs font-semibold text-primary hover:underline"
        >
          {so.order_number || '—'}
        </button>
      </td>

      {/* Klient */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        <span className="text-xs text-slate-600">{so.customer_name || '—'}</span>
      </td>

      {/* Zamówiono */}
      <td className="py-2.5 pl-3 pr-4 align-middle text-right">
        <span className="text-xs font-semibold tabular-nums text-slate-800">{fmtQty(so.qty_from_order, unit)}</span>
      </td>

      {/* PRD — only shown on first row sharing this run */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        <div className="flex items-center gap-1">
          <StatusDot status={run.status} />
          <button
            type="button"
            onClick={() => navigate(`/production/orders/${run.id}`)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {run.prd_number}
          </button>
          {run.source_orders.length > 1 && (
            <span className="text-[10px] text-slate-400">wspólne</span>
          )}
        </div>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          {formatReportDate(run.date)}
          {toNum(run.qty_produced) > 0 && (
            <> · <span className="font-semibold text-slate-600">{fmtQty(run.qty_produced, unit)}</span></>
          )}
        </span>
        {run.real_unit_cost != null && toNum(run.real_unit_cost) > 0 && (
          <span className="mt-0.5 block text-[11px] text-slate-400">
            {toNum(run.real_unit_cost).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł/szt
          </span>
        )}
      </td>

      {/* RW */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        {run.rw_number && run.rw_id
          ? <DocLink label={run.rw_number} onClick={() => navigate(`/delivery/${run.rw_id}`)} />
          : <span className="text-[11px] text-slate-300">—</span>}
      </td>

      {/* PW */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        {run.pw_number && run.pw_id
          ? <DocLink label={run.pw_number} onClick={() => navigate(`/delivery/${run.pw_id}`)} />
          : <span className="text-[11px] text-slate-300">—</span>}
      </td>

      {/* WZ */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        {so.wz_docs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-2">
            {so.wz_docs.map((wz) => (
              <span key={wz.id} className="inline-flex items-center gap-1">
                <DocLink label={wz.number} onClick={() => navigate(`/delivery/${wz.id}`)} />
                {toNum(wz.qty) > 0 && (
                  <span className="text-[10px] font-semibold text-slate-600">{fmtQty(wz.qty, unit)}</span>
                )}
                {wz.status !== 'delivered' && (
                  <span className="text-[10px] text-amber-500">(szkic)</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div>
            <span className="text-[11px] text-slate-300">brak WZ</span>
            {so.alerts?.includes('delivery_overdue') && (
              <div className="mt-0.5"><AlertBadge label="termin minął" /></div>
            )}
          </div>
        )}
        {so.alerts?.includes('wz_draft') && so.wz_docs.length > 0 && (
          <div className="mt-0.5"><AlertBadge label="WZ niepotwierdzony" /></div>
        )}
      </td>

      {/* FV */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        {so.invoices.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-2">
            {so.invoices.map((inv) => (
              <span key={inv.id} className="inline-flex items-center gap-1">
                <DocLink label={inv.number} onClick={() => navigate(`/invoices/${inv.id}`)} />
                {toNum(inv.qty) > 0 && (
                  <span className="text-[10px] font-semibold text-slate-600">{fmtQty(inv.qty, unit)}</span>
                )}
              </span>
            ))}
          </div>
        ) : so.has_wz ? (
          <AlertBadge label="brak FV" />
        ) : (
          <span className="text-[11px] text-slate-300">—</span>
        )}
        {so.alerts?.includes('partial_delivery') && (
          <div className="mt-0.5"><AlertBadge label="niedowóz" /></div>
        )}
      </td>
    </tr>
  );
}

/* ── "Na zapas" row (PRD without source orders) ───────────────────── */

function NaZapasRow({ run, unit }: { run: ProductFlowRun; unit: string }) {
  const navigate = useNavigate();
  const isStockProduction = run.alerts?.includes('stock_production');
  const missingLink = run.alerts?.includes('no_source_orders');
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
      {/* ZAM + Klient — merged label */}
      <td colSpan={2} className="py-2.5 pl-4 pr-2 align-middle">
        {isStockProduction ? (
          <span className="text-xs italic text-slate-400">na zapas</span>
        ) : missingLink ? (
          <AlertBadge label="brak ZAM" />
        ) : (
          <span className="text-xs italic text-slate-400">na zapas</span>
        )}
      </td>

      {/* Zamówiono */}
      <td className="py-2.5 pl-3 pr-4 align-middle text-right">
        <span className="text-xs tabular-nums text-slate-800">{fmtQty(run.qty_produced, unit)}</span>
      </td>

      {/* PRD */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        <div className="flex items-center gap-1">
          <StatusDot status={run.status} />
          <button
            type="button"
            onClick={() => navigate(`/production/orders/${run.id}`)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {run.prd_number}
          </button>
        </div>
        <span className="mt-0.5 block text-[11px] text-slate-400">{formatReportDate(run.date)}</span>
      </td>

      {/* RW */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        {run.rw_number && run.rw_id
          ? <DocLink label={run.rw_number} onClick={() => navigate(`/delivery/${run.rw_id}`)} />
          : <span className="text-[11px] text-slate-300">—</span>}
      </td>

      {/* PW */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        {run.pw_number && run.pw_id
          ? <DocLink label={run.pw_number} onClick={() => navigate(`/delivery/${run.pw_id}`)} />
          : <span className="text-[11px] text-slate-300">—</span>}
      </td>

      {/* WZ + FV — empty for na zapas */}
      <td className="py-2.5 pl-3 pr-4 align-middle">
        <span className="text-[11px] text-slate-300">—</span>
      </td>
      <td className="py-2.5 pl-3 pr-4 align-middle">
        <span className="text-[11px] text-slate-300">—</span>
      </td>
    </tr>
  );
}

/* ── Product card ─────────────────────────────────────────────────── */

function ProductCard({ item }: { item: ProductFlowItem }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const qtyProduced = toNum(item.qty_produced);
  const qtyDelivered = toNum(item.qty_delivered);
  const stockBefore = item.stock_before != null ? toNum(item.stock_before) : null;
  const stockAvail = item.stock_available != null ? toNum(item.stock_available) : null;
  const unit = item.product_unit;

  const calcBalance = qtyProduced - qtyDelivered;
  const balanceMismatch = calcBalance < -0.01;
  const unscheduled = item.unscheduled_orders ?? [];

  const totalCost = item.production_runs.reduce((sum, run) => sum + toNum(run.total_input_cost), 0);
  const hasCost = totalCost > 0;
  const qtyInvoiced = item.production_runs.reduce(
    (sum, run) => sum + run.source_orders.reduce((s, so) => s + toNum(so.qty_invoiced), 0), 0
  );

  // Build flat rows: for each run, one row per source order (or one "na zapas" row)
  type RowEntry =
    | { type: 'order'; so: ProductFlowSourceOrder; run: ProductFlowRun; showPrd: boolean; prdRowCount: number }
    | { type: 'zapas'; run: ProductFlowRun };

  const rows: RowEntry[] = [];
  for (const run of item.production_runs) {
    if (run.source_orders.length === 0) {
      rows.push({ type: 'zapas', run });
    } else {
      run.source_orders.forEach((so, idx) => {
        rows.push({
          type: 'order',
          so,
          run,
          showPrd: idx === 0,
          prdRowCount: run.source_orders.length,
        });
      });
    }
  }

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white md:rounded-3xl ${item.has_alerts ? 'border-amber-200' : 'border-slate-200'}`}>
      {/* Product header */}
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50/60"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <ReportExpandIcon open={open} />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="text-sm font-semibold text-slate-900 hover:text-primary hover:underline"
              onClick={(e) => { e.stopPropagation(); navigate(`/products/${item.product_id}`); }}
            >
              {item.product_name}
            </button>
            {item.has_alerts && (
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-amber-500" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
              </svg>
            )}
          </div>
        </div>

        {/* Summary columns */}
        <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-right">
          {stockBefore != null && (
            <div>
              <p className="text-[11px] text-slate-400">Na pocz.</p>
              <p className="text-sm font-semibold tabular-nums text-slate-600">{fmtQty(stockBefore, unit)}</p>
            </div>
          )}
          <div>
            <p className="text-[11px] text-slate-400">Wyprod.</p>
            <p className="text-sm font-semibold tabular-nums text-slate-800">{fmtQty(item.qty_produced, unit)}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">Wydano</p>
            <p className="text-sm font-semibold tabular-nums text-slate-800">{fmtQty(item.qty_delivered, unit)}</p>
          </div>
          {qtyInvoiced > 0 && (
            <div>
              <p className="text-[11px] text-slate-400">Zafakt.</p>
              <p className="text-sm font-semibold tabular-nums text-slate-800">{fmtQty(qtyInvoiced, unit)}</p>
            </div>
          )}
          {stockAvail != null && (
            <div>
              <p className="text-[11px] text-slate-400">Na koniec</p>
              <p className="text-sm font-semibold tabular-nums text-slate-800">
                {fmtQty(item.stock_available, unit)}
              </p>
            </div>
          )}
        </div>
      </button>

      {/* Expanded table */}
      {open && (
        <div className="border-t border-slate-200">
          {item.production_runs.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Brak zleceń produkcji w tym okresie.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] divide-x-0 text-left [&_td]:border-r [&_td]:border-slate-100 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-slate-100 [&_th:last-child]:border-r-0">
                {/* Column headers */}
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="py-2 pl-4 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">ZAM</th>
                    <th className="py-2 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Klient</th>
                    <th className="py-2 pl-3 pr-4 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Zamówiono</th>
                    <th className="py-2 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">PRD</th>
                    <th className="py-2 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">RW</th>
                    <th className="py-2 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">PW</th>
                    <th className="py-2 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">WZ</th>
                    <th className="py-2 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">FV</th>
                  </tr>

                </thead>
                <tbody>
                  {rows.map((row, i) =>
                    row.type === 'zapas' ? (
                      <NaZapasRow key={`zapas-${row.run.id}`} run={row.run} unit={unit} />
                    ) : (
                      <FlowRow
                        key={`${row.run.id}-${row.so.order_id}-${i}`}
                        so={row.so}
                        run={row.run}
                        unit={unit}
                        showPrd={row.showPrd}
                        prdRowCount={row.prdRowCount}
                      />
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Balance footer */}
          <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
              {stockBefore != null && (
                <>
                  <span className="font-medium text-slate-600">{fmtQty(stockBefore, unit)}</span>
                  <span className="text-slate-300">stan pocz.</span>
                  <span className="mx-0.5 text-slate-300">+</span>
                </>
              )}
              <span className="font-medium text-slate-600">{fmtQty(item.qty_produced, unit)}</span>
              <span className="text-slate-300">wyprod.</span>
              <span className="mx-0.5 text-slate-300">−</span>
              <span className="font-medium text-slate-600">{fmtQty(item.qty_delivered, unit)}</span>
              <span className="text-slate-300">wydano</span>
              <span className="mx-0.5 text-slate-300">=</span>
              <span className={`font-semibold ${balanceMismatch ? 'text-red-600' : 'text-emerald-700'}`}>
                {stockBefore != null
                  ? fmtQty(stockBefore + calcBalance, unit)
                  : fmtQty(calcBalance, unit)}
              </span>
              <span className="text-slate-300">na koniec</span>
              {balanceMismatch && (
                <span className="ml-1 font-semibold text-red-500">← wydano więcej niż wyprodukowano!</span>
              )}
              {stockAvail != null && stockBefore != null && (
                <span className={`ml-2 text-xs ${Math.abs((stockBefore + calcBalance) - stockAvail) > 0.01 ? 'text-amber-600' : 'text-slate-400'}`}>
                  (mag.: {fmtQty(item.stock_available, unit)}{Math.abs((stockBefore + calcBalance) - stockAvail) > 0.01 ? ' ⚠️' : ' ✓'})
                </span>
              )}
              {hasCost && (
                <>
                  <span className="mx-2 text-slate-200">|</span>
                  <span className="text-slate-300">koszt produkcji:</span>
                  <span className="font-semibold text-slate-600">
                    {totalCost.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł
                  </span>
                  {qtyProduced > 0 && (
                    <span className="text-slate-400">
                      ({(totalCost / qtyProduced).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł/{unit})
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unscheduled orders — visible when expanded */}
      {open && unscheduled.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/40 px-4 py-2.5 md:px-6">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            </svg>
            Zamówienia bez zlecenia produkcji ({unscheduled.length})
          </p>
          <div className="divide-y divide-amber-100">
            {unscheduled.map((o) => (
              <div key={o.order_id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${o.order_id}`)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {o.order_number || '—'}
                  </button>
                  <span className="text-xs text-slate-500">{o.customer_name}</span>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <span className="text-xs tabular-nums text-slate-700">{fmtQty(o.qty, unit)}</span>
                  {o.delivery_date && (
                    <span className={`text-xs ${o.is_overdue ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
                      {o.is_overdue ? '⚠ ' : ''}{formatReportDate(o.delivery_date)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

type Preset = 'week' | 'month' | 'quarter' | 'custom';

function getPresetRange(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (preset === 'week') {
    const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // Monday=0
    const mon = new Date(now); mon.setDate(now.getDate() - day);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: isoDate(mon.getFullYear(), mon.getMonth(), mon.getDate()), to: isoDate(sun.getFullYear(), sun.getMonth(), sun.getDate()) };
  }
  if (preset === 'month') {
    return { from: startOfMonth(now), to: endOfMonth(now) };
  }
  if (preset === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const qStart = new Date(now.getFullYear(), q * 3, 1);
    const qEnd = new Date(now.getFullYear(), q * 3 + 3, 0);
    return { from: startOfMonth(qStart), to: isoDate(qEnd.getFullYear(), qEnd.getMonth(), qEnd.getDate()) };
  }
  return { from: customFrom, to: customTo };
}

export default function ProductionFlowReportPage() {
  const now = new Date();
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState(() => startOfMonth(now));
  const [customTo, setCustomTo] = useState(() => endOfMonth(now));

  const { from: dateFrom, to: dateTo } = getPresetRange(preset, customFrom, customTo);
  const { data, isLoading, isError } = useProductionFlowQuery({ date_from: dateFrom, date_to: dateTo });

  const items: ProductFlowItem[] = Array.isArray(data) ? data : [];
  const alertCount = items.filter((i) => i.has_alerts).length;

  const presets: { key: Preset; label: string }[] = [
    { key: 'week', label: 'Ten tydzień' },
    { key: 'month', label: 'Ten miesiąc' },
    { key: 'quarter', label: 'Ten kwartał' },
    { key: 'custom', label: 'Własny zakres' },
  ];

  return (
    <ReportShell>
      <div>
        <h1 className={reportTitleClass}>Raport produkcji</h1>
        <p className="mt-1 text-xs text-slate-500">
          Zlecenia produkcji per produkt gotowy — od zamówienia (ZAM) przez produkcję (PRD/RW/PW) po wydanie (WZ) i fakturę (FV).
        </p>
        <div className="mt-2 flex items-center gap-4">
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            PRD zakończone
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            PRD w toku
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-amber-500" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            </svg>
            braki w dokumentach
          </span>
        </div>
      </div>

      {/* Date range navigator */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                preset === p.key
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          {alertCount > 0 && (
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              <svg viewBox="0 0 24 24" fill="none" className="mr-1 inline h-3.5 w-3.5" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
              </svg>
              {alertCount}
            </span>
          )}
        </div>
        {preset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Od</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="field-ios-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Do</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="field-ios-sm"
              />
            </div>
          </div>
        )}
        {preset !== 'custom' && (
          <p className="mt-1.5 text-[11px] text-slate-400">{dateFrom} – {dateTo}</p>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          Ładowanie…
        </div>
      )}
      {isError && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-red-500">
          Błąd ładowania danych.
        </div>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          Brak zleceń produkcji w wybranym okresie.
        </div>
      )}
      {!isLoading && !isError && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ProductCard key={item.product_id} item={item} />
          ))}
        </div>
      )}
    </ReportShell>
  );
}

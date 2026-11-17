/**
 * MaterialConsumptionPage — raport zużycia surowców w wybranym miesiącu.
 * Route: /reports/material-consumption
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMaterialConsumptionQuery } from '@/query/use-reports';
import {
  ReportShell,
  reportTitleClass,
  reportThClass,
  reportRowClass,
  reportTableClass,
  reportTdClass,
  reportTdMutedClass,
  reportTdMoneyClass,
  ReportExpandIcon,
} from '@/lib/reportSurface';
import type { MaterialConsumptionRow, MaterialMovementDetail } from '@/types/reporting.types';

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
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

/* ── Formatters ───────────────────────────────────────────────────── */

function fmtQty(value: string | number | null | undefined, unit: string): string {
  if (value == null) return '—';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return '—';
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(3)} ${unit}`;
}
function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

/* ── Movement detail expand ───────────────────────────────────────── */

const REF_ROUTE: Record<string, string> = {
  delivery_document: '/delivery',
  delivery: '/delivery',
  pz_cancellation: '/delivery',
  pz_correction: '/delivery',
  rw_writeoff: '/delivery',
  wz_correction: '/delivery',
  delivery_return: '/delivery',
  delivery_correction: '/delivery',
  production_order: '/production/orders',
};

function MovementTable({
  movements,
  unit,
  sign,
}: {
  movements: MaterialMovementDetail[];
  unit: string;
  sign: 'positive' | 'negative';
}) {
  const navigate = useNavigate();
  const filtered = movements.filter((m) =>
    sign === 'positive' ? parseFloat(m.qty) > 0 : parseFloat(m.qty) < 0,
  );
  if (filtered.length === 0) return <p className="text-xs text-slate-400">Brak</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
          <th className="pb-1 pr-3 font-medium">Data</th>
          <th className="pb-1 pr-3 font-medium">Dokument</th>
          <th className="pb-1 text-right font-medium">Ilość</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((m, i) => {
          const route = m.reference_id && REF_ROUTE[m.reference_type ?? ''];
          const docLabel = m.doc_number
            ? `${m.doc_label} ${m.doc_number}`
            : m.doc_label || (m.reference_type ?? 'Ruch');
          const qty = Math.abs(parseFloat(m.qty));
          return (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1 pr-3 text-slate-500">{fmtDate(m.date)}</td>
              <td className="py-1 pr-3">
                <div>
                  {route ? (
                    <button
                      type="button"
                      onClick={() => navigate(`${route}/${m.reference_id}`)}
                      className="font-medium text-primary hover:underline"
                    >
                      {docLabel}
                    </button>
                  ) : (
                    <span className="font-medium text-slate-700">{docLabel}</span>
                  )}
                  {m.counterparty && (
                    <span className="ml-1.5 text-slate-400">{m.counterparty}</span>
                  )}
                </div>
                {m.notes ? <div className="text-slate-400">{m.notes}</div> : null}
              </td>
              <td className={`py-1 text-right font-semibold tabular-nums ${sign === 'positive' ? 'text-emerald-700' : 'text-orange-700'}`}>
                {sign === 'positive' ? '+' : '−'}{fmtQty(qty, unit)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Row with expand ──────────────────────────────────────────────── */

function ConsumptionRow({ row }: { row: MaterialConsumptionRow }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const consumed = toNum(row.consumed);
  const purchased = toNum(row.purchased);
  const stockAfter = toNum(row.stock_after);
  const lowStock = stockAfter <= 0;
  const hasMovements = row.movements && row.movements.length > 0;

  return (
    <>
      <tr
        className={`${reportRowClass} cursor-pointer select-none`}
        onClick={() => hasMovements && setOpen((o) => !o)}
      >
        <td className={reportTdClass}>
          <div className="flex items-center gap-2">
            {hasMovements && (
              <ReportExpandIcon open={open} />
            )}
            <span
              className="font-medium text-slate-900 hover:text-primary hover:underline"
              onClick={(e) => { e.stopPropagation(); navigate(`/products/${row.product_id}`); }}
            >
              {row.product_name}
            </span>
          </div>
        </td>
        <td className={reportTdMutedClass + ' text-right'}>
          {fmtQty(row.stock_before, row.unit)}
        </td>
        <td className={reportTdMutedClass + ' text-right'}>
          {purchased > 0
            ? <span className="font-semibold text-emerald-700">+{fmtQty(row.purchased, row.unit)}</span>
            : <span className="text-slate-300">—</span>
          }
        </td>
        <td className={reportTdMutedClass + ' text-right'}>
          {consumed > 0
            ? <span className="font-semibold text-orange-700">−{fmtQty(row.consumed, row.unit)}</span>
            : <span className="text-slate-300">—</span>
          }
        </td>
        <td className={reportTdMoneyClass}>
          <span className={lowStock ? 'text-red-600' : undefined}>
            {fmtQty(row.stock_after, row.unit)}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate('/purchase-orders', {
                state: { prefillProductId: row.product_id, prefillProductName: row.product_name },
              });
            }}
            className="rounded-lg border border-primary/40 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/5"
          >
            Zamów
          </button>
        </td>
      </tr>
      {open && hasMovements && (
        <tr className="bg-slate-50/70">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Przyjęcia
                </p>
                <MovementTable movements={row.movements} unit={row.unit} sign="positive" />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-orange-700">
                  Zużycie
                </p>
                <MovementTable movements={row.movements} unit={row.unit} sign="negative" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function MaterialConsumptionPage() {
  const [monthDate, setMonthDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const dateFrom = startOfMonth(monthDate);
  const dateTo = endOfMonth(monthDate);
  const { data, isLoading, isError } = useMaterialConsumptionQuery(dateFrom, dateTo);

  function prevMonth() {
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    const next = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
    const now = new Date();
    if (next <= new Date(now.getFullYear(), now.getMonth(), 1)) setMonthDate(next);
  }
  const isCurrentMonth = (() => {
    const now = new Date();
    return monthDate.getFullYear() === now.getFullYear() && monthDate.getMonth() === now.getMonth();
  })();

  const rows: MaterialConsumptionRow[] = Array.isArray(data) ? data : [];

  return (
    <ReportShell>
      <div>
        <h1 className={reportTitleClass}>Zużycie surowców</h1>
        <p className="mt-1 text-xs text-slate-500">
          Stan na początek i koniec okresu, przyjęcia i zużycie surowców. Kliknij wiersz, aby zobaczyć dokumenty.
        </p>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <button type="button" onClick={prevMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
          aria-label="Poprzedni miesiąc">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="min-w-[12rem] text-center text-sm font-semibold capitalize text-slate-900">
          {fmtMonthLabel(monthDate)}
        </span>
        <button type="button" onClick={nextMonth} disabled={isCurrentMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
          aria-label="Następny miesiąc">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <span className="ml-auto text-xs text-slate-400">{dateFrom} – {dateTo}</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        {isLoading && <div className="px-4 py-8 text-center text-sm text-slate-400">Ładowanie…</div>}
        {isError && <div className="px-4 py-8 text-center text-sm text-red-500">Błąd ładowania danych.</div>}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">Brak ruchów surowców w tym miesiącu.</div>
        )}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={reportTableClass}>
              <thead>
                <tr>
                  <th className={reportThClass + ' text-left'}>Surowiec</th>
                  <th className={reportThClass + ' text-right'}>Stan na start</th>
                  <th className={reportThClass + ' text-right'}>Przyjęto</th>
                  <th className={reportThClass + ' text-right'}>Zużyto</th>
                  <th className={reportThClass + ' text-right'}>Stan na koniec</th>
                  <th className={reportThClass}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <ConsumptionRow key={row.product_id} row={row} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportShell>
  );
}

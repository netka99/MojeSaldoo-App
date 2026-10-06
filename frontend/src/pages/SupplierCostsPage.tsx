import React, { useState } from 'react';
import { format, subMonths, startOfMonth, startOfYear, endOfYear, subYears } from 'date-fns';
import { Link, Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useSupplierCostsQuery, useSupplierCostsDetailQuery } from '@/query/use-reports';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { RyczaltManagerialNotice } from '@/components/reports/RyczaltManagerialNotice';
import { ReportExpandIcon, ReportShell, reportButtonClass, reportCardClass, reportLabelClass, reportPresetClass, reportRowClass, reportSectionTitleClass, reportTdMoneyClass, reportThClass, reportTitleClass } from '@/lib/reportSurface';
import type { SupplierCostsRow } from '@/types/reporting.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

const inputClass = 'date-pill';

type Preset = { label: string; from: string; to: string };

function getPresets(): Preset[] {
  const now = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  return [
    { label: '3 mies.', from: fmt(startOfMonth(subMonths(now, 2))), to: fmt(now) },
    { label: '6 mies.', from: fmt(startOfMonth(subMonths(now, 5))), to: fmt(now) },
    { label: '12 mies.', from: fmt(startOfMonth(subMonths(now, 11))), to: fmt(now) },
    { label: 'Ten rok', from: fmt(startOfYear(now)), to: fmt(now) },
    { label: 'Poprzedni rok', from: fmt(startOfYear(subYears(now, 1))), to: fmt(endOfYear(subYears(now, 1))) },
  ];
}

function defaultDates() {
  const now = new Date();
  return {
    from: format(startOfYear(now), 'yyyy-MM-dd'),
    to: format(now, 'yyyy-MM-dd'),
  };
}

/** Format month label: "2026-03" → "mar 2026" */
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return format(d, 'MMM yyyy');
}

/** Compute % of row total vs grand total */
function barWidth(value: number, max: number): string {
  if (max === 0) return '0%';
  return `${Math.min(100, (value / max) * 100).toFixed(1)}%`;
}

/** Export to CSV */
function exportCsv(months: string[], suppliers: SupplierCostsRow[]) {
  const header = ['Dostawca', ...months, 'Razem'];
  const lines = suppliers.map((s) => [
    s.supplier_name,
    ...months.map((m) => {
      const v = s.monthly[m];
      return v != null ? (typeof v === 'string' ? v : String(v)) : '0';
    }),
    typeof s.total === 'string' ? s.total : String(s.total),
  ]);
  const csv = [header, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `koszty-zakupow-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SupplierDrillDown({
  supplierId,
  dateFrom,
  dateTo,
}: {
  supplierId: string | null;
  dateFrom: string;
  dateTo: string;
}) {
  const { data, isLoading } = useSupplierCostsDetailQuery(supplierId, dateFrom, dateTo);

  if (isLoading) return <p className="px-4 py-3 text-xs text-muted-foreground">Ładowanie…</p>;
  if (!data) return null;

  return (
    <div className="px-4 pb-3 pt-2">
      <p className="mb-1.5 text-sm font-semibold text-orange-700">
        Dokumenty PZ ({data.documents.length})
      </p>
      {data.documents.length === 0 && (
        <p className="text-xs text-muted-foreground">Brak PZ w wybranym okresie.</p>
      )}
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {data.documents.map((doc) => (
          <div key={doc.pz_id} className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs">
            <div className="flex items-center justify-between">
              <Link to={`/delivery/${doc.pz_id}`} className="font-medium text-orange-700 hover:underline">
                {doc.document_number || doc.pz_id.slice(0, 8)}
              </Link>
              <span className="ml-2 shrink-0 font-medium text-orange-700">{formatMoney(doc.total_cost)}</span>
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {doc.issue_date} · {doc.item_count} poz.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SupplierCostsPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const defaults = defaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  const { data, isLoading, isError } = useSupplierCostsQuery(dateFrom, dateTo);

  const presets = getPresets();

  function applyPreset(p: Preset) {
    setDateFrom(p.from);
    setDateTo(p.to);
    setExpandedSupplier(null);
  }

  function toggleSupplier(sid: string | null) {
    const key = sid ?? '__unknown__';
    setExpandedSupplier((prev) => (prev === key ? null : key));
  }

  const maxTotal = data
    ? Math.max(...data.suppliers.map((s) => Number.parseFloat(String(s.total)) || 0))
    : 0;

  return (
    <ReportShell>
      <div className="flex items-center justify-between gap-3">
        <h1 className={reportTitleClass}>Koszty zakupów per dostawca</h1>
        {data && data.suppliers.length > 0 && (
          <button
            type="button"
            onClick={() => exportCsv(data.months, data.suppliers)}
            className={reportButtonClass}
          >
            Eksport CSV
          </button>
        )}
      </div>

      <RyczaltManagerialNotice />

      {/* Filters */}
      <Card className={reportCardClass}>
        <CardContent className="pt-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  reportPresetClass,
                  dateFrom === p.from && dateTo === p.to
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className={reportLabelClass}>Od</label>
              <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={reportLabelClass}>Do</label>
              <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly breakdown table */}
      <Card className={reportCardClass}>
        <CardHeader>
          <CardTitle className={reportSectionTitleClass}>
            Zestawienie miesięczne
            {data && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {data.suppliers.length} dostawców · {data.months.length} miesięcy
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {isError && <p className="p-4 text-sm text-destructive">Błąd ładowania danych.</p>}
          {!isLoading && !isError && data && (
            <div className="overflow-x-auto">
              {data.suppliers.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Brak zaksięgowanych PZ w wybranym okresie.
                </p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="w-8 border-b border-slate-200 bg-white px-2 py-3" />
                      <th className={reportThClass}>
                        Dostawca
                      </th>
                      {data.months.map((m) => (
                        <th key={m} className={cn(reportThClass, 'text-right')}>
                          {fmtMonth(m)}
                        </th>
                      ))}
                      <th className={cn(reportThClass, 'text-right')}>
                        Razem
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suppliers.map((supplier) => {
                      const total = Number.parseFloat(String(supplier.total)) || 0;
                      const key = supplier.supplier_id ?? '__unknown__';
                      const isExpanded = expandedSupplier === key;
                      return (
                        <React.Fragment key={key}>
                          <tr
                            className={cn(reportRowClass, 'cursor-pointer', isExpanded && 'bg-slate-50')}
                            onClick={() => toggleSupplier(supplier.supplier_id)}
                          >
                            <td className="w-8 px-2 py-3">
                              <ReportExpandIcon open={isExpanded} />
                            </td>
                            <td className="px-3 py-3">
                              <div>
                                  <div className="text-sm font-normal text-slate-600">{supplier.supplier_name}</div>
                                  <div
                                    className="mt-1 h-1.5 rounded-full bg-orange-200"
                                    style={{ width: barWidth(total, maxTotal) }}
                                  />
                                </div>
                            </td>
                            {data.months.map((m) => {
                              const v = supplier.monthly[m];
                              const n = v != null ? Number.parseFloat(String(v)) : 0;
                              return (
                                <td key={m} className={reportTdMoneyClass}>
                                  {n > 0 ? formatMoney(n) : '—'}
                                </td>
                              );
                            })}
                            <td className={reportTdMoneyClass}>
                              {formatMoney(total)}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={data.months.length + 3} className="border-b border-slate-100 bg-slate-50 p-0">
                                <SupplierDrillDown
                                  supplierId={supplier.supplier_id}
                                  dateFrom={dateFrom}
                                  dateTo={dateTo}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {/* Grand total row */}
                    <tr className="bg-muted/30">
                      <td className="px-3 py-2 font-semibold">Łącznie</td>
                      {data.months.map((m) => {
                        const monthTotal = data.suppliers.reduce((sum, s) => {
                          const v = s.monthly[m];
                          return sum + (v != null ? Number.parseFloat(String(v)) : 0);
                        }, 0);
                        return (
                          <td key={m} className="px-3 py-2 text-right tabular-nums font-medium">
                            {monthTotal > 0 ? formatMoney(monthTotal) : '—'}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-orange-700">
                        {formatMoney(data.suppliers.reduce((s, r) => s + (Number.parseFloat(String(r.total)) || 0), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  );
}

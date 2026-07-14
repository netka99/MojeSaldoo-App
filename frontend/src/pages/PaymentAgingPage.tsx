import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { usePaymentAgingQuery } from '@/query/use-reports';
import { useInvoiceQuery, useMarkPaidInvoiceMutation } from '@/query/use-invoices';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { PaymentAgingRow } from '@/types/reporting.types';
import { useQueryClient } from '@tanstack/react-query';
import { reportKeys } from '@/query/keys';
import { useAuth } from '@/context/AuthContext';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const qty4 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function formatQty(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isNaN(n) ? '—' : qty4.format(n);
}

const BUCKET_LABELS: Record<string, string> = {
  current: 'Bieżące',
  '1_30': '1–30 dni',
  '31_60': '31–60 dni',
  '61_90': '61–90 dni',
  over_90: 'Ponad 90 dni',
};

const BUCKET_COLOR: Record<string, string> = {
  current: 'text-green-700 bg-green-50 border-green-200',
  '1_30': 'text-yellow-700 bg-yellow-50 border-yellow-200',
  '31_60': 'text-orange-700 bg-orange-50 border-orange-200',
  '61_90': 'text-red-700 bg-red-50 border-red-200',
  over_90: 'text-red-900 bg-red-100 border-red-300 font-semibold',
};

const BUCKET_ROW_BG: Record<string, string> = {
  current: '',
  '1_30': 'bg-yellow-50/40',
  '31_60': 'bg-orange-50/40',
  '61_90': 'bg-red-50/40',
  over_90: 'bg-red-100/50',
};

const STATUS_PL: Record<string, string> = {
  draft: 'Szkic', issued: 'Wystawiona', sent: 'Wysłana',
  overdue: 'Przeterminowana', cancelled: 'Anulowana', paid: 'Zapłacona',
};

function exportCsv(rows: PaymentAgingRow[]) {
  const header = ['Faktura', 'Klient', 'Data wystawienia', 'Termin płatności', 'Dni po terminie', 'Bucket', 'Kwota brutto', 'Status'];
  const lines = rows.map((r) => [
    r.invoice_number,
    r.customer_name,
    r.issue_date ?? '',
    r.due_date ?? '',
    String(r.days_overdue),
    BUCKET_LABELS[r.bucket] ?? r.bucket,
    typeof r.total_gross === 'string' ? r.total_gross : String(r.total_gross),
    STATUS_PL[r.status] ?? r.status,
  ]);
  const csv = [header, ...lines].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aging-naleznosci-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function InvoiceDrillDown({
  invoiceId,
  onMarkPaid,
  isPaying,
}: {
  invoiceId: string;
  onMarkPaid: () => void;
  isPaying: boolean;
}) {
  const { data: invoice, isLoading } = useInvoiceQuery(invoiceId);

  if (isLoading) return <p className="mx-8 max-w-full py-3 text-xs text-muted-foreground">Ładowanie pozycji…</p>;
  if (!invoice) return null;

  return (
    <div className="mx-8 max-w-full pb-4 pt-3">
      <div className="mb-2 flex items-center justify-between gap-4">
        <p className="text-xs font-semibold text-blue-700">
          Pozycje faktury ({invoice.items.length})
        </p>
        <button
          type="button"
          disabled={isPaying}
          onClick={onMarkPaid}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            isPaying
              ? 'cursor-not-allowed bg-muted text-muted-foreground'
              : 'bg-green-600 text-white hover:bg-green-700',
          )}
        >
          {isPaying ? 'Zapisywanie…' : '✓ Oznacz jako zapłacona'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[32%]" />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              {(['Produkt', 'Ilość', 'J.m.', 'Cena netto', 'VAT %', 'Wartość brutto'] as const).map((h) => (
                <th
                  key={h}
                  className={cn(
                    'border-b bg-blue-50 px-4 py-2 text-left font-medium text-blue-700',
                    h === 'Produkt' ? 'whitespace-normal' : 'whitespace-nowrap',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="hover:bg-blue-50/40">
                <td
                  className="min-w-0 border-b px-4 py-2 text-left font-medium whitespace-normal break-words"
                  title={item.product_name}
                >
                  {item.product_name}
                </td>
                <td className="border-b px-4 py-2 text-left tabular-nums whitespace-nowrap">{formatQty(item.quantity)}</td>
                <td className="border-b px-4 py-2 text-left text-muted-foreground whitespace-nowrap">{item.product_unit}</td>
                <td className="border-b px-4 py-2 text-left tabular-nums whitespace-nowrap">{formatMoney(item.unit_price_net)}</td>
                <td className="border-b px-4 py-2 text-left tabular-nums text-muted-foreground whitespace-nowrap">
                  {Number.parseFloat(String(item.vat_rate)).toFixed(0)}%
                </td>
                <td className="border-b px-4 py-2 text-left tabular-nums font-medium text-blue-700 whitespace-nowrap">
                  {formatMoney(item.line_gross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PaymentAgingPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = usePaymentAgingQuery();
  const markPaidMutation = useMarkPaidInvoiceMutation();
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);

  const bucketOrder = ['current', '1_30', '31_60', '61_90', 'over_90'] as const;
  const total = data ? Number.parseFloat(String(data.total_outstanding)) || 0 : 0;

  function toggleInvoice(id: string) {
    setExpandedInvoice((prev) => (prev === id ? null : id));
  }

  function handleMarkPaid(invoiceId: string) {
    markPaidMutation.mutate(invoiceId, {
      onSuccess: () => {
        setExpandedInvoice(null);
        void queryClient.invalidateQueries({ queryKey: reportKeys.paymentAging(companyId) });
      },
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Niezapłacone faktury</h1>
        {data && data.rows.length > 0 && (
          <button
            type="button"
            onClick={() => exportCsv(data.rows)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Eksport CSV
          </button>
        )}
      </div>

      {/* Bucket summary cards */}
      {!isLoading && !isError && data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {bucketOrder.map((b) => {
            const amount = Number.parseFloat(String(data.buckets[b])) || 0;
            const count = data.rows.filter((r) => r.bucket === b).length;
            return (
              <div key={b} className={cn('rounded-lg border px-3 py-2.5', BUCKET_COLOR[b])}>
                <p className="text-xs font-medium">{BUCKET_LABELS[b]}</p>
                <p className="mt-1 text-base font-semibold tabular-nums">{formatMoney(amount)}</p>
                <p className="text-xs opacity-70">{count} faktur</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Total outstanding */}
      {!isLoading && !isError && data && total > 0 && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-2.5 text-sm">
          Łączne należności: <span className="font-semibold">{formatMoney(total)}</span>
          <span className="ml-2 text-muted-foreground">na dzień {data.as_of}</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Niezapłacone faktury
            {data && <span className="ml-2 text-xs font-normal text-muted-foreground">({data.rows.length})</span>}
            <span className="ml-2 text-xs font-normal text-muted-foreground">— kliknij wiersz, aby zobaczyć pozycje i oznaczyć jako zapłaconą</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {isError && <p className="p-4 text-sm text-destructive">Błąd ładowania danych.</p>}
          {!isLoading && !isError && data && (
            <div className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Brak niezapłaconych faktur. Wszystkie należności uregulowane.
                </p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="w-6 border-b bg-muted/50 px-3 py-2" />
                      {(['Faktura', 'Klient', 'Data wystawienia', 'Termin płatności', 'Dni po terminie'] as const).map((h) => (
                        <th key={h} className="border-b bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                      <th className="border-b bg-muted/50 px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Kwota brutto</th>
                      <th className="border-b bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => {
                      const isExpanded = expandedInvoice === row.invoice_id;
                      return (
                        <React.Fragment key={row.invoice_id}>
                          <tr
                            className={cn('cursor-pointer hover:bg-muted/30', BUCKET_ROW_BG[row.bucket], isExpanded && 'bg-muted/20')}
                            onClick={() => toggleInvoice(row.invoice_id)}
                          >
                            <td className="border-b px-3 py-2 text-muted-foreground">
                              <svg
                                className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                              >
                                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </td>
                            <td className="border-b px-3 py-2">
                              <Link
                                to={`/invoices/${row.invoice_id}`}
                                className="font-medium text-blue-700 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {row.invoice_number || row.invoice_id.slice(0, 8)}
                              </Link>
                            </td>
                            <td className="border-b px-3 py-2">{row.customer_name || '—'}</td>
                            <td className="border-b px-3 py-2 tabular-nums text-muted-foreground">{row.issue_date ?? '—'}</td>
                            <td className="border-b px-3 py-2 tabular-nums text-muted-foreground">{row.due_date ?? '—'}</td>
                            <td className="border-b px-3 py-2 tabular-nums">
                              <span className={cn(
                                'rounded px-1.5 py-0.5 text-xs font-medium',
                                row.days_overdue <= 0 ? 'bg-green-100 text-green-700' :
                                row.days_overdue <= 30 ? 'bg-yellow-100 text-yellow-700' :
                                row.days_overdue <= 60 ? 'bg-orange-100 text-orange-700' :
                                'bg-red-100 text-red-700'
                              )}>
                                {row.days_overdue <= 0 ? `za ${Math.abs(row.days_overdue)} dni` : `${row.days_overdue} dni`}
                              </span>
                            </td>
                            <td className="border-b px-3 py-2 text-right tabular-nums font-medium">
                              {formatMoney(row.total_gross)}
                            </td>
                            <td className="border-b px-3 py-2 text-muted-foreground">
                              {STATUS_PL[row.status] ?? row.status}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="border-b bg-blue-50/30 p-0">
                                <InvoiceDrillDown
                                  invoiceId={row.invoice_id}
                                  onMarkPaid={() => handleMarkPaid(row.invoice_id)}
                                  isPaying={markPaidMutation.isPending && markPaidMutation.variables === row.invoice_id}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

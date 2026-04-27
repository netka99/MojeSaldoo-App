import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { INVOICE_KSEF_STATUS_LABELS_PL } from '@/constants/invoiceKsefStatusPl';
import { INVOICE_STATUS_LABELS_PL } from '@/constants/invoiceStatusPl';
import {
  useInvoicePreviewQuery,
  useInvoiceQuery,
  useIssueInvoiceMutation,
  useMarkPaidInvoiceMutation,
} from '@/query/use-invoices';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { invoiceKsefStatusBadgeClassName, invoiceStatusBadgeClassName } from './InvoicesPage';
import type { InvoicePreviewLine } from '@/types';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatPreviewDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Wystąpił błąd';
}

function AddressBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-2 space-y-0.5 text-sm">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          lines.map((line) => (
            <p key={line} className="text-foreground">
              {line}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const enabled = Boolean(id);

  const {
    data: invoice,
    isLoading: invLoading,
    isError: invError,
    error: invErr,
    refetch: refetchInvoice,
    isFetching: invFetching,
  } = useInvoiceQuery(id, enabled);

  const {
    data: preview,
    isLoading: prevLoading,
    isError: prevError,
    error: prevErr,
    refetch: refetchPreview,
    isFetching: prevFetching,
  } = useInvoicePreviewQuery(id, enabled);

  const issueM = useIssueInvoiceMutation();
  const markPaidM = useMarkPaidInvoiceMutation();
  const [actionError, setActionError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) {
    return <Navigate to="/invoices" replace />;
  }

  const loading = invLoading || prevLoading;
  const fetching = invFetching || prevFetching;
  const loadError = invError || prevError;
  const loadErrMsg = invError ? errMsg(invErr) : prevError ? errMsg(prevErr) : '';

  const refetchAll = () => {
    void refetchInvoice();
    void refetchPreview();
  };

  const onIssue = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await issueM.mutateAsync(id);
      refetchAll();
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  const onMarkPaid = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await markPaidM.mutateAsync(id);
      refetchAll();
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  const showIssue = invoice?.status === 'draft';
  const showMarkPaid = invoice?.status === 'issued' || invoice?.status === 'sent';
  const numberLabel = invoice?.invoice_number ?? preview?.invoice.invoice_number ?? id.slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/invoices')}>
          ← Lista faktur
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {invoice && (
            <>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  invoiceStatusBadgeClassName(invoice.status),
                )}
              >
                {INVOICE_STATUS_LABELS_PL[invoice.status]}
              </span>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  invoiceKsefStatusBadgeClassName(invoice.ksef_status),
                )}
              >
                KSeF: {INVOICE_KSEF_STATUS_LABELS_PL[invoice.ksef_status]}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Faktura {numberLabel}</h1>
          {invoice && preview?.invoice.order_number ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Zamówienie:{' '}
              <Link
                to={`/orders/${invoice.order.id}`}
                className="font-medium text-primary hover:underline"
              >
                {preview.invoice.order_number}
              </Link>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {showIssue && (
              <Button
                type="button"
                onClick={() => void onIssue()}
                disabled={issueM.isPending || fetching}
              >
                {issueM.isPending ? 'Wystawianie…' : 'Wystaw'}
              </Button>
            )}
            {showMarkPaid && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void onMarkPaid()}
                disabled={markPaidM.isPending || fetching}
              >
                {markPaidM.isPending ? 'Zapisywanie…' : 'Oznacz jako opłaconą'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled
              title="Wysyłka do KSeF będzie dostępna w fazie 7."
            >
              Wyślij do KSeF
            </Button>
          </div>
          {actionError && (
            <p className="max-w-md text-right text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Ładowanie…</p>}

      {loadError && !loading && (
        <div
          className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-destructive">{loadErrMsg}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetchAll()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {!loading && !loadError && preview && (
        <>
          <Card className="shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base">Dane faktury</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
              <div className="text-sm">
                <p>
                  <span className="text-muted-foreground">Data wystawienia: </span>
                  {formatPreviewDate(preview.invoice.issue_date)}
                </p>
                <p>
                  <span className="text-muted-foreground">Data sprzedaży: </span>
                  {formatPreviewDate(preview.invoice.sale_date)}
                </p>
                <p>
                  <span className="text-muted-foreground">Termin płatności: </span>
                  {formatPreviewDate(preview.invoice.due_date)}
                </p>
                <p>
                  <span className="text-muted-foreground">Forma płatności: </span>
                  {preview.invoice.payment_method_label}
                </p>
                {preview.invoice.delivery_document_number ? (
                  <p>
                    <span className="text-muted-foreground">WZ: </span>
                    {preview.invoice.delivery_document_number}
                  </p>
                ) : null}
              </div>
              {preview.invoice.notes ? (
                <div className="text-sm">
                  <p className="text-muted-foreground">Uwagi</p>
                  <p className="mt-1 whitespace-pre-wrap">{preview.invoice.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <AddressBlock title="Sprzedawca" lines={preview.seller.address_lines} />
            <AddressBlock title="Nabywca" lines={preview.buyer.address_lines} />
          </div>

          <Card className="shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base">Pozycje</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border text-sm" aria-label="Pozycje faktury">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Lp.</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nazwa</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">J.m.</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Ilość</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cena netto</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">VAT %</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Netto</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">VAT</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Brutto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {preview.lines.map((line: InvoicePreviewLine) => (
                      <tr key={line.position}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{line.position}</td>
                        <td className="max-w-[200px] px-3 py-2">
                          <span className="font-medium">{line.product_name}</span>
                          {line.pkwiu ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              PKWiU: {line.pkwiu}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {line.product_unit || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {line.quantity_display}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {line.unit_price_net}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {line.vat_rate_display}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.line_net}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.line_vat}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                          {line.line_gross}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.lines.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Brak pozycji na fakturze.</p>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-end gap-2 pt-6 text-sm">
              <p>
                <span className="text-muted-foreground">Razem netto: </span>
                <span className="font-medium tabular-nums">{preview.totals.subtotal_net} PLN</span>
              </p>
              <p>
                <span className="text-muted-foreground">VAT: </span>
                <span className="font-medium tabular-nums">{preview.totals.vat_amount} PLN</span>
              </p>
              <p className="text-base">
                <span className="text-muted-foreground">Razem brutto: </span>
                <span className="font-semibold tabular-nums">{preview.totals.total_gross} PLN</span>
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

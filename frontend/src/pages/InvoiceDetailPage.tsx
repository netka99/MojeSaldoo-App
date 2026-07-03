import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { KsefPassphraseModal } from '@/components/features/invoicing/KsefPassphraseModal';
import { INVOICE_KSEF_STATUS_LABELS_PL } from '@/constants/invoiceKsefStatusPl';
import { INVOICE_STATUS_LABELS_PL } from '@/constants/invoiceStatusPl';
import {
  useCreateCorrectionMutation,
  useFetchKsefStatusMutation,
  useInvoicePreviewQuery,
  useInvoiceQuery,
  useIssueInvoiceMutation,
  useKsefAuthenticateMutation,
  useKsefSessionQuery,
  useMarkPaidInvoiceMutation,
  useSendToKsefMutation,
} from '@/query/use-invoices';
import { useMyCompaniesQuery } from '@/query/use-companies';
import { useAuth } from '@/context/AuthContext';
import { usePermission } from '@/hooks/usePermission';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { openInvoicePrintWindow } from '@/lib/openInvoicePrintWindow';
import { invoiceService } from '@/services/invoice.service';
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
  if (typeof e === 'object' && e !== null && 'detail' in e) return String((e as { detail: string }).detail);
  return 'Wystąpił błąd';
}

function AddressBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
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
  const { user } = useAuth();
  const canInvoices = usePermission('can_manage_invoices');
  const { data: myCompanies } = useMyCompaniesQuery();
  const currentCompanyName =
    myCompanies?.find((c) => c.id === user?.current_company)?.name ?? 'firma';
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
  const sendToKsefM = useSendToKsefMutation();
  const ksefAuthM = useKsefAuthenticateMutation();
  const fetchKsefStatusM = useFetchKsefStatusMutation();
  const createCorrectionM = useCreateCorrectionMutation();

  // Lazy session check — only fetch when invoice is issued and ksef not yet sent
  const needsKsefCheck = invoice?.status === 'issued' && invoice.ksef_status === 'not_sent';
  const { data: ksefSession } = useKsefSessionQuery(needsKsefCheck);

  const [actionError, setActionError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [xmlDownloading, setXmlDownloading] = useState(false);
  const [upoDownloading, setUpoDownloading] = useState(false);

  // Passphrase modal state
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseLoading, setPassphraseLoading] = useState(false);

  // Polling for pending invoices
  const [isPolling, setIsPolling] = useState(false);

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

  // --- Standard invoice actions ---

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

  const onDownloadXml = async () => {
    if (!id || !invoice) return;
    setXmlDownloading(true);
    try {
      const filename = `faktura-${(invoice.invoice_number ?? id).replace(/\//g, '-')}.xml`;
      await invoiceService.downloadXml(id, filename);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setXmlDownloading(false);
    }
  };

  const onDownloadUpo = async () => {
    if (!id || !invoice) return;
    setUpoDownloading(true);
    try {
      const ref = invoice.ksef_number || invoice.ksef_reference_number || id;
      const filename = `UPO-${ref.replace(/\//g, '-')}.xml`;
      await invoiceService.downloadUpo(id, filename);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setUpoDownloading(false);
    }
  };

  const onPrintInvoice = () => {
    if (!preview) return;
    setPrintError(null);
    const opened = openInvoicePrintWindow(preview);
    if (!opened) {
      setPrintError(
        'Nie udało się otworzyć widoku drukowania. Odśwież stronę i spróbuj ponownie.',
      );
    }
  };

  // --- KSeF flow ---

  /** Actually send the invoice — called after session is confirmed active. */
  const doSendToKsef = useCallback(async () => {
    if (!id) return;
    setActionError(null);
    try {
      await sendToKsefM.mutateAsync(id);
      void refetchInvoice();
    } catch (e) {
      setActionError(errMsg(e));
    }
  }, [id, sendToKsefM, refetchInvoice]);

  /** Authenticate and then send. Called from passphrase modal. */
  const onPassphraseConfirm = async (passphrase: string) => {
    setPassphraseError(null);
    setPassphraseLoading(true);
    try {
      await ksefAuthM.mutateAsync(passphrase);
      setShowPassphraseModal(false);
      setPassphraseLoading(false);
      await doSendToKsef();
    } catch (e) {
      setPassphraseLoading(false);
      // 422 = auth in progress, retry once after 2s
      const msg = errMsg(e);
      if (msg.toLowerCase().includes('trakcie') || msg.includes('422')) {
        setPassphraseError('Uwierzytelnianie w trakcie — spróbuj ponownie za chwilę.');
      } else {
        setPassphraseError(msg || 'Błędne hasło lub błąd połączenia z KSeF.');
      }
    }
  };

  /** Entry point: check session, show modal if needed, otherwise send directly. */
  const onSendToKsef = async () => {
    setActionError(null);
    if (ksefSession?.active) {
      await doSendToKsef();
    } else {
      setPassphraseError(null);
      setShowPassphraseModal(true);
    }
  };

  /** Poll SSAPI for updated KSeF status (manual refresh button). */
  const onRefreshKsefStatus = async () => {
    if (!id) return;
    setActionError(null);
    setIsPolling(true);
    try {
      await fetchKsefStatusM.mutateAsync(id);
      void refetchInvoice();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setIsPolling(false);
    }
  };

  // Auto-poll once when invoice is in 'pending' ksef_status
  useEffect(() => {
    if (invoice?.ksef_status !== 'pending' || !id) return;
    const timer = setTimeout(() => {
      void onRefreshKsefStatus();
    }, 3000);
    return () => clearTimeout(timer);
    // Only run when ksef_status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.ksef_status]);

  const showIssue = invoice?.status === 'draft';
  const showMarkPaid =
    invoice?.status === 'issued' ||
    invoice?.status === 'sent' ||
    invoice?.status === 'overdue';
  const showSendToKsef = invoice?.status === 'issued' && invoice.ksef_status === 'not_sent';
  const showResendKsef = invoice?.ksef_status === 'rejected';
  const showKsefRefresh = invoice?.ksef_status === 'pending';
  const showCreateCorrection =
    !invoice?.is_correction &&
    (invoice?.status === 'issued' || invoice?.status === 'sent' || invoice?.status === 'paid');

  const numberLabel = invoice?.invoice_number ?? preview?.invoice.invoice_number ?? id.slice(0, 8);

  return (
    <>
      {showPassphraseModal && (
        <KsefPassphraseModal
          companyName={currentCompanyName}
          onConfirm={(pw) => void onPassphraseConfirm(pw)}
          onCancel={() => {
            setShowPassphraseModal(false);
            setPassphraseError(null);
          }}
          loading={passphraseLoading}
          error={passphraseError}
        />
      )}

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
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
            <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">
              {invoice?.is_correction ? 'Korekta ' : 'Faktura '}{numberLabel}
            </h1>
            {invoice?.is_correction && invoice.corrects_invoice_id && (
              <p className="mt-1 text-sm text-muted-foreground">
                Koryguje:{' '}
                <Link
                  to={`/invoices/${invoice.corrects_invoice_id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {invoice.corrects_invoice_number ?? invoice.corrects_invoice_id.slice(0, 8)}
                </Link>
              </p>
            )}
            {invoice?.is_correction && invoice.correction_reason && (
              <p className="mt-1 text-xs text-muted-foreground">
                Powód: <span className="text-foreground">{invoice.correction_reason}</span>
              </p>
            )}
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
            {invoice?.ksef_number ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Numer KSeF:{' '}
                <span className="font-medium text-foreground">{invoice.ksef_number}</span>
              </p>
            ) : null}
            {invoice?.ksef_reference_number && !invoice.ksef_number ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Ref KSeF:{' '}
                <span className="font-mono text-foreground">{invoice.ksef_reference_number}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              {canInvoices && showIssue && (
                <Button
                  type="button"
                  onClick={() => void onIssue()}
                  disabled={issueM.isPending || fetching}
                >
                  {issueM.isPending ? 'Wystawianie…' : 'Wystaw'}
                </Button>
              )}
              {canInvoices && showMarkPaid && (
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
                onClick={onPrintInvoice}
                disabled={!preview || loading}
              >
                Drukuj fakturę
              </Button>
              {canInvoices && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onDownloadXml()}
                  disabled={!invoice || xmlDownloading}
                  loading={xmlDownloading}
                >
                  Pobierz XML (KSeF)
                </Button>
              )}

              {canInvoices && invoice?.upo_received && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onDownloadUpo()}
                  disabled={upoDownloading}
                  loading={upoDownloading}
                >
                  {upoDownloading ? 'Pobieranie…' : 'Pobierz UPO'}
                </Button>
              )}

              {canInvoices && (showSendToKsef || showResendKsef) && (
                <Button
                  type="button"
                  onClick={() => void onSendToKsef()}
                  disabled={sendToKsefM.isPending || ksefAuthM.isPending}
                  loading={sendToKsefM.isPending || ksefAuthM.isPending}
                >
                  {sendToKsefM.isPending || ksefAuthM.isPending
                    ? 'Wysyłanie…'
                    : showResendKsef
                    ? 'Wyślij ponownie do KSeF'
                    : 'Wyślij do KSeF'}
                </Button>
              )}

              {canInvoices && showKsefRefresh && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onRefreshKsefStatus()}
                  disabled={isPolling || fetchKsefStatusM.isPending}
                  loading={isPolling || fetchKsefStatusM.isPending}
                >
                  {isPolling ? 'Sprawdzanie…' : 'Odśwież status KSeF'}
                </Button>
              )}
              {canInvoices && showCreateCorrection && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/invoices/${id}/correction/new`)}
                  disabled={createCorrectionM.isPending}
                >
                  Utwórz korektę FV
                </Button>
              )}
            </div>
            {actionError && (
              <p className="max-w-md text-right text-sm text-destructive" role="alert">
                {actionError}
              </p>
            )}
            {printError && (
              <p className="max-w-md text-right text-sm text-destructive" role="alert">
                {printError}
              </p>
            )}
          </div>
        </div>

        {/* KSeF error message if invoice was rejected */}
        {invoice?.ksef_status === 'rejected' && invoice.ksef_error_message && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <span className="font-medium">Błąd KSeF: </span>
            {invoice.ksef_error_message}
          </div>
        )}

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
                <div className="overflow-x-auto rounded-2xl border border-border">
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
    </>
  );
}

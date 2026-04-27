import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DELIVERY_STATUS_LABELS_PL } from '@/constants/deliveryStatusPl';
import { deliveryStatusBadgeClassName } from '@/pages/DeliveryDocumentsPage';
import {
  useCompleteDeliveryMutation,
  useDeliveryQuery,
  useDeliveryPreviewQuery,
  useSaveDeliveryMutation,
  useStartDeliveryMutation,
} from '@/query/use-delivery';
import { useOrderQuery } from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { openWZPrintWindow } from '@/lib/openWZPrintWindow';
import type { DeliveryCompleteItemRow, DeliveryItem } from '@/types';
import type { Order } from '@/types';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Wystąpił błąd';
}

type LineLabelInput = Pick<DeliveryItem, 'order_item_id' | 'product_id'> & {
  product_name?: string | null;
};

/** Resolve product label: API product_name, then order line, then short id (MM lines have null order_item_id). */
export function productLabelForDeliveryLine(order: Order | undefined, line: LineLabelInput): string {
  if (line.product_name?.trim()) return line.product_name.trim();
  if (line.order_item_id) {
    const oi = order?.items.find((i) => i.id === line.order_item_id);
    if (oi?.product_name) return oi.product_name;
    return line.order_item_id.slice(0, 8);
  }
  if (line.product_id) return `Produkt ${line.product_id.slice(0, 8)}…`;
  return '—';
}

function qtyStr(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

type DeliveryLocationState = { fromVanLoading?: boolean };

type LineEditState = {
  quantity_actual: string;
  quantity_returned: string;
  return_reason: string;
  is_damaged: boolean;
  notes: string;
};

function buildInitialLineEdits(items: DeliveryItem[]): Record<string, LineEditState> {
  const next: Record<string, LineEditState> = {};
  for (const it of items) {
    next[it.id] = {
      quantity_actual: qtyStr(it.quantity_actual ?? it.quantity_planned),
      quantity_returned: qtyStr(it.quantity_returned ?? '0'),
      return_reason: it.return_reason ?? '',
      is_damaged: Boolean(it.is_damaged),
      notes: it.notes ?? '',
    };
  }
  return next;
}

export function DeliveryDocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: doc, isLoading, isError, error, refetch, isFetching } = useDeliveryQuery(id, Boolean(id));
  const { data: deliveryPreview, isLoading: prevLoading } = useDeliveryPreviewQuery(id, Boolean(id));
  const { data: order } = useOrderQuery(
    doc?.order_id ?? undefined,
    Boolean(doc?.order_id),
  );

  const [showVanLoadedBanner, setShowVanLoadedBanner] = useState(
    () => Boolean((location.state as DeliveryLocationState | null)?.fromVanLoading),
  );

  useEffect(() => {
    if (!showVanLoadedBanner) return;
    navigate(location.pathname, { replace: true, state: {} });
  }, [showVanLoadedBanner, location.pathname, navigate]);

  const saveM = useSaveDeliveryMutation();
  const startM = useStartDeliveryMutation();
  const completeM = useCompleteDeliveryMutation();

  const [actionError, setActionError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [lineEdits, setLineEdits] = useState<Record<string, LineEditState>>({});
  const [receiverName, setReceiverName] = useState('');
  const [returnsNotes, setReturnsNotes] = useState('');

  const openCompleteForm = useCallback(() => {
    if (!doc) return;
    setLineEdits(buildInitialLineEdits(doc.items));
    setReceiverName(doc.receiver_name?.trim() ? doc.receiver_name : '');
    setReturnsNotes(doc.returns_notes ?? '');
    setCompleteOpen(true);
    setActionError(null);
  }, [doc]);

  const closeCompleteForm = () => {
    setCompleteOpen(false);
    setActionError(null);
  };

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) {
    return <Navigate to="/delivery" replace />;
  }

  const onSave = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await saveM.mutateAsync(id);
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  const onStart = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await startM.mutateAsync(id);
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  const onCompleteSubmit = async () => {
    if (!id || !doc) return;
    setActionError(null);
    const items: DeliveryCompleteItemRow[] = doc.items.map((it) => {
      const row = lineEdits[it.id];
      return {
        id: it.id,
        quantity_actual: row?.quantity_actual?.trim() ? row.quantity_actual : undefined,
        quantity_returned: row?.quantity_returned?.trim() ? row.quantity_returned : '0',
        return_reason: row?.return_reason ?? '',
        is_damaged: row?.is_damaged ?? false,
        notes: row?.notes ?? '',
      };
    });
    try {
      await completeM.mutateAsync({
        id,
        data: {
          items,
          receiver_name: receiverName.trim() || undefined,
          returns_notes: returnsNotes.trim() || undefined,
        },
      });
      setCompleteOpen(false);
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  const workflowBusy = saveM.isPending || startM.isPending || completeM.isPending;

  const onPrintWz = () => {
    if (!deliveryPreview) return;
    setPrintError(null);
    const opened = openWZPrintWindow(deliveryPreview);
    if (!opened) {
      setPrintError(
        'Nie udało się otworzyć widoku drukowania. Odśwież stronę i spróbuj ponownie.',
      );
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/delivery')}>
          ← Lista WZ
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Ładowanie…</p>}
      {isError && !isLoading && (
        <div
          className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-destructive">{errMsg(error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {doc && !isError && (
        <>
          {showVanLoadedBanner && doc.document_type === 'MM' && (
            <div
              role="status"
              className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-foreground">
                Van został załadowany.{' '}
                <span className="text-muted-foreground">Numer dokumentu MM:</span>{' '}
                <span className="font-semibold tabular-nums">
                  {doc.document_number?.trim() ? doc.document_number : '—'}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                  Drukuj
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowVanLoadedBanner(false)}>
                  Zamknij
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {doc.document_type}{' '}
                {doc.document_number?.trim() ? doc.document_number : doc.id.slice(0, 8)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {doc.customer_name || '—'} · data wystawienia: {formatIssueDate(doc.issue_date)}
              </p>
              {isFetching && <p className="text-xs text-muted-foreground">Aktualizowanie…</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onPrintWz}
                disabled={!doc || !deliveryPreview || isLoading || prevLoading}
                id="delivery-action-print"
              >
                Drukuj WZ
              </Button>
              <span
                className={cn(
                  'inline-block rounded-full px-3 py-1 text-sm font-medium',
                  deliveryStatusBadgeClassName(doc.status),
                )}
              >
                {DELIVERY_STATUS_LABELS_PL[doc.status]}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            {doc.order_id ? (
              <span>
                Zamówienie:{' '}
                <Link to={`/orders/${doc.order_id}`} className="font-medium text-primary hover:underline">
                  {doc.order_number ?? doc.order_id.slice(0, 8)}
                </Link>
              </span>
            ) : (
              <span>Bez powiązania ze zamówieniem (MM / wewnętrzny)</span>
            )}
            {doc.driver_name?.trim() ? (
              <span className="text-foreground">· Kierowca: {doc.driver_name}</span>
            ) : null}
            {doc.delivered_at ? (
              <span>· Dostarczono: {new Date(doc.delivered_at).toLocaleString('pl-PL')}</span>
            ) : null}
          </div>

          {actionError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {actionError}
            </p>
          )}

          {printError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {printError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {doc.status === 'draft' && (
              <Button type="button" onClick={() => void onSave()} disabled={workflowBusy} id="delivery-action-save">
                {saveM.isPending ? 'Zapisywanie…' : 'Zapisz WZ'}
              </Button>
            )}
            {doc.status === 'saved' && (
              <Button
                type="button"
                onClick={() => void onStart()}
                disabled={workflowBusy}
                id="delivery-action-start"
              >
                {startM.isPending ? 'Uruchamianie…' : 'Rozpocznij dostawę'}
              </Button>
            )}
            {doc.status === 'in_transit' && (
              <Button
                type="button"
                variant={completeOpen ? 'outline' : 'default'}
                onClick={() => (completeOpen ? closeCompleteForm() : openCompleteForm())}
                disabled={workflowBusy && !completeOpen}
                id="delivery-action-complete-toggle"
              >
                {completeOpen ? 'Anuluj formularz' : 'Zakończ dostawę'}
              </Button>
            )}
          </div>

          {doc.status === 'in_transit' && completeOpen && (
            <Card className="border-primary/30 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Zakończenie dostawy — ilości i zwroty</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Uzupełnij ilości faktycznie dostarczone i ewentualne zwroty. Pola puste przy ilości faktycznej
                  oznaczają przyjęcie wartości zaplanowanej.
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Odbiorca (podpis / osoba)"
                    value={receiverName}
                    onChange={(e) => setReceiverName(e.target.value)}
                    id="delivery-complete-receiver"
                  />
                  <Input
                    label="Uwagi do zwrotów (dokument)"
                    value={returnsNotes}
                    onChange={(e) => setReturnsNotes(e.target.value)}
                    id="delivery-complete-returns-notes"
                  />
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-sm" aria-label="Linie WZ — zakończenie">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Produkt</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Zaplan.</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Faktyczna</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Zwrot</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Powód zwrotu</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Uszk.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {doc.items.map((it) => {
                        const row = lineEdits[it.id] ?? buildInitialLineEdits([it])[it.id];
                        return (
                          <tr key={it.id}>
                            <td className="max-w-[180px] px-3 py-2 text-foreground">
                              {productLabelForDeliveryLine(order, it)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                              {qtyStr(it.quantity_planned)}
                            </td>
                            <td className="px-3 py-2">
                              <label className="sr-only" htmlFor={`qa-${it.id}`}>
                                Ilość faktyczna {it.id}
                              </label>
                              <input
                                id={`qa-${it.id}`}
                                type="text"
                                inputMode="decimal"
                                className={cn(
                                  'flex h-9 w-full min-w-[5rem] rounded-md border border-input bg-background px-2 py-1 text-sm',
                                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                )}
                                value={row.quantity_actual}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({
                                    ...prev,
                                    [it.id]: { ...row, quantity_actual: e.target.value },
                                  }))
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <label className="sr-only" htmlFor={`qr-${it.id}`}>
                                Zwrot {it.id}
                              </label>
                              <input
                                id={`qr-${it.id}`}
                                type="text"
                                inputMode="decimal"
                                className={cn(
                                  'flex h-9 w-full min-w-[5rem] rounded-md border border-input bg-background px-2 py-1 text-sm',
                                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                )}
                                value={row.quantity_returned}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({
                                    ...prev,
                                    [it.id]: { ...row, quantity_returned: e.target.value },
                                  }))
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                className={cn(
                                  'flex h-9 w-full min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-sm',
                                  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                )}
                                value={row.return_reason}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({
                                    ...prev,
                                    [it.id]: { ...row, return_reason: e.target.value },
                                  }))
                                }
                                aria-label={`Powód zwrotu ${it.id}`}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={row.is_damaged}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({
                                    ...prev,
                                    [it.id]: { ...row, is_damaged: e.target.checked },
                                  }))
                                }
                                aria-label={`Uszkodzono ${it.id}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void onCompleteSubmit()}
                    disabled={completeM.isPending}
                    id="delivery-complete-submit"
                  >
                    {completeM.isPending ? 'Wysyłanie…' : 'Potwierdź zakończenie dostawy'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeCompleteForm} disabled={completeM.isPending}>
                    Zamknij
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pozycje</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak pozycji na tym dokumencie.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border md:hidden">
                    {doc.items.map((it: DeliveryItem) => (
                      <li key={it.id} className="py-3 text-sm">
                        <p className="font-medium text-foreground">
                          {productLabelForDeliveryLine(order, it)}
                        </p>
                        <p className="text-muted-foreground">
                          Zaplanowano: {qtyStr(it.quantity_planned)}
                          {it.quantity_actual != null && it.quantity_actual !== ''
                            ? ` · faktycznie: ${qtyStr(it.quantity_actual)}`
                            : ''}
                          {Number(it.quantity_returned) > 0 ? ` · zwrot: ${qtyStr(it.quantity_returned)}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="min-w-full divide-y divide-border text-sm" aria-label="Pozycje dokumentu WZ">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Produkt</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Zaplanowano</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Faktyczna</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Zwrot</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {doc.items.map((it: DeliveryItem) => (
                          <tr key={it.id}>
                            <td className="px-4 py-3 text-foreground">
                              {productLabelForDeliveryLine(order, it)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                              {qtyStr(it.quantity_planned)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                              {it.quantity_actual != null && it.quantity_actual !== '' ? qtyStr(it.quantity_actual) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                              {qtyStr(it.quantity_returned)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

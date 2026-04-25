import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { buildOrderStatusHistory, isOrderCancellableStatus } from '@/lib/order-status-history';
import { orderStatusBadgeClassName } from '@/pages/OrdersPage';
import {
  useCancelOrderMutation,
  useConfirmOrderMutation,
  useOrderQuery,
} from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { OrderItem } from '@/types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
const plDateTime = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

function money(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function orderDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function dateTime(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return plDateTime.format(d);
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Wystąpił błąd';
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: order, isLoading, isError, error, refetch, isFetching } = useOrderQuery(id, Boolean(id));
  const confirmM = useConfirmOrderMutation();
  const cancelM = useCancelOrderMutation();
  const [actionError, setActionError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) {
    return <Navigate to="/orders" replace />;
  }

  const showConfirm = order?.status === 'draft';
  const showCancel = order && isOrderCancellableStatus(order.status);
  const history = order ? buildOrderStatusHistory(order) : [];

  const onConfirm = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await confirmM.mutateAsync(id);
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  const onCancel = async () => {
    if (!id) return;
    if (!window.confirm('Czy na pewno anulować to zamówienie?')) return;
    setActionError(null);
    try {
      await cancelM.mutateAsync(id);
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/orders')}>
          ← Lista zamówień
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

      {order && !isError && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                Zamówienie {order.order_number ?? order.id.slice(0, 8)}
              </h1>
              {isFetching && <p className="text-xs text-muted-foreground">Aktualizowanie…</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-block rounded-full px-3 py-1 text-sm font-medium',
                  orderStatusBadgeClassName(order.status),
                )}
              >
                {ORDER_STATUS_LABELS_PL[order.status]}
              </span>
            </div>
          </div>

          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {showConfirm && (
              <Button
                type="button"
                onClick={() => void onConfirm()}
                disabled={confirmM.isPending}
                aria-busy={confirmM.isPending}
              >
                {confirmM.isPending ? 'Potwierdzanie…' : 'Potwierdź'}
              </Button>
            )}
            {showCancel && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void onCancel()}
                disabled={cancelM.isPending}
                aria-busy={cancelM.isPending}
              >
                {cancelM.isPending ? 'Anulowanie…' : 'Anuluj'}
              </Button>
            )}
            <Button type="button" variant="secondary" size="default" disabled title="Funkcja w przygotowaniu">
              Utwórz WZ
            </Button>
            <p className="w-full text-xs text-muted-foreground sm:w-auto sm:self-center">WZ — wkrótce (powiązanie z magazynem)</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dane nagłówka</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Klient: </span>
                  <span className="font-medium text-foreground">{order.customer_name}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Data zamówienia: </span>
                  {orderDate(order.order_date)}
                </p>
                <p>
                  <span className="text-muted-foreground">Data dostawy: </span>
                  {orderDate(order.delivery_date)}
                </p>
                <p>
                  <span className="text-muted-foreground">Suma netto: </span>
                  {money(order.total_net)}
                </p>
                <p>
                  <span className="text-muted-foreground">Suma brutto: </span>
                  <span className="font-semibold">{money(order.total_gross)}</span>
                </p>
                {order.customer_notes && (
                  <p>
                    <span className="text-muted-foreground">Uwagi (klient): </span>
                    {order.customer_notes}
                  </p>
                )}
                {order.internal_notes && (
                  <p>
                    <span className="text-muted-foreground">Uwagi wewnętrzne: </span>
                    {order.internal_notes}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historia statusu</CardTitle>
                <p className="text-sm font-normal text-muted-foreground">Na podstawie dat zarejestrowanych w systemie</p>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <ol className="relative space-y-4 border-s border-border ps-4">
                    {history.map((h, i) => (
                      <li key={`${h.kind}-${h.at}-${i}`} className="ms-0">
                        <p className="text-sm font-medium text-foreground">{h.label}</p>
                        <p className="text-xs text-muted-foreground">{dateTime(h.at)}</p>
                        <p className="text-sm text-muted-foreground">{h.sub}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pozycje</CardTitle>
            </CardHeader>
            <CardContent>
              {order.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak pozycji</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm" aria-label="Pozycje zamówienia">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 font-medium text-muted-foreground">Produkt</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">Ilość</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Netto / j.</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Brutto / j.</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">VAT</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rabat %</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Wartość netto</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Wartość brutto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {order.items.map((it: OrderItem) => (
                        <tr key={it.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-foreground">{it.product_name}</p>
                            <p className="text-xs text-muted-foreground">jedn. {it.product_unit || '—'}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {String(it.quantity)} {it.product_unit}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{money(it.unit_price_net)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{money(it.unit_price_gross)}</td>
                          <td className="px-3 py-2 text-right">{String(it.vat_rate)}</td>
                          <td className="px-3 py-2 text-right">{String(it.discount_percent)}</td>
                          <td className="px-3 py-2 text-right font-medium">{money(it.line_total_net)}</td>
                          <td className="px-3 py-2 text-right font-medium text-foreground">{money(it.line_total_gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border font-semibold">
                        <td colSpan={6} className="px-3 py-2 text-right text-muted-foreground">
                          Podsumowanie
                        </td>
                        <td className="px-3 py-2 text-right">{money(order.subtotal_net)}</td>
                        <td className="px-3 py-2 text-right">{money(order.subtotal_gross)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

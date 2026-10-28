import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useDeliveryQuery, useCreateWzKorMutation } from '@/query/use-delivery';
import { useApplyWzCorrectionMutation } from '@/query/use-orders';
import type { DeliveryDocument, DeliveryItem, WzKorItemPayload } from '@/types';

const fmt = (v: string | number | null | undefined) => {
  if (v == null) return '0.000';
  return parseFloat(String(v)).toFixed(3);
};

function errMsg(e: unknown): string {
  if (e && typeof e === 'object') {
    const d = (e as Record<string, unknown>).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.join('; ');
  }
  if (e instanceof Error) return e.message;
  return 'Wystąpił błąd';
}

export function WzCorrectionCreatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const createM = useCreateWzKorMutation();

  const { data: doc, isLoading } = useDeliveryQuery(id, Boolean(id));

  const applyWzCorrectionM = useApplyWzCorrectionMutation();

  const [correctionReason, setCorrectionReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Modal state — shown after WZ-KOR is created successfully
  const [orderUpdateModal, setOrderUpdateModal] = useState<{
    orderId: string;
    wzKorId: string;
    wzKorNumber: string;
    diff: Array<{ productName: string; productUnit: string; qtyBefore: number; qtyAfter: number }>;
  } | null>(null);
  const [orderUpdateError, setOrderUpdateError] = useState<string | null>(null);

  if (!id) {
    navigate('/delivery');
    return null;
  }

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Ładowanie…</div>;
  }

  if (!doc) {
    return <div className="p-6 text-destructive">Nie znaleziono dokumentu.</div>;
  }

  if (doc.document_type !== 'WZ' || doc.status !== 'delivered') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-destructive">
          Korektę WZ można wystawić tylko dla zatwierdzonego dokumentu WZ.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/delivery/${id}`)}>
          ← Wróć
        </Button>
      </div>
    );
  }

  const onSubmit = async () => {
    const items: WzKorItemPayload[] = doc.items
      .filter((item: DeliveryItem) => {
        const qty = parseFloat(quantities[item.id] ?? '0');
        return qty > 0;
      })
      .map((item: DeliveryItem) => ({
        delivery_item_id: item.id,
        quantity_returned: parseFloat(quantities[item.id]).toFixed(3),
        return_reason: reasons[item.id] ?? '',
      }));

    if (items.length === 0) {
      setSubmitError('Wpisz ilość zwrotu dla co najmniej jednej pozycji.');
      return;
    }

    setSubmitError(null);
    try {
      const kor = await createM.mutateAsync({
        id,
        data: { items, correction_reason: correctionReason.trim() },
      });

      // If linked to an order, show "update order?" modal
      const orderId = doc.order_id;
      if (orderId) {
        const diff = buildDiff(doc, kor, quantities);
        if (diff.length > 0) {
          setOrderUpdateModal({
            orderId,
            wzKorId: kor.id,
            wzKorNumber: kor.document_number ?? kor.id.slice(0, 8),
            diff,
          });
          return; // don't navigate yet — wait for modal decision
        }
      }

      navigate(`/delivery/${kor.id}`);
    } catch (e) {
      setSubmitError(errMsg(e));
    }
  };

  /** Build a diff: for each WZ item that has a return qty, compute before/after order quantity. */
  function buildDiff(
    wzDoc: typeof doc,
    _kor: DeliveryDocument,
    qtys: Record<string, string>,
  ) {
    return wzDoc.items
      .filter((item: DeliveryItem) => parseFloat(qtys[item.id] ?? '0') > 0)
      .map((item: DeliveryItem) => {
        const delivered = parseFloat(fmt(item.quantity_actual ?? item.quantity_planned));
        const returned = parseFloat(qtys[item.id] ?? '0');
        const qtyAfter = Math.max(delivered - returned, 0);
        return {
          productName: item.product_name ?? '—',
          productUnit: item.product_unit ?? '',
          qtyBefore: delivered,
          qtyAfter,
        };
      });
  }

  const totalReturned = doc.items.reduce((sum: number, item: DeliveryItem) => {
    const qty = parseFloat(quantities[item.id] ?? '0');
    return sum + (isNaN(qty) ? 0 : qty);
  }, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate(`/delivery/${id}`)}>
          ← Wróć
        </Button>
        <h1 className="text-xl font-semibold">
          Korekta WZ — {doc.document_number ?? id.slice(0, 8)}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ogólny powód korekty (opcjonalnie)</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="np. Zwrot towaru od klienta…"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pozycje do zwrotu</CardTitle>
          <button
            type="button"
            onClick={() => {
              const all: Record<string, string> = {};
              doc.items.forEach((item: DeliveryItem) => {
                all[item.id] = fmt(item.quantity_actual ?? item.quantity_planned);
              });
              setQuantities(all);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Zwróć wszystko
          </button>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Wpisz ilość do zwrotu. Puste pole = bez zmiany dla tej pozycji.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4">Produkt</th>
                  <th className="pb-2 pr-4 text-right">Ilość dostarczona</th>
                  <th className="pb-2 pr-4">Ilość zwrotu</th>
                  <th className="pb-2">Powód zwrotu</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => {
                  const delivered = parseFloat(fmt(item.quantity_actual ?? item.quantity_planned));
                  const returnQty = parseFloat(quantities[item.id] ?? '0');
                  const exceeds = returnQty > delivered;
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{item.product_name}</td>
                      <td className="py-2 pr-4 text-right text-muted-foreground">
                        {fmt(item.quantity_actual ?? item.quantity_planned)} {item.product_unit}
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          max={delivered}
                          className={`w-24 rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                            exceeds
                              ? 'border-destructive bg-destructive/5'
                              : 'border-input bg-background'
                          }`}
                          placeholder="0.000"
                          value={quantities[item.id] ?? ''}
                          onChange={(e) =>
                            setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                        />
                        {exceeds && (
                          <p className="mt-0.5 text-xs text-destructive">Max: {fmt(delivered)}</p>
                        )}
                      </td>
                      <td className="py-2">
                        <input
                          type="text"
                          className="w-full min-w-32 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="np. uszkodzone"
                          value={reasons[item.id] ?? ''}
                          onChange={(e) =>
                            setReasons((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalReturned > 0 && (
            <p className="mt-3 text-sm font-medium text-foreground">
              Łączna ilość do zwrotu: {totalReturned.toFixed(3)} szt.
            </p>
          )}
        </CardContent>
      </Card>

      {submitError && (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          onClick={() => void onSubmit()}
          disabled={createM.isPending || totalReturned === 0}
          loading={createM.isPending}
        >
          {createM.isPending ? 'Tworzenie korekty…' : 'Utwórz WZ-KOR'}
        </Button>
        <Button variant="outline" onClick={() => navigate(`/delivery/${id}`)}>
          Anuluj
        </Button>
      </div>

      {/* Modal: ask user whether to update the order quantities */}
      {orderUpdateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-apple-float">
            <h2 className="mb-1 text-base font-semibold text-slate-900">
              Zaktualizować zamówienie?
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Korekta {orderUpdateModal.wzKorNumber} zmienia dostarczone ilości. Czy zaktualizować
              ilości na powiązanym zamówieniu?
            </p>

            {/* Diff table */}
            <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_80px_80px] bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span>Produkt</span>
                <span className="text-right">Było</span>
                <span className="text-right text-rose-500">Będzie</span>
              </div>
              <div className="divide-y divide-slate-100">
                {orderUpdateModal.diff.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_80px] items-center px-4 py-2 text-sm">
                    <span className="truncate text-slate-700">{row.productName}</span>
                    <span className="text-right tabular-nums text-slate-400 line-through">
                      {row.qtyBefore} {row.productUnit}
                    </span>
                    <span className="text-right tabular-nums font-medium text-rose-700">
                      {row.qtyAfter} {row.productUnit}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {orderUpdateError && (
              <p className="mb-3 text-sm text-destructive">{orderUpdateError}</p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                onClick={async () => {
                  setOrderUpdateError(null);
                  try {
                    await applyWzCorrectionM.mutateAsync({
                      orderId: orderUpdateModal.orderId,
                      wzKorId: orderUpdateModal.wzKorId,
                    });
                    navigate(`/delivery/${orderUpdateModal.wzKorId}`);
                  } catch (e) {
                    setOrderUpdateError(errMsg(e));
                  }
                }}
                disabled={applyWzCorrectionM.isPending}
                loading={applyWzCorrectionM.isPending}
              >
                Tak, zaktualizuj zamówienie
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/delivery/${orderUpdateModal.wzKorId}`)}
                disabled={applyWzCorrectionM.isPending}
              >
                Nie, zostaw zamówienie bez zmian
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

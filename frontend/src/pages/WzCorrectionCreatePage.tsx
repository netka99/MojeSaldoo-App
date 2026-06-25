import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useDeliveryQuery, useCreateWzKorMutation } from '@/query/use-delivery';
import type { DeliveryItem, WzKorItemPayload } from '@/types';

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

  const [correctionReason, setCorrectionReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      navigate(`/delivery/${kor.id}`);
    } catch (e) {
      setSubmitError(errMsg(e));
    }
  };

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
        <CardHeader>
          <CardTitle>Pozycje do zwrotu</CardTitle>
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
    </div>
  );
}

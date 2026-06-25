import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useInvoiceQuery } from '@/query/use-invoices';
import { useCreateCorrectionMutation } from '@/query/use-invoices';
import type { CreateCorrectionBody } from '@/types';

const fmt = (v: string | number) =>
  typeof v === 'number' ? v.toFixed(2) : parseFloat(String(v)).toFixed(2);

function errMsg(e: unknown): string {
  if (e && typeof e === 'object') {
    const d = (e as Record<string, unknown>).detail;
    if (typeof d === 'string') return d;
    const r = (e as Record<string, unknown>).correction_reason;
    if (typeof r === 'string') return r;
  }
  if (e instanceof Error) return e.message;
  return 'Wystąpił błąd';
}

type ItemOverride = {
  itemId: string;
  quantity: string;
  unitPriceNet: string;
};

export function CorrectionInvoiceCreatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const createM = useCreateCorrectionMutation();

  const { data: invoice, isLoading } = useInvoiceQuery(id, Boolean(id));

  const [correctionReason, setCorrectionReason] = useState('');
  const [overrides, setOverrides] = useState<Record<string, ItemOverride>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!id) {
    navigate('/invoices');
    return null;
  }

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Ładowanie…</div>;
  }

  if (!invoice) {
    return <div className="p-6 text-destructive">Nie znaleziono faktury.</div>;
  }

  if (invoice.is_correction || (invoice.status !== 'issued' && invoice.status !== 'paid')) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-destructive">
          Korektę można wystawić tylko do faktury wystawionej lub opłaconej.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/invoices/${id}`)}>
          ← Wróć
        </Button>
      </div>
    );
  }

  const getOverride = (itemId: string, field: 'quantity' | 'unitPriceNet', fallback: string) =>
    overrides[itemId]?.[field] ?? fallback;

  const setOverride = (itemId: string, field: 'quantity' | 'unitPriceNet', value: string) => {
    setOverrides((prev) => ({
      ...prev,
      [itemId]: {
        itemId,
        quantity: getOverride(itemId, 'quantity', fmt(invoice.items.find((i) => i.id === itemId)?.quantity ?? '0')),
        unitPriceNet: getOverride(itemId, 'unitPriceNet', fmt(invoice.items.find((i) => i.id === itemId)?.unit_price_net ?? '0')),
        [field]: value,
      },
    }));
  };

  const correctionTotal = invoice.items.reduce((sum, item) => {
    const qty = parseFloat(getOverride(item.id, 'quantity', fmt(item.quantity)));
    const price = parseFloat(getOverride(item.id, 'unitPriceNet', fmt(item.unit_price_net)));
    const vat = parseFloat(String(item.vat_rate)) / 100;
    return sum + qty * price * (1 + vat);
  }, 0);

  const originalTotal = parseFloat(String(invoice.total_gross));
  const difference = correctionTotal - originalTotal;

  const onSubmit = async () => {
    if (!correctionReason.trim()) {
      setSubmitError('Powód korekty jest wymagany.');
      return;
    }
    setSubmitError(null);

    const items: CreateCorrectionBody['items'] = Object.values(overrides)
      .filter((o) => o.quantity !== '' || o.unitPriceNet !== '')
      .map((o) => ({
        item_id: o.itemId,
        quantity: o.quantity,
        unit_price_net: o.unitPriceNet,
      }));

    try {
      const correction = await createM.mutateAsync({
        id,
        body: { correction_reason: correctionReason.trim(), items },
      });
      navigate(`/invoices/${correction.id}`);
    } catch (e) {
      setSubmitError(errMsg(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate(`/invoices/${id}`)}>
          ← Wróć
        </Button>
        <h1 className="text-xl font-semibold">
          Korekta do faktury {invoice.invoice_number ?? id.slice(0, 8)}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Powód korekty</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            rows={3}
            placeholder="Wpisz powód korekty (wymagane)…"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pozycje korekty</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Wprowadź wartości <strong>po korekcie</strong> (ile powinno być, nie różnicę).
            Puste pole = bez zmiany.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4">Produkt</th>
                  <th className="pb-2 pr-4 text-right">Ilość oryg.</th>
                  <th className="pb-2 pr-4">Ilość po kor.</th>
                  <th className="pb-2 pr-4 text-right">Cena netto oryg.</th>
                  <th className="pb-2">Cena netto po kor.</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{item.product_name}</td>
                    <td className="py-2 pr-4 text-right text-muted-foreground">
                      {fmt(item.quantity)} {item.product_unit}
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="w-24 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder={fmt(item.quantity)}
                        value={overrides[item.id]?.quantity ?? ''}
                        onChange={(e) => setOverride(item.id, 'quantity', e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-4 text-right text-muted-foreground">
                      {fmt(item.unit_price_net)} PLN
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-28 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder={fmt(item.unit_price_net)}
                        value={overrides[item.id]?.unitPriceNet ?? ''}
                        onChange={(e) => setOverride(item.id, 'unitPriceNet', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-1 border-t pt-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Wartość oryginalna brutto:</span>
              <span>{fmt(originalTotal)} PLN</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Wartość po korekcie brutto:</span>
              <span>{correctionTotal.toFixed(2)} PLN</span>
            </div>
            <div
              className={`flex justify-between font-medium ${difference < 0 ? 'text-destructive' : 'text-foreground'}`}
            >
              <span>Różnica:</span>
              <span>
                {difference >= 0 ? '+' : ''}
                {difference.toFixed(2)} PLN
              </span>
            </div>
          </div>
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
          disabled={createM.isPending || !correctionReason.trim()}
          loading={createM.isPending}
        >
          {createM.isPending ? 'Zapisywanie…' : 'Utwórz korektę FV (draft)'}
        </Button>
        <Button variant="outline" onClick={() => navigate(`/invoices/${id}`)}>
          Anuluj
        </Button>
      </div>
    </div>
  );
}

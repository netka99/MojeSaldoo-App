import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useInvoiceQuery } from '@/query/use-invoices';
import { useCreateCorrectionMutation } from '@/query/use-invoices';
import type { CorrectionItemEntry, InvoicePaymentMethod } from '@/types';

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
  vatRate: string;
  removed: boolean;
};

type NewLine = {
  key: number;
  productName: string;
  productUnit: string;
  quantity: string;
  unitPriceNet: string;
  vatRate: string;
};

const VAT_OPTIONS = ['23', '8', '5', '0'];
const PAYMENT_METHODS: { value: InvoicePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Przelew' },
  { value: 'cash', label: 'Gotówka' },
  { value: 'card', label: 'Karta' },
];

export function CorrectionInvoiceCreatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const createM = useCreateCorrectionMutation();

  const { data: invoice, isLoading } = useInvoiceQuery(id, Boolean(id));

  const [correctionReason, setCorrectionReason] = useState('');
  const [overrides, setOverrides] = useState<Record<string, ItemOverride>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [newLineKey, setNewLineKey] = useState(0);

  // Header overrides — pre-filled from original invoice
  const [dueDate, setDueDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod | ''>('');

  // Pre-fill due date once invoice loads
  useEffect(() => {
    if (invoice?.due_date) {
      setDueDate(invoice.due_date);
    }
  }, [invoice?.due_date]);

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

  if (invoice.is_correction || (invoice.status !== 'issued' && invoice.status !== 'sent' && invoice.status !== 'paid')) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-destructive">
          Korektę można wystawić tylko do faktury wystawionej, wysłanej lub opłaconej.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/invoices/${id}`)}>
          ← Wróć
        </Button>
      </div>
    );
  }

  const getOverride = (itemId: string): ItemOverride | undefined => overrides[itemId];

  const updateOverride = (itemId: string, patch: Partial<Omit<ItemOverride, 'itemId'>>) => {
    setOverrides((prev) => {
      const existing = prev[itemId];
      const item = invoice.items.find((i) => i.id === itemId);
      const base: ItemOverride = existing ?? {
        itemId,
        quantity: '',
        unitPriceNet: '',
        vatRate: fmt(item?.vat_rate ?? '23'),
        removed: false,
      };
      return { ...prev, [itemId]: { ...base, ...patch } };
    });
  };

  const toggleRemoved = (itemId: string) => {
    const removed = !getOverride(itemId)?.removed;
    updateOverride(itemId, { removed });
  };

  const allRemoved = invoice?.items.every((item) => getOverride(item.id)?.removed === true) ?? false;

  const cancelAllItems = () => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const item of invoice?.items ?? []) {
        const existing = next[item.id];
        next[item.id] = existing
          ? { ...existing, removed: true }
          : { itemId: item.id, quantity: '', unitPriceNet: '', vatRate: fmt(item.vat_rate), removed: true };
      }
      return next;
    });
    setNewLines([]);
  };

  const restoreAllItems = () => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const item of invoice?.items ?? []) {
        if (next[item.id]) next[item.id] = { ...next[item.id], removed: false };
      }
      return next;
    });
  };

  const addNewLine = () => {
    setNewLines((prev) => [
      ...prev,
      { key: newLineKey, productName: '', productUnit: 'szt', quantity: '1', unitPriceNet: '0.00', vatRate: '23' },
    ]);
    setNewLineKey((k) => k + 1);
  };

  const removeNewLine = (key: number) => setNewLines((prev) => prev.filter((l) => l.key !== key));

  const updateNewLine = (key: number, patch: Partial<NewLine>) =>
    setNewLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Compute totals for preview
  const correctionTotal = invoice.items.reduce((sum, item) => {
    const ov = getOverride(item.id);
    if (ov?.removed) return sum;
    const qty = parseFloat(ov?.quantity || fmt(item.quantity));
    const price = parseFloat(ov?.unitPriceNet || fmt(item.unit_price_net));
    const vat = parseFloat(ov?.vatRate ?? fmt(item.vat_rate)) / 100;
    return sum + qty * price * (1 + vat);
  }, 0) + newLines.reduce((sum, l) => {
    const qty = parseFloat(l.quantity || '0');
    const price = parseFloat(l.unitPriceNet || '0');
    const vat = parseFloat(l.vatRate || '0') / 100;
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

    const items: CorrectionItemEntry[] = [];

    // Existing item overrides
    for (const item of invoice.items) {
      const ov = getOverride(item.id);
      if (!ov) continue;
      if (ov.removed) {
        items.push({ item_id: item.id, remove: true });
      } else {
        const entry: { item_id: string; quantity?: string; unit_price_net?: string; vat_rate?: string } = {
          item_id: item.id,
        };
        if (ov.quantity) entry.quantity = ov.quantity;
        if (ov.unitPriceNet) entry.unit_price_net = ov.unitPriceNet;
        const originalVat = fmt(item.vat_rate);
        if (ov.vatRate && ov.vatRate !== originalVat) entry.vat_rate = ov.vatRate;
        if (entry.quantity || entry.unit_price_net || entry.vat_rate) {
          items.push(entry);
        }
      }
    }

    // New lines
    for (const l of newLines) {
      if (!l.productName.trim()) continue;
      items.push({
        product_name: l.productName.trim(),
        quantity: l.quantity,
        unit_price_net: l.unitPriceNet,
        vat_rate: l.vatRate,
        product_unit: l.productUnit,
      });
    }

    try {
      const correction = await createM.mutateAsync({
        id,
        body: {
          correction_reason: correctionReason.trim(),
          items,
          ...(dueDate ? { due_date: dueDate } : {}),
          ...(paymentMethod ? { payment_method: paymentMethod } : {}),
        },
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
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Pozycje korekty</CardTitle>
            {allRemoved ? (
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                  Anulowanie — wszystkie pozycje usunięte
                </span>
                <Button variant="outline" size="sm" onClick={restoreAllItems}>
                  Cofnij
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/5"
                onClick={cancelAllItems}
              >
                Anuluj całą fakturę
              </Button>
            )}
          </div>
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
                  <th className="pb-2 pr-2">Produkt</th>
                  <th className="pb-2 pr-2 text-right">Ilość oryg.</th>
                  <th className="pb-2 pr-2">Ilość po kor.</th>
                  <th className="pb-2 pr-2 text-right">Cena netto oryg.</th>
                  <th className="pb-2 pr-2">Cena netto po kor.</th>
                  <th className="pb-2 pr-2">VAT %</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => {
                  const ov = getOverride(item.id);
                  const removed = ov?.removed ?? false;
                  return (
                    <tr
                      key={item.id}
                      className={`border-b last:border-0 ${removed ? 'opacity-50' : ''}`}
                      data-removed={removed || undefined}
                    >
                      <td className={`py-2 pr-2 font-medium ${removed ? 'line-through' : ''}`}>
                        {item.product_name}
                      </td>
                      <td className="py-2 pr-2 text-right text-muted-foreground">
                        {fmt(item.quantity)} {item.product_unit}
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          disabled={removed}
                          className="w-24 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                          placeholder={fmt(item.quantity)}
                          value={ov?.quantity ?? ''}
                          onChange={(e) => updateOverride(item.id, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2 text-right text-muted-foreground">
                        {fmt(item.unit_price_net)} PLN
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={removed}
                          className="w-28 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                          placeholder={fmt(item.unit_price_net)}
                          value={ov?.unitPriceNet ?? ''}
                          onChange={(e) => updateOverride(item.id, { unitPriceNet: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          disabled={removed}
                          className="rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                          value={ov?.vatRate ?? fmt(item.vat_rate)}
                          onChange={(e) => updateOverride(item.id, { vatRate: e.target.value })}
                          aria-label="Stawka VAT"
                        >
                          {VAT_OPTIONS.map((v) => (
                            <option key={v} value={v}>{v}%</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleRemoved(item.id)}
                          aria-label={removed ? 'Przywróć pozycję' : 'Usuń pozycję'}
                        >
                          {removed ? 'Przywróć' : 'Usuń'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Added lines */}
          {newLines.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Nowe pozycje:</p>
              <div className="space-y-2">
                {newLines.map((l) => (
                  <div key={l.key} className="flex flex-wrap items-center gap-2" data-testid="new-line-row">
                    <input
                      type="text"
                      className="flex-1 min-w-32 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Nazwa produktu"
                      value={l.productName}
                      onChange={(e) => updateNewLine(l.key, { productName: e.target.value })}
                    />
                    <input
                      type="text"
                      className="w-16 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Jedn."
                      value={l.productUnit}
                      onChange={(e) => updateNewLine(l.key, { productUnit: e.target.value })}
                    />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="w-20 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Ilość"
                      value={l.quantity}
                      onChange={(e) => updateNewLine(l.key, { quantity: e.target.value })}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-24 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Cena netto"
                      value={l.unitPriceNet}
                      onChange={(e) => updateNewLine(l.key, { unitPriceNet: e.target.value })}
                    />
                    <select
                      className="rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={l.vatRate}
                      onChange={(e) => updateNewLine(l.key, { vatRate: e.target.value })}
                      aria-label="Stawka VAT"
                    >
                      {VAT_OPTIONS.map((v) => (
                        <option key={v} value={v}>{v}%</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeNewLine(l.key)}
                      aria-label="Usuń nową pozycję"
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button variant="outline" size="sm" className="mt-3" onClick={addNewLine}>
            + Dodaj pozycję
          </Button>

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

      <Card>
        <CardHeader>
          <CardTitle>Dane nagłówkowe (opcjonalne)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Termin płatności</label>
              <input
                type="date"
                className="rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Forma płatności</label>
              <select
                className="rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod | '')}
                aria-label="Forma płatności"
              >
                <option value="">— bez zmiany —</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
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

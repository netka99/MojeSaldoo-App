import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUpdateProductStockMutation } from '@/query/use-products';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

const LOSS_REASONS = [
  { value: 'Przeterminowanie', label: 'Przeterminowanie' },
  { value: 'Uszkodzenie mechaniczne', label: 'Uszkodzenie mechaniczne' },
  { value: 'Błąd produkcji', label: 'Błąd produkcji' },
  { value: 'Kradzież', label: 'Kradzież' },
  { value: 'Inne', label: 'Inne' },
];

interface Props {
  productId: string;
  productName: string;
  productUnit: string;
  currentQty: number;
  warehouseId: string;
  warehouseName: string;
  onClose: () => void;
}

export function LossDialog({
  productId, productName, productUnit, currentQty, warehouseId, warehouseName, onClose,
}: Props) {
  const titleId = useId();
  const [lossQty, setLossQty] = useState('');
  const [reason, setReason] = useState(LOSS_REASONS[0].value);
  const [customReason, setCustomReason] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const updateStock = useUpdateProductStockMutation();
  const isBusy = updateStock.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isBusy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isBusy, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const qty = parseFloat(lossQty.replace(',', '.'));
  const finalReason = reason === 'Inne' ? (customReason.trim() || 'Inne') : reason;

  const handleConfirm = async () => {
    if (!lossQty.trim() || isNaN(qty) || qty <= 0) {
      setSubmitError('Podaj dodatnią ilość straty.');
      return;
    }
    if (qty > currentQty && currentQty >= 0) {
      setSubmitError(`Strata (${qty}) przekracza dostępny stan (${currentQty} ${productUnit}).`);
      return;
    }
    setSubmitError(null);
    try {
      await updateStock.mutateAsync({
        id: productId,
        body: {
          warehouse_id: warehouseId,
          quantity_change: -qty,
          movement_type: 'damage',
          notes: finalReason,
        },
      });
      setDone(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Błąd zapisu.');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={(e) => { if (!isBusy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-surface-card p-0 shadow-sm"
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="border-0 bg-surface-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle id={titleId} className="text-lg">Rejestracja straty</CardTitle>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{productName}</span> · {warehouseName}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {done ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
                  <svg className="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <p className="text-sm font-semibold text-foreground">Strata zapisana</p>
                <p className="text-sm text-muted-foreground">
                  Odpisano <span className="font-medium text-red-600">-{qty} {productUnit}</span> · {finalReason}
                </p>
                <Button type="button" className="mt-2" onClick={onClose}>Gotowe</Button>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-muted/40 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Stan dostępny</p>
                  <p className="text-2xl font-bold text-foreground">
                    {currentQty} <span className="text-base font-normal text-muted-foreground">{productUnit}</span>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Ilość straty ({productUnit})</label>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    autoFocus
                    value={lossQty}
                    onChange={(e) => setLossQty(e.target.value)}
                    placeholder="np. 5"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {!isNaN(qty) && qty > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Stan po odpisaniu: <span className="font-medium">{(currentQty - qty).toFixed(2)} {productUnit}</span>
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Przyczyna straty</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {LOSS_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                {reason === 'Inne' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Opis przyczyny</label>
                    <input
                      type="text"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      placeholder="Wpisz przyczynę…"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                )}

                {submitError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>Anuluj</Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!lossQty.trim() || isNaN(qty) || qty <= 0 || isBusy}
                    loading={isBusy}
                    onClick={() => void handleConfirm()}
                  >
                    Zapisz stratę
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>,
    document.body,
  );
}

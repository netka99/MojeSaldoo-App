import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUpdateProductStockMutation } from '@/query/use-products';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface Props {
  productId: string;
  productName: string;
  productUnit: string;
  currentQty: number;
  warehouseId: string;
  warehouseName: string;
  onClose: () => void;
}

export function StockCorrectionDialog({
  productId, productName, productUnit, currentQty, warehouseId, warehouseName, onClose,
}: Props) {
  const titleId = useId();
  const [actualQty, setActualQty] = useState('');
  const [notes, setNotes] = useState('');
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

  const actual = parseFloat(actualQty.replace(',', '.'));
  const delta = isNaN(actual) ? null : actual - currentQty;

  const handleConfirm = async () => {
    if (delta === null) { setSubmitError('Podaj stan rzeczywisty.'); return; }
    if (delta === 0) { setSubmitError('Stan rzeczywisty jest taki sam jak systemowy — brak korekty.'); return; }
    setSubmitError(null);
    try {
      await updateStock.mutateAsync({
        id: productId,
        body: {
          warehouse_id: warehouseId,
          quantity_change: delta,
          movement_type: 'adjustment',
          notes: notes.trim() || `Korekta ręczna: ${currentQty} → ${actual} ${productUnit}`,
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
            <CardTitle id={titleId} className="text-lg">Korekta stanu</CardTitle>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{productName}</span> · {warehouseName}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {done ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <p className="text-sm font-semibold text-foreground">Korekta zapisana</p>
                <p className="text-sm text-muted-foreground">
                  Stan zmieniono z <span className="font-medium">{currentQty}</span> na <span className="font-medium">{actual}</span> {productUnit}
                  {delta !== null && (
                    <span className={`ml-1 font-medium ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ({delta > 0 ? '+' : ''}{delta})
                    </span>
                  )}
                </p>
                <Button type="button" className="mt-2" onClick={onClose}>Gotowe</Button>
              </div>
            ) : (
              <>
                {/* Current qty display */}
                <div className="rounded-xl bg-muted/40 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Stan systemowy</p>
                  <p className="text-2xl font-bold text-foreground">
                    {currentQty} <span className="text-base font-normal text-muted-foreground">{productUnit}</span>
                  </p>
                </div>

                {/* Actual qty input */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Stan rzeczywisty ({productUnit})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    autoFocus
                    value={actualQty}
                    onChange={(e) => setActualQty(e.target.value)}
                    placeholder="Wpisz faktyczną ilość…"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {/* Delta preview */}
                {delta !== null && delta !== 0 && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${delta > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    Korekta: <span className="font-semibold">{delta > 0 ? '+' : ''}{delta} {productUnit}</span>
                    {delta < 0 && ' — stan zostanie zmniejszony'}
                    {delta > 0 && ' — stan zostanie zwiększony'}
                  </div>
                )}
                {delta === 0 && actualQty !== '' && (
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    Stan bez zmian.
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Powód korekty (opcjonalnie)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="np. Weryfikacja po inwentaryzacji"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {submitError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>Anuluj</Button>
                  <Button type="button" disabled={delta === null || delta === 0 || isBusy} loading={isBusy} onClick={() => void handleConfirm()}>
                    Zapisz korektę
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

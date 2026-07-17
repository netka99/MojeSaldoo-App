import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTransferStockMutation } from '@/query/use-warehouses';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { WarehouseStockItem } from '@/types';

interface Props {
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  stockItems: WarehouseStockItem[];
  onClose: () => void;
}

type TransferLine = {
  productId: string;
  productName: string;
  productUnit: string;
  available: number;
  qty: string;
};

type Step = 'destination' | 'items' | 'done';

export function TransferDialog({
  sourceWarehouseId, sourceWarehouseCode, sourceWarehouseName, stockItems, onClose,
}: Props) {
  const titleId = useId();
  const [step, setStep] = useState<Step>('destination');
  const [destinationId, setDestinationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transferred: number; destination: string } | null>(null);

  const warehousesQ = useWarehouseListQuery(1);
  const transfer = useTransferStockMutation();
  const isBusy = transfer.isPending;

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

  const otherWarehouses = useMemo(
    () => (warehousesQ.data?.results ?? []).filter((w) => w.id !== sourceWarehouseId),
    [warehousesQ.data, sourceWarehouseId],
  );

  const destinationWarehouse = otherWarehouses.find((w) => w.id === destinationId);

  // Items with positive available stock
  const availableItems = useMemo(
    () => stockItems.filter((s) => parseFloat(String(s.quantity_available)) > 0),
    [stockItems],
  );

  const handleSelectDestination = () => {
    if (!destinationId) return;
    // Pre-populate lines from stock items, empty qty
    setLines(
      availableItems.map((s) => ({
        productId: s.product_id,
        productName: s.product_name,
        productUnit: s.product_unit,
        available: parseFloat(String(s.quantity_available)),
        qty: '',
      })),
    );
    setStep('items');
  };

  const setLineQty = (productId: string, val: string) => {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty: val } : l)));
  };

  const filledLines = lines.filter((l) => {
    const n = parseFloat(l.qty.replace(',', '.'));
    return !isNaN(n) && n > 0;
  });

  const lineErrors = lines
    .filter((l) => l.qty.trim() !== '')
    .map((l) => {
      const n = parseFloat(l.qty.replace(',', '.'));
      if (isNaN(n) || n <= 0) return `${l.productName}: nieprawidłowa ilość`;
      if (n > l.available) return `${l.productName}: za dużo (dostępne ${l.available} ${l.productUnit})`;
      return null;
    })
    .filter(Boolean) as string[];

  const handleConfirm = async () => {
    if (filledLines.length === 0) { setSubmitError('Podaj ilość dla co najmniej jednego produktu.'); return; }
    if (lineErrors.length > 0) { setSubmitError(lineErrors[0]); return; }
    setSubmitError(null);
    try {
      const res = await transfer.mutateAsync({
        sourceWarehouseId,
        destination_warehouse_id: destinationId,
        items: filledLines.map((l) => ({
          product_id: l.productId,
          quantity: parseFloat(l.qty.replace(',', '.')),
        })),
        notes: notes.trim() || `Przesunięcie ${sourceWarehouseCode} → ${destinationWarehouse?.code ?? ''}`,
      });
      setResult({ transferred: res.transferred, destination: destinationWarehouse?.name ?? '' });
      setStep('done');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Błąd przesunięcia.');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={(e) => { if (!isBusy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="max-h-[min(90vh,700px)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-surface-card p-0 shadow-sm"
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="border-0 bg-surface-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle id={titleId} className="text-lg">Przesunięcie magazynowe</CardTitle>
            <p className="text-sm text-muted-foreground">
              Źródło: <span className="font-medium text-foreground">{sourceWarehouseCode} — {sourceWarehouseName}</span>
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* ── Step: destination ── */}
            {step === 'destination' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Magazyn docelowy</label>
                  {warehousesQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie…</p>}
                  {!warehousesQ.isLoading && otherWarehouses.length === 0 && (
                    <p className="text-sm text-muted-foreground">Brak innych magazynów w firmie.</p>
                  )}
                  {otherWarehouses.length > 0 && (
                    <select
                      value={destinationId}
                      onChange={(e) => setDestinationId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Wybierz magazyn…</option>
                      {otherWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Notatka (opcjonalnie)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="np. Załadunek poranny"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {availableItems.length === 0 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    Brak produktów z dostępnym stanem w tym magazynie.
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={onClose}>Anuluj</Button>
                  <Button
                    type="button"
                    disabled={!destinationId || availableItems.length === 0}
                    onClick={handleSelectDestination}
                  >
                    Dalej →
                  </Button>
                </div>
              </>
            )}

            {/* ── Step: items ── */}
            {step === 'items' && (
              <>
                <p className="text-sm text-muted-foreground">
                  Do: <span className="font-medium text-foreground">{destinationWarehouse?.code} — {destinationWarehouse?.name}</span>
                </p>
                <p className="text-xs text-muted-foreground">Zostaw pole puste aby pominąć produkt.</p>

                <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                  {lines.map((line) => (
                    <div key={line.productId} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{line.productName}</p>
                        <p className="text-xs text-muted-foreground">Dostępne: {line.available} {line.productUnit}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max={line.available}
                          step="any"
                          value={line.qty}
                          onChange={(e) => setLineQty(line.productId, e.target.value)}
                          placeholder="0"
                          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <span className="text-xs text-muted-foreground">{line.productUnit}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {filledLines.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {filledLines.length} {filledLines.length === 1 ? 'produkt' : filledLines.length < 5 ? 'produkty' : 'produktów'} do przesunięcia
                  </p>
                )}

                {submitError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setStep('destination')} disabled={isBusy}>Wróć</Button>
                  <Button
                    type="button"
                    disabled={filledLines.length === 0 || lineErrors.length > 0 || isBusy}
                    loading={isBusy}
                    onClick={() => void handleConfirm()}
                  >
                    Przesuń {filledLines.length > 0 ? `(${filledLines.length})` : ''}
                  </Button>
                </div>
              </>
            )}

            {/* ── Step: done ── */}
            {step === 'done' && result && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                  <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-foreground">Przesunięcie zakończone</p>
                <p className="text-sm text-muted-foreground">
                  Przeniesiono <span className="font-medium">{result.transferred}</span> {result.transferred === 1 ? 'produkt' : 'produkty'} do{' '}
                  <span className="font-medium text-foreground">{result.destination}</span>
                </p>
                <Button type="button" className="mt-2" onClick={onClose}>Gotowe</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>,
    document.body,
  );
}

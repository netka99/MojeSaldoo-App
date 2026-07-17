import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAllProductsQuery, useUpdateProductStockMutation } from '@/query/use-products';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface Props {
  warehouseId: string;
  warehouseName: string;
  /** Product IDs already in this warehouse — shown but not excluded */
  existingProductIds?: Set<string>;
  onClose: () => void;
}

export function AddStockDialog({ warehouseId, warehouseName, existingProductIds, onClose }: Props) {
  const titleId = useId();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [addedName, setAddedName] = useState('');

  const productsQ = useAllProductsQuery();
  const updateStock = useUpdateProductStockMutation();
  const isBusy = updateStock.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isBusy, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const allProducts = productsQ.data?.results ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allProducts;
    return allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q),
    );
  }, [allProducts, search]);

  const selected = allProducts.find((p) => p.id === selectedId) ?? null;

  const handleConfirm = async () => {
    if (!selected) return;
    const qty = parseFloat(quantity.replace(',', '.'));
    if (!quantity.trim() || isNaN(qty) || qty <= 0) {
      setSubmitError('Podaj dodatnią ilość.');
      return;
    }
    setSubmitError(null);
    try {
      await updateStock.mutateAsync({
        id: selected.id,
        body: {
          warehouse_id: warehouseId,
          quantity_change: qty,
          movement_type: 'adjustment',
          notes: notes.trim() || 'Stan otwarcia',
        },
      });
      setAddedName(selected.name);
      setDone(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Błąd zapisu.');
    }
  };

  const handleAddAnother = () => {
    setSelectedId(null);
    setQuantity('');
    setNotes('');
    setSubmitError(null);
    setDone(false);
    setSearch('');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={(e) => { if (!isBusy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="max-h-[min(90vh,640px)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-surface-card p-0 shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="border-0 bg-surface-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle id={titleId} className="text-xl">
              Dodaj produkt do magazynu
            </CardTitle>
            <p className="text-sm text-muted-foreground">{warehouseName}</p>
          </CardHeader>

          <CardContent className="space-y-4">
            {done ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-base font-semibold text-foreground">Dodano</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{addedName}</span> został dodany do magazynu.
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={handleAddAnother}>
                    Dodaj kolejny
                  </Button>
                  <Button type="button" onClick={onClose}>
                    Gotowe
                  </Button>
                </div>
              </div>
            ) : !selected ? (
              <>
                {/* Product picker */}
                <Input
                  label="Szukaj produktu"
                  placeholder="Nazwa lub SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                {productsQ.isLoading && (
                  <p className="text-sm text-muted-foreground">Ładowanie produktów…</p>
                )}
                {!productsQ.isLoading && filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground">Brak wyników.</p>
                )}
                {filtered.length > 0 && (
                  <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
                    {filtered.map((p) => {
                      const alreadyHere = existingProductIds?.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          onClick={() => setSelectedId(p.id)}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                            {p.sku && (
                              <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-muted-foreground">{p.unit}</span>
                            {alreadyHere && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                już jest
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
                    Anuluj
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Quantity form */}
                <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                  <p className="text-sm font-medium text-foreground">{selected.name}</p>
                  {selected.sku && (
                    <p className="text-xs text-muted-foreground font-mono">{selected.sku}</p>
                  )}
                </div>

                <Input
                  label={`Ilość (${selected.unit})`}
                  placeholder="np. 50"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                />

                <Input
                  label="Notatka (opcjonalnie)"
                  placeholder="np. Stan otwarcia"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />

                {submitError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setSelectedId(null)} disabled={isBusy}>
                    Wróć
                  </Button>
                  <Button type="button" disabled={isBusy} loading={isBusy} onClick={() => void handleConfirm()}>
                    Dodaj do magazynu
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

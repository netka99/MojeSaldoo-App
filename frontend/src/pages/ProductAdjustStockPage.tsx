import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useProductQuery, useUpdateProductStockMutation } from '@/query/use-products';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import type { StockMovementType } from '@/services/product.service';
const MOVEMENT_TYPES: Extract<StockMovementType, 'adjustment' | 'damage'>[] = [
  'adjustment',
  'damage',
];

const MOVEMENT_TYPE_LABELS_PL: Record<typeof MOVEMENT_TYPES[number], string> = {
  adjustment: 'Korekta ręczna',
  damage: 'Ubytek / uszkodzenie',
};

export function ProductAdjustStockPage() {
  const { id: productId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const updateStock = useUpdateProductStockMutation();

  const [warehouseId, setWarehouseId] = useState('');
  const [quantityChange, setQuantityChange] = useState('');
  const [movementType, setMovementType] = useState<typeof MOVEMENT_TYPES[number]>('adjustment');
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const productQ = useProductQuery(productId, Boolean(productId));
  const warehousesQ = useWarehouseListQuery(1);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!productId) {
    return <Navigate to="/products" replace />;
  }

  const warehouses = warehousesQ.data?.results ?? [];
  const product = productQ.data;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!warehouseId) {
      setSubmitError('Wybierz magazyn.');
      return;
    }
    if (!quantityChange.trim()) {
      setSubmitError('Podaj zmianę ilości.');
      return;
    }
    try {
      await updateStock.mutateAsync({
        id: productId,
        body: {
          warehouse_id: warehouseId,
          quantity_change: quantityChange.trim(),
          movement_type: movementType,
          notes: notes.trim() || undefined,
        },
      });
      navigate('/products');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Nie udało się zaktualizować stanu');
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
          Wróć do listy produktów
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/products/${productId}/edit`)}>
          Dane produktu
        </Button>
      </div>

      {productQ.isError && (
        <p className="text-sm text-destructive" role="alert">
          {productQ.error instanceof Error ? productQ.error.message : 'Nie udało się wczytać produktu'}
        </p>
      )}

      {product && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Korekta / ubytek stanu</CardTitle>
            <p className="text-sm text-muted-foreground">
              Produkt: <span className="font-medium text-foreground">{product.name}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Dla przesunięć między magazynami użyj przycisku „Przesuń" na stronie magazynu.
            </p>
          </CardHeader>
          <CardContent>
            {warehousesQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie magazynów…</p>}
            {warehousesQ.isError && (
              <p className="text-sm text-destructive">
                Nie udało się wczytać magazynów. Upewnij się, że w systemie zdefiniowano co najmniej jeden magazyn.
              </p>
            )}
            {!warehousesQ.isLoading && warehouses.length === 0 && (
              <p className="mb-4 text-sm text-muted-foreground">
                Brak magazynów.{' '}
                <Link to="/warehouses/new" className="text-primary underline">
                  Dodaj magazyn
                </Link>
                {' '}lub skonfiguruj magazyn w ustawieniach.
              </p>
            )}
            {warehouses.length > 0 && (
              <form className="space-y-4" onSubmit={onSubmit}>
                {submitError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}
                <div className="space-y-2">
                  <label htmlFor="warehouse" className="text-sm font-medium">
                    Magazyn
                  </label>
                  <select
                    id="warehouse"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    required
                  >
                    <option value="">Wybierz…</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Zmiana ilości"
                  helperText="Wartość dodatnia zwiększa stan, ujemna zmniejsza (jeśli dozwolone)."
                  value={quantityChange}
                  onChange={(e) => setQuantityChange(e.target.value)}
                  placeholder="np. 10 lub -2"
                  required
                />
                <div className="space-y-2">
                  <label htmlFor="movement-type" className="text-sm font-medium">
                    Typ ruchu
                  </label>
                  <select
                    id="movement-type"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as StockMovementType)}
                  >
                    {MOVEMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {MOVEMENT_TYPE_LABELS_PL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <Input label="Notatki (opcjonalnie)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button type="submit" loading={updateStock.isPending}>
                  Zastosuj
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

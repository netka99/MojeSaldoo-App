import { useState } from 'react';
import { format } from 'date-fns';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useProductionOrdersQuery,
  useCreateProductionOrderMutation,
  useCompleteProductionOrderMutation,
  useDeleteProductionOrderMutation,
  useRecipesQuery,
} from '@/query/use-production';
import { useQuery } from '@tanstack/react-query';
import { productService } from '@/services/product.service';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ProductionOrderCreate, Recipe } from '@/types/production.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const n4 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });

const inputClass = cn(
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

type BatchInputRow = { ingredient: string; ingredient_name: string; ingredient_unit: string; quantity_used: string };

function NewOrderForm({
  recipes,
  stockMap,
  onSave,
  onCancel,
  saving,
}: {
  recipes: Recipe[];
  stockMap: Map<string, number>;
  onSave: (data: ProductionOrderCreate) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [recipeId, setRecipeId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mode, setMode] = useState<'simple' | 'batch'>('simple');
  const [qtyProduced, setQtyProduced] = useState('');
  const [notes, setNotes] = useState('');
  const [batchInputs, setBatchInputs] = useState<BatchInputRow[]>([]);

  const selectedRecipe = recipes.find((r) => r.id === recipeId);

  // When recipe changes, pre-fill batch input rows from recipe items
  function handleRecipeChange(id: string) {
    setRecipeId(id);
    const recipe = recipes.find((r) => r.id === id);
    if (recipe) {
      setBatchInputs(
        recipe.items.map((item) => ({
          ingredient: item.ingredient,
          ingredient_name: item.ingredient_name,
          ingredient_unit: item.unit || item.ingredient_unit,
          quantity_used: '',
        })),
      );
    }
  }

  function updateBatchRow(idx: number, value: string) {
    setBatchInputs((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity_used: value } : r)));
  }


  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: ProductionOrderCreate = {
      recipe: recipeId,
      date,
      mode,
      quantity_produced: Number(qtyProduced),
      notes,
    };
    if (mode === 'batch') {
      payload.inputs = batchInputs
        .filter((r) => r.ingredient && Number(r.quantity_used) > 0)
        .map((r) => ({
          ingredient: r.ingredient,
          quantity_used: Number(r.quantity_used),
          unit: r.ingredient_unit,
        }));
    }
    onSave(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Receptura *</label>
          <select
            className={inputClass}
            value={recipeId}
            onChange={(e) => handleRecipeChange(e.target.value)}
            required
          >
            <option value="">— wybierz recepturę —</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.product_name} (×{r.yield_quantity})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Data produkcji *</label>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Ilość wyprodukowana *</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.01"
              step="0.01"
              className={inputClass}
              value={qtyProduced}
              onChange={(e) => setQtyProduced(e.target.value)}
              placeholder="np. 300"
              required
            />
            {selectedRecipe && (
              <span className="shrink-0 text-sm text-muted-foreground">{selectedRecipe.product_unit}</span>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Tryb</label>
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'simple' | 'batch')}
          >
            <option value="simple">Prosty — z receptury</option>
            <option value="batch">Wsad — realne zużycie</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {mode === 'simple'
              ? 'Zużycie surowców obliczone automatycznie na podstawie receptury.'
              : 'Podaj ile surowców faktycznie poszło (wlicza odpady w koszt).'}
          </p>
        </div>
      </div>

      {/* Batch mode: actual input quantities */}
      {mode === 'batch' && selectedRecipe && (
        <div className="rounded-md border border-border p-3">
          <h3 className="mb-2 text-sm font-medium">Realne zużycie surowców</h3>
          {batchInputs.length === 0 && (
            <p className="text-xs text-muted-foreground">Wybierz recepturę, aby zobaczyć składniki.</p>
          )}
          <div className="space-y-2">
            {batchInputs.map((row, idx) => {
              const inStock = stockMap.get(row.ingredient);
              return (
                <div key={row.ingredient} className="grid grid-cols-[1fr_140px] items-center gap-2">
                  <div>
                    <span className="text-sm">{row.ingredient_name}</span>
                    {inStock !== undefined && (
                      <span className={cn(
                        'ml-2 text-xs',
                        inStock <= 0 ? 'text-destructive font-medium' : 'text-muted-foreground',
                      )}>
                        (stan: {inStock} {row.ingredient_unit})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      className={inputClass}
                      placeholder="ilość"
                      value={row.quantity_used}
                      onChange={(e) => updateBatchRow(idx, e.target.value)}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">{row.ingredient_unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Simple mode: show recipe summary */}
      {mode === 'simple' && selectedRecipe && qtyProduced && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Szacowane zużycie surowców:</p>
          <ul className="space-y-0.5 text-xs">
            {selectedRecipe.items.map((item) => {
              const scale = Number(qtyProduced) / Number(selectedRecipe.yield_quantity);
              const needed = Number(item.quantity) * scale;
              const inStock = stockMap.get(item.ingredient);
              const insufficient = inStock !== undefined && inStock < needed;
              return (
                <li key={item.id} className={insufficient ? 'text-destructive font-medium' : ''}>
                  {item.ingredient_name}: {n4.format(needed)} {item.unit || item.ingredient_unit}
                  {inStock !== undefined && (
                    <span className={cn('ml-2', insufficient ? 'text-destructive' : 'text-muted-foreground')}>
                      (stan: {n4.format(inStock)}{insufficient ? ' — za mało!' : ''})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Notatki</label>
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !recipeId || !qtyProduced}>
          {saving ? 'Zapisywanie…' : 'Utwórz zlecenie'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}

export function ProductionOrdersPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const [page] = useState(1);
  const { data: ordersData, isLoading } = useProductionOrdersQuery(page);
  const { data: recipes = [] } = useRecipesQuery();
  const { data: productsData } = useQuery({
    queryKey: ['products', 'all-for-production'],
    queryFn: () => productService.fetchList({ page_size: 200, ordering: 'name' }),
  });

  // Map productId → stock_total for ingredient stock display in form
  const stockMap = new Map<string, number>();
  for (const p of productsData?.results ?? []) {
    if (p.stock_total !== undefined && p.stock_total !== null) {
      stockMap.set(p.id, Number(p.stock_total));
    }
  }

  const createM = useCreateProductionOrderMutation();
  const completeM = useCompleteProductionOrderMutation();
  const deleteM = useDeleteProductionOrderMutation();

  const [showForm, setShowForm] = useState(false);

  const orders = ordersData?.results ?? [];

  async function handleCreate(data: ProductionOrderCreate) {
    await createM.mutateAsync(data);
    setShowForm(false);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produkcja</h1>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>+ Nowe zlecenie</Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nowe zlecenie produkcji</CardTitle>
          </CardHeader>
          <CardContent>
            <NewOrderForm
              recipes={recipes}
              stockMap={stockMap}
              onSave={(d) => void handleCreate(d)}
              onCancel={() => setShowForm(false)}
              saving={createM.isPending}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {!isLoading && orders.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Brak zleceń produkcji.</p>
          )}
          {!isLoading && orders.length > 0 && (
            <div className="divide-y">
              {orders.map((order) => {
                const isCompleted = order.status === 'completed';
                return (
                  <div key={order.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium">{order.order_number}</span>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-medium',
                              isCompleted
                                ? 'bg-green-100 text-green-700'
                                : 'bg-yellow-100 text-yellow-700',
                            )}
                          >
                            {isCompleted ? 'Zakończone' : 'Szkic'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {order.mode === 'batch' ? 'wsad' : 'prosty'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm">
                          <span className="font-medium">{order.finished_product_name}</span>
                          {' — '}
                          {order.quantity_produced} {order.finished_product_unit}
                          {' · '}
                          {order.date}
                        </p>
                        {isCompleted && order.real_unit_cost !== null && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Koszt/szt.: {pln.format(Number(order.real_unit_cost))}
                            {' · '}
                            Łączny koszt: {pln.format(Number(order.total_input_cost))}
                          </p>
                        )}
                        {isCompleted && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            RW: {order.rw_document_number ?? '—'}
                            {' · '}
                            PW: {order.pw_document_number ?? '—'}
                          </p>
                        )}
                        {/* Batch inputs summary */}
                        {order.mode === 'batch' && order.inputs.length > 0 && (
                          <ul className="mt-1 space-y-0 text-xs text-muted-foreground">
                            {order.inputs.map((inp) => (
                              <li key={inp.id}>
                                {inp.ingredient_name}: {inp.quantity_used} {inp.unit}
                                {inp.fifo_cost !== null && (
                                  <span className="ml-1">
                                    ({pln.format(Number(inp.fifo_cost))})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        {!isCompleted && (
                          <Button
                            size="sm"
                            disabled={completeM.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `Zakończyć zlecenie ${order.order_number}?\n\nSystemem pobierze surowce z magazynu (FIFO) i doda gotowy wyrób.`,
                                )
                              ) {
                                void completeM.mutateAsync(order.id);
                              }
                            }}
                          >
                            {completeM.isPending ? '…' : 'Zakończ'}
                          </Button>
                        )}
                        {!isCompleted && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={deleteM.isPending}
                            onClick={() => {
                              if (confirm('Usunąć zlecenie?')) {
                                void deleteM.mutateAsync(order.id);
                              }
                            }}
                          >
                            Usuń
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useRecipesQuery,
  useCreateRecipeMutation,
  useUpdateRecipeMutation,
  useDeleteRecipeMutation,
} from '@/query/use-production';
import { authStorage } from '@/services/api';
import { useAllProductsQuery } from '@/query/use-products';
import { cn } from '@/lib/utils';
import type { Recipe, RecipeCreate, RecipeItem } from '@/types/production.types';

const inputClass = cn(
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

type IngredientRow = { ingredient: string; quantity: string; unit: string; notes: string };

function RecipeForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Recipe;
  onSave: (data: RecipeCreate) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { data: productsData } = useAllProductsQuery();
  const products = productsData?.results ?? [];

  const [product, setProduct] = useState(initial?.product ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [yieldQty, setYieldQty] = useState(String(initial?.yield_quantity ?? '1'));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [rows, setRows] = useState<IngredientRow[]>(
    initial?.items.map((i) => ({
      ingredient: i.ingredient,
      quantity: String(i.quantity),
      unit: i.unit,
      notes: i.notes,
    })) ?? [{ ingredient: '', quantity: '', unit: '', notes: '' }],
  );

  function addRow() {
    setRows((r) => [...r, { ingredient: '', quantity: '', unit: '', notes: '' }]);
  }
  function removeRow(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }
  function updateRow(idx: number, field: keyof IngredientRow, value: string) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validRows = rows.filter((r) => r.ingredient && Number(r.quantity) > 0);
    onSave({
      product,
      name,
      yield_quantity: Number(yieldQty) || 1,
      notes,
      items: validRows.map((r) => ({
        ingredient: r.ingredient,
        quantity: Number(r.quantity),
        unit: r.unit,
        notes: r.notes,
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Gotowy wyrób *</label>
          <select
            className={inputClass}
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            required
          >
            <option value="">— wybierz produkt —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Nazwa receptury</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Kartacze duże"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Wydajność partii (szt.) *</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={inputClass}
            value={yieldQty}
            onChange={(e) => setYieldQty(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Ile sztuk gotowego wyrobu produkuje jedna pełna receptura</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Notatki</label>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Ingredients */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Składniki</h3>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            + Dodaj składnik
          </Button>
        </div>
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_100px_80px_auto] items-center gap-2">
              <select
                className={inputClass}
                value={row.ingredient}
                onChange={(e) => {
                  const p = products.find((pr) => pr.id === e.target.value);
                  updateRow(idx, 'ingredient', e.target.value);
                  if (p && !row.unit) updateRow(idx, 'unit', p.unit);
                }}
              >
                <option value="">— składnik —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.0001"
                className={inputClass}
                placeholder="ilość"
                value={row.quantity}
                onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="j.m."
                value={row.unit}
                onChange={(e) => updateRow(idx, 'unit', e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(idx)}
                className="text-destructive"
              >
                ✕
              </Button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Brak składników. Kliknij "+ Dodaj składnik".</p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !product}>
          {saving ? 'Zapisywanie…' : 'Zapisz recepturę'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}

/** Cost per unit of finished product derived from ingredient avg_costs in serializer data. */
function calcEstimatedCost(items: RecipeItem[], yieldQty: number): number | null {
  if (items.length === 0) return null;
  let total = 0;
  for (const item of items) {
    if (item.ingredient_avg_cost === null || item.ingredient_avg_cost === undefined) return null;
    total += Number(item.quantity) * Number(item.ingredient_avg_cost);
  }
  return yieldQty > 0 ? total / yieldQty : null;
}

export function RecipesPage() {
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const { data: recipes = [], isLoading } = useRecipesQuery();
  const createM = useCreateRecipeMutation();
  const deleteM = useDeleteRecipeMutation();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRecipe = editingId ? recipes.find((r) => r.id === editingId) : undefined;
  const updateM = useUpdateRecipeMutation(editingId ?? '');

  async function handleSave(data: RecipeCreate) {
    if (editingId) {
      await updateM.mutateAsync(data);
      setEditingId(null);
    } else {
      await createM.mutateAsync(data);
      setShowForm(false);
    }
  }

  const saving = createM.isPending || updateM.isPending;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Receptury</h1>
        {!showForm && !editingId && (
          <Button onClick={() => setShowForm(true)}>+ Nowa receptura</Button>
        )}
      </div>

      {/* Create form */}
      {showForm && !editingId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nowa receptura</CardTitle>
          </CardHeader>
          <CardContent>
            <RecipeForm
              onSave={(d) => void handleSave(d)}
              onCancel={() => setShowForm(false)}
              saving={saving}
            />
          </CardContent>
        </Card>
      )}

      {/* Edit form */}
      {editingId && editingRecipe && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Edytuj recepturę</CardTitle>
          </CardHeader>
          <CardContent>
            <RecipeForm
              initial={editingRecipe}
              onSave={(d) => void handleSave(d)}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          </CardContent>
        </Card>
      )}

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {!isLoading && recipes.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Brak receptur. Dodaj pierwszą.</p>
          )}
          {!isLoading && recipes.length > 0 && (
            <div className="divide-y">
              {recipes.map((recipe) => (
                <div key={recipe.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {recipe.name || recipe.product_name}
                      {recipe.name && (
                        <span className="ml-2 text-sm text-muted-foreground">({recipe.product_name})</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Wydajność: {recipe.yield_quantity} {recipe.product_unit} &nbsp;·&nbsp;
                      {recipe.items.length} składnik{recipe.items.length === 1 ? '' : recipe.items.length < 5 ? 'i' : 'ów'}
                    </p>
                    {recipe.items.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {recipe.items.map((item) => {
                          const stock = item.ingredient_stock_total !== null && item.ingredient_stock_total !== undefined
                            ? Number(item.ingredient_stock_total)
                            : null;
                          return (
                            <li key={item.id} className="text-xs text-muted-foreground">
                              {item.ingredient_name}: {item.quantity} {item.unit || item.ingredient_unit}
                              {stock !== null && (
                                <span className={cn('ml-1', stock <= 0 ? 'text-destructive font-medium' : '')}>
                                  (stan: {stock})
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {recipe.items.length > 0 && (() => {
                      const cost = calcEstimatedCost(recipe.items, Number(recipe.yield_quantity));
                      return (
                        <p className="mt-1.5 text-xs">
                          <span className="font-medium text-foreground">
                            Koszt/szt.:&nbsp;
                            {cost !== null
                              ? `${cost.toFixed(2)} zł`
                              : <span className="text-muted-foreground">— brak cen składników</span>
                            }
                          </span>
                          {cost !== null && (
                            <span className="ml-1 text-muted-foreground">(wg avg_cost)</span>
                          )}
                        </p>
                      );
                    })()}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowForm(false); setEditingId(recipe.id); }}
                    >
                      Edytuj
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={deleteM.isPending}
                      onClick={() => {
                        if (confirm(`Usunąć recepturę "${recipe.name || recipe.product_name}"?`)) {
                          void deleteM.mutateAsync(recipe.id);
                        }
                      }}
                    >
                      Usuń
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

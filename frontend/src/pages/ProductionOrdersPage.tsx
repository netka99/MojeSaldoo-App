import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useProductionOrdersQuery,
  useCreateProductionOrderMutation,
  useCompleteProductionOrderMutation,
  useDeleteProductionOrderMutation,
  useRecipesQuery,
  useProductionPlanningQuery,
} from '@/query/use-production';
import { useAllProductsQuery } from '@/query/use-products';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';
import type { ProductionOrderCreate, ProductionPlanningItem, Recipe } from '@/types/production.types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const n2 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
const n4 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });

const inputClass = cn(
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

// ── Inline order creation form ────────────────────────────────────────────────

type BatchInputRow = {
  ingredient: string;
  ingredient_name: string;
  ingredient_unit: string;
  quantity_used: string;
};

function OrderForm({
  recipes,
  prefillRecipeId,
  prefillQty,
  prefillSourceOrders,
  onSave,
  onCancel,
  saving,
}: {
  recipes: Recipe[];
  prefillRecipeId?: string;
  prefillQty?: number;
  prefillSourceOrders?: string[];
  onSave: (data: ProductionOrderCreate) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const lockedFromPlanning = !!prefillRecipeId;
  const [recipeId, setRecipeId] = useState(prefillRecipeId ?? '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mode, setMode] = useState<'simple' | 'batch'>('simple');
  const [qtyProduced, setQtyProduced] = useState(prefillQty ? String(prefillQty) : '');
  const autoNotes = prefillSourceOrders?.length
    ? `Dla zamówień: ${prefillSourceOrders.join(', ')}`
    : '';
  const [notes, setNotes] = useState(autoNotes);
  const [batchInputs, setBatchInputs] = useState<BatchInputRow[]>(() => {
    if (!prefillRecipeId) return [];
    const recipe = recipes.find((r) => r.id === prefillRecipeId);
    return recipe
      ? recipe.items.map((item) => ({
          ingredient: item.ingredient,
          ingredient_name: item.ingredient_name,
          ingredient_unit: item.unit || item.ingredient_unit,
          quantity_used: '',
        }))
      : [];
  });

  const selectedRecipe = recipes.find((r) => r.id === recipeId);
  const { data: productsData } = useAllProductsQuery();
  const allProducts = productsData?.results ?? [];

  function handleRecipeChange(id: string) {
    setRecipeId(id);
    const recipe = recipes.find((r) => r.id === id);
    setBatchInputs(
      recipe
        ? recipe.items.map((item) => ({
            ingredient: item.ingredient,
            ingredient_name: item.ingredient_name,
            ingredient_unit: item.unit || item.ingredient_unit,
            quantity_used: '',
          }))
        : [],
    );
  }

  function updateBatchIngredient(idx: number, productId: string) {
    const product = allProducts.find((p) => p.id === productId);
    setBatchInputs((rows) =>
      rows.map((r, i) =>
        i === idx
          ? {
              ...r,
              ingredient: productId,
              ingredient_name: product ? product.name : r.ingredient_name,
              ingredient_unit: product ? product.unit : r.ingredient_unit,
            }
          : r,
      ),
    );
  }

  function updateBatchRow(idx: number, value: string) {
    setBatchInputs((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity_used: value } : r)));
  }

  function removeBatchRow(idx: number) {
    setBatchInputs((rows) => rows.filter((_, i) => i !== idx));
  }

  function addBatchRow() {
    setBatchInputs((rows) => [...rows, { ingredient: '', ingredient_name: '', ingredient_unit: '', quantity_used: '' }]);
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
        .map((r) => ({ ingredient: r.ingredient, quantity_used: Number(r.quantity_used), unit: r.ingredient_unit }));
    }
    onSave(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {lockedFromPlanning && prefillSourceOrders && prefillSourceOrders.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground shrink-0">Na podstawie zamówień:</span>
          <span className="font-mono font-medium">{prefillSourceOrders.join(', ')}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Receptura *</label>
          {lockedFromPlanning ? (
            <div className={cn(inputClass, 'cursor-default bg-muted/50 text-foreground')}>
              {selectedRecipe ? `${selectedRecipe.name || selectedRecipe.product_name} (×${selectedRecipe.yield_quantity})` : '—'}
            </div>
          ) : (
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
          )}
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
              ? 'Zużycie surowców obliczone automatycznie z receptury.'
              : 'Podaj ile surowców faktycznie poszło (wlicza odpady w koszt).'}
          </p>
        </div>
      </div>

      {/* Batch mode */}
      {mode === 'batch' && selectedRecipe && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Realne zużycie surowców</h3>
            <span className="text-xs text-muted-foreground">Możesz zmienić surowiec lub dodać zamiennik</span>
          </div>
          <div className="space-y-2">
            {batchInputs.map((row, idx) => {
              const recipeItem = selectedRecipe.items.find((i) => i.ingredient === row.ingredient);
              const stockRaw = recipeItem?.ingredient_stock_total
                ?? allProducts.find((p) => p.id === row.ingredient)?.stock_total;
              const inStock = stockRaw != null ? Number(stockRaw) : undefined;
              return (
                <div key={idx}>
                  <div className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
                    <select
                      className={cn(inputClass, 'h-8 text-xs')}
                      value={row.ingredient}
                      onChange={(e) => updateBatchIngredient(idx, e.target.value)}
                      required
                    >
                      <option value="">— wybierz surowiec —</option>
                      {allProducts.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        className={cn(inputClass, 'h-8 text-xs')}
                        placeholder="ilość"
                        value={row.quantity_used}
                        onChange={(e) => updateBatchRow(idx, e.target.value)}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">{row.ingredient_unit}</span>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => removeBatchRow(idx)}
                      title="Usuń wiersz"
                    >
                      ✕
                    </button>
                  </div>
                  {inStock !== undefined && (
                    <span className={cn('mt-0.5 block text-xs', inStock <= 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                      stan: {n4.format(inStock)} {row.ingredient_unit}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addBatchRow}>
            + Dodaj surowiec
          </Button>
        </div>
      )}

      {/* Simple mode — estimated consumption */}
      {mode === 'simple' && selectedRecipe && qtyProduced && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Szacowane zużycie surowców:</p>
          <ul className="space-y-0.5 text-xs">
            {selectedRecipe.items.map((item) => {
              const scale = Number(qtyProduced) / Number(selectedRecipe.yield_quantity);
              const needed = Number(item.quantity) * scale;
              const inStock = item.ingredient_stock_total != null ? Number(item.ingredient_stock_total) : undefined;
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

// ── Planning row ──────────────────────────────────────────────────────────────

function PlanningRow({
  item,
  draftQtyInProduction,
  onCreateOrder,
  canManage,
}: {
  item: ProductionPlanningItem;
  draftQtyInProduction: number;
  onCreateOrder: (recipeId: string, qty: number, sourceOrders: string[]) => void;
  canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shortfall = Number(item.shortfall);
  const hasShortfall = shortfall > 0;
  const covered = draftQtyInProduction >= shortfall;

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{item.product_name}</span>
            {hasShortfall ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                niedobór {n2.format(shortfall)} {item.product_unit}
              </span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                stan ok
              </span>
            )}
            {draftQtyInProduction > 0 && (
              <span className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                covered ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700',
              )}>
                w produkcji: {n2.format(draftQtyInProduction)} {item.product_unit}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Zamówiono: <strong className="text-foreground">{n2.format(Number(item.total_ordered))}</strong>
            {' · '}
            Stan: <strong className="text-foreground">{n2.format(Number(item.stock_available))} {item.product_unit}</strong>
            {hasShortfall && item.estimated_unit_cost != null && (
              <>
                {' · '}
                Koszt produkcji: <strong className="text-foreground">{pln.format(Number(item.estimated_total_cost))}</strong>
                <span className="ml-1 text-muted-foreground">(wg avg_cost)</span>
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.orders.map((o, i) => (
              <span key={o.order_id}>
                {i > 0 && <span className="mx-1">·</span>}
                <span className="font-mono text-foreground">{o.order_number}</span>
                <span className="ml-1">{o.customer_name}</span>
                {o.delivery_date && <span className="ml-1 text-muted-foreground">({o.delivery_date})</span>}
              </span>
            ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'zwiń' : 'szczegóły'}
          </button>
          {hasShortfall && canManage && (
            <Button size="sm" onClick={() => onCreateOrder(item.recipe_id, shortfall, item.orders.map((o) => o.order_number))}>
              + Zlecenie
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="bg-muted/20 px-4 pb-3 pt-1">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Potrzebne surowce:</p>
          <ul className="space-y-0.5">
            {item.ingredients.map((ing) => (
              <li
                key={ing.ingredient_id}
                className={cn('text-xs', !ing.has_enough_stock ? 'text-destructive font-medium' : 'text-muted-foreground')}
              >
                {ing.ingredient_name}: {n2.format(Number(ing.quantity_needed))} {ing.ingredient_unit}
                <span className="ml-2">
                  (stan: {n2.format(Number(ing.stock_available))}{!ing.has_enough_stock ? ' — za mało!' : ''})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type FormState =
  | { open: false }
  | { open: true; prefillRecipeId?: string; prefillQty?: number; prefillSourceOrders?: string[] };

export function ProductionOrdersPage() {
  const canProduction = usePermission('can_manage_production');

  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));

  const [page] = useState(1);
  const [form, setForm] = useState<FormState>({ open: false });

  const { data: ordersData, isLoading: ordersLoading } = useProductionOrdersQuery(page);
  const { data: recipes = [] } = useRecipesQuery();
  const { data: planningItems = [], isLoading: planningLoading } = useProductionPlanningQuery({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const createM = useCreateProductionOrderMutation();
  const completeM = useCompleteProductionOrderMutation();
  const deleteM = useDeleteProductionOrderMutation();

  const orders = ordersData?.results ?? [];

  async function handleCreate(data: ProductionOrderCreate) {
    await createM.mutateAsync(data);
    setForm({ open: false });
  }

  function openFormFromPlanning(recipeId: string, qty: number, sourceOrders: string[]) {
    setForm({ open: true, prefillRecipeId: recipeId, prefillQty: Math.ceil(qty), prefillSourceOrders: sourceOrders });
    setTimeout(() => document.getElementById('production-form')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const shortfallCount = planningItems.filter((i) => {
    if (Number(i.shortfall) <= 0) return false;
    const inProd = orders
      .filter((o) => o.status !== 'completed' && o.recipe === i.recipe_id)
      .reduce((sum, o) => sum + Number(o.quantity_produced), 0);
    return inProd < Number(i.shortfall);
  }).length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Produkcja</h1>
      </div>

      {/* ── Planning — what to produce ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-sm">Co wyprodukować</CardTitle>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className={cn(inputClass, 'h-7 w-36 text-xs')}
                value={dateFrom}
                placeholder="od"
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">—</span>
              <input
                type="date"
                className={cn(inputClass, 'h-7 w-36 text-xs')}
                value={dateTo}
                placeholder="do"
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            {!planningLoading && planningItems.length > 0 && shortfallCount > 0 && (
              <span className="text-xs font-medium text-destructive">
                {shortfallCount} {shortfallCount === 1 ? 'wyrób wymaga' : 'wyroby wymagają'} produkcji
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {planningLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {!planningLoading && planningItems.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Brak otwartych zamówień na wyroby z recepturami w wybranym okresie.
            </p>
          )}
          {!planningLoading && planningItems.length > 0 && (() => {
            const visibleItems = planningItems
              .map((item) => {
                const draftQtyInProduction = orders
                  .filter((o) => o.status !== 'completed' && o.recipe === item.recipe_id)
                  .reduce((sum, o) => sum + Number(o.quantity_produced), 0);
                return { item, draftQtyInProduction };
              })
              .filter(({ item, draftQtyInProduction }) =>
                !(Number(item.shortfall) > 0 && draftQtyInProduction >= Number(item.shortfall))
              );

            if (visibleItems.length === 0) {
              return (
                <p className="p-4 text-sm text-muted-foreground">
                  Wszystkie niedobory są już w produkcji.
                </p>
              );
            }

            return (
              <div>
                {visibleItems.map(({ item, draftQtyInProduction }) => (
                  <PlanningRow
                    key={item.product_id}
                    item={item}
                    draftQtyInProduction={draftQtyInProduction}
                    onCreateOrder={openFormFromPlanning}
                    canManage={canProduction}
                  />
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── Inline order creation form ── */}
      {form.open && (
        <Card id="production-form">
          <CardHeader>
            <CardTitle className="text-sm">
              {form.prefillRecipeId ? 'Nowe zlecenie produkcji (z planu)' : 'Nowe zlecenie produkcji'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OrderForm
              recipes={recipes}
              prefillRecipeId={form.open ? form.prefillRecipeId : undefined}
              prefillQty={form.open ? form.prefillQty : undefined}
              prefillSourceOrders={form.open ? form.prefillSourceOrders : undefined}
              onSave={(d) => void handleCreate(d)}
              onCancel={() => setForm({ open: false })}
              saving={createM.isPending}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Production orders list ── */}
      <div className="flex items-center gap-3 pt-2">
        <span className="text-base font-semibold">Zlecenia produkcji</span>
        <div className="flex-1 border-t border-border" />
        {!form.open && canProduction && (
          <Button size="sm" onClick={() => setForm({ open: true })}>+ Nowe zlecenie</Button>
        )}
      </div>

      {ordersLoading && <p className="text-sm text-muted-foreground">Ładowanie…</p>}
      {!ordersLoading && orders.length === 0 && (
        <p className="text-sm text-muted-foreground">Brak zleceń produkcji.</p>
      )}
      {!ordersLoading && orders.length > 0 && (() => {
        const draft = orders.filter((o) => o.status !== 'completed');
        const completed = orders.filter((o) => o.status === 'completed');

        function OrderCard({ order }: { order: typeof orders[0] }) {
          const isCompleted = order.status === 'completed';
          return (
            <div className={cn(
              'rounded-xl border p-4',
              isCompleted ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/40',
            )}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{order.order_number}</span>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      isCompleted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                    )}>
                      {isCompleted ? 'Zakończone' : 'W produkcji'}
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
                  {order.notes ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{order.notes}</p>
                  ) : null}
                  {isCompleted && order.real_unit_cost !== null && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Koszt/szt.: {pln.format(Number(order.real_unit_cost))}
                      {' · '}
                      Łączny: {pln.format(Number(order.total_input_cost))}
                    </p>
                  )}
                  {isCompleted && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      RW: {order.rw_document_number ?? '—'} · PW: {order.pw_document_number ?? '—'}
                    </p>
                  )}
                  {order.mode === 'batch' && order.inputs.length > 0 && (
                    <ul className="mt-1 space-y-0 text-xs text-muted-foreground">
                      {order.inputs.map((inp) => (
                        <li key={inp.id}>
                          {inp.ingredient_name}: {inp.quantity_used} {inp.unit}
                          {inp.fifo_cost !== null && (
                            <span className="ml-1">({pln.format(Number(inp.fifo_cost))})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canProduction && (
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {!isCompleted && (
                      <Button
                        size="sm"
                        disabled={completeM.isPending}
                        onClick={() => {
                          if (confirm(`Zakończyć zlecenie ${order.order_number}?\n\nSystem pobierze surowce z magazynu (FIFO) i doda gotowy wyrób.`)) {
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
                )}
              </div>
            </div>
          );
        }

        return (
          <div className="space-y-6">
            {draft.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                  W produkcji ({draft.length})
                </p>
                <div className="space-y-2">
                  {draft.map((o) => <OrderCard key={o.id} order={o} />)}
                </div>
              </div>
            )}
            {completed.length > 0 && (
              <div className="space-y-2">
                {draft.length > 0 && <div className="border-t border-border" />}
                <p className="text-xs font-medium uppercase tracking-wide text-green-700">
                  Zakończone ({completed.length})
                </p>
                <div className="space-y-2">
                  {completed.map((o) => <OrderCard key={o.id} order={o} />)}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

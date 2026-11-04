import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Link, Navigate } from 'react-router-dom';
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
import { useOrderListQuery } from '@/query/use-orders';
import { useWorkflowSettingsQuery } from '@/query/use-companies';
import { useAuth } from '@/context/AuthContext';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';
import type { PlanningOrder, ProductionOrder, ProductionOrderCreate, ProductionPlanningItem, Recipe } from '@/types/production.types';
import type { Order } from '@/types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const n2 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

// ── Source order row (expandable) ────────────────────────────────────────────

function SourceOrderRow({ order: o, checked, onToggle, highlightProductId, scheduledQty, totalQty }: {
  order: Order;
  checked: boolean;
  onToggle: () => void;
  highlightProductId?: string;
  scheduledQty?: number;   // how much of this order is already in active production
  totalQty?: number;       // total remaining for this order (for the highlighted product)
}) {
  const [expanded, setExpanded] = useState(false);
  const items = o.items ?? [];
  const highlightedItem = highlightProductId
    ? items.find((i) => i.product_id === highlightProductId)
    : undefined;
  const inProduction = (scheduledQty ?? 0) > 0;
  const fullyScheduled = totalQty != null && scheduledQty != null && scheduledQty >= totalQty;

  return (
    <div className={cn(fullyScheduled ? 'opacity-50' : checked && 'bg-primary/5')}>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 accent-primary shrink-0"
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium">{o.order_number ?? o.id}</span>
            <span className="ml-2 text-sm text-muted-foreground">{o.customer_name}</span>
            {o.delivery_date && (
              <span className="ml-2 text-xs text-muted-foreground">· {o.delivery_date}</span>
            )}
            {inProduction && scheduledQty != null && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                w produkcji: {n2.format(scheduledQty)} szt.
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {highlightedItem && (
              <div className="text-right">
                {inProduction && scheduledQty != null && totalQty != null && scheduledQty < totalQty ? (
                  <>
                    <span className="text-sm font-semibold text-slate-800 tabular-nums">
                      {n2.format(totalQty - scheduledQty)} szt.
                    </span>
                    <span className="ml-1 text-xs text-slate-400 line-through tabular-nums">
                      {n2.format(totalQty)}
                    </span>
                  </>
                ) : (
                  <span className="text-sm font-semibold text-slate-800 tabular-nums">
                    {parseFloat(String(highlightedItem.quantity)).toLocaleString('pl-PL')} {highlightedItem.product_unit}
                  </span>
                )}
              </div>
            )}
            {items.length > 0 && (
              <svg viewBox="0 0 24 24" fill="none" className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expanded && 'rotate-180')} stroke="currentColor" strokeWidth={2}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </button>
      </div>
      {expanded && items.length > 0 && (
        <div className="border-t border-border/40 bg-muted/20 px-3 pb-2 pt-1.5">
          {items.map((item, i) => (
            <div key={i} className={cn('flex items-baseline justify-between gap-2 py-0.5', item.product_id === highlightProductId && 'font-medium text-primary')}>
              <span className="text-xs">{item.product_name}</span>
              <span className="text-xs tabular-nums shrink-0">
                {parseFloat(String(item.quantity)).toLocaleString('pl-PL')} {item.product_unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  highlightProductId,
  defaultCompleteImmediately,
  onSave,
  onCancel,
  saving,
}: {
  recipes: Recipe[];
  prefillRecipeId?: string;
  prefillQty?: number;
  prefillSourceOrders?: PlanningOrder[];   // planning orders with remaining_qty/scheduled_qty
  highlightProductId?: string;
  defaultCompleteImmediately?: boolean;
  onSave: (data: ProductionOrderCreate, completeImmediately: boolean) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const lockedFromPlanning = !!prefillRecipeId;
  const [completeImmediately, setCompleteImmediately] = useState(defaultCompleteImmediately ?? false);
  const [recipeId, setRecipeId] = useState(prefillRecipeId ?? '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mode, setMode] = useState<'simple' | 'batch'>('simple');
  const [qtyProduced, setQtyProduced] = useState(prefillQty ? String(prefillQty) : '');
  const [qtyManuallyEdited, setQtyManuallyEdited] = useState(false);
  const [sourceOrderIds, setSourceOrderIds] = useState<Set<string>>(new Set());
  const [sourceOrdersPrefilled, setSourceOrdersPrefilled] = useState(false);
  const [notes, setNotes] = useState('');
  const { data: ordersData } = useOrderListQuery(1, { status: 'confirmed', page_size: 100 });

  const inputClass = cn(
    'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
    'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  );

  // Build a map from customer order UUID → PlanningOrder (for remaining_qty / scheduled_qty)
  const planningOrderMap = useMemo(() => {
    const map = new Map<string, PlanningOrder>();
    for (const po of prefillSourceOrders ?? []) map.set(po.order_id, po);
    return map;
  }, [prefillSourceOrders]);

  // Filter customer orders from orders API to only those relevant for this product
  const allOrders = (ordersData?.results ?? []).filter((o) => {
    if (prefillSourceOrders?.length) {
      // When coming from planning: show only orders that are in the planning list
      return prefillSourceOrders.some((po) => po.order_id === o.id);
    }
    if (highlightProductId) return (o.items ?? []).some((i) => i.product_id === highlightProductId);
    return true;
  });

  useEffect(() => {
    if (sourceOrdersPrefilled || !prefillSourceOrders?.length || !ordersData?.results) return;
    // Pre-select orders that have remaining qty (not fully scheduled)
    const matched = new Set(
      ordersData.results
        .filter((o) => {
          const po = planningOrderMap.get(o.id);
          return po != null && Number(po.remaining_qty) > 0;
        })
        .map((o) => o.id)
    );
    if (matched.size > 0) {
      setSourceOrderIds(matched);
      setSourceOrdersPrefilled(true);
    }
  }, [ordersData, prefillSourceOrders, sourceOrdersPrefilled, planningOrderMap]);

  // Recalculate qty from checked orders using remaining_qty from planning data
  useEffect(() => {
    if (qtyManuallyEdited || sourceOrderIds.size === 0) return;
    let total = 0;
    for (const id of sourceOrderIds) {
      const po = planningOrderMap.get(id);
      if (po) {
        total += Number(po.remaining_qty);
      } else if (highlightProductId) {
        // Fallback: use item quantity from customer order data
        const o = allOrders.find((x) => x.id === id);
        const item = o?.items?.find((i) => i.product_id === highlightProductId);
        if (item) total += parseFloat(String(item.quantity));
      }
    }
    if (total > 0) setQtyProduced(String(Math.ceil(total)));
  }, [sourceOrderIds, planningOrderMap, highlightProductId, qtyManuallyEdited]);

  // Auto-update notes from checked orders
  useEffect(() => {
    if (!highlightProductId && !prefillSourceOrders?.length) return;
    const checked = allOrders.filter((o) => sourceOrderIds.has(o.id));
    if (checked.length > 0) {
      setNotes(`Dla zamówień: ${checked.map((o) => o.order_number ?? o.id).join(', ')}`);
    }
  }, [sourceOrderIds, highlightProductId, prefillSourceOrders]);

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
    const totalQty = Number(qtyProduced);
    // Build source_orders with quantities
    const sourceOrdersPayload = [...sourceOrderIds].map((id) => {
      const po = planningOrderMap.get(id);
      // Use remaining_qty from planning if available; otherwise use the produced qty
      const qty = po != null ? Math.min(Number(po.remaining_qty), totalQty) : totalQty;
      return { order: id, quantity: qty };
    });
    const payload: ProductionOrderCreate = {
      recipe: recipeId,
      date,
      mode,
      quantity_produced: totalQty,
      source_orders: sourceOrdersPayload.length > 0 ? sourceOrdersPayload : undefined,
      notes,
    };
    if (mode === 'batch') {
      payload.inputs = batchInputs
        .filter((r) => r.ingredient && Number(r.quantity_used) > 0)
        .map((r) => ({ ingredient: r.ingredient, quantity_used: Number(r.quantity_used), unit: r.ingredient_unit }));
    }
    onSave(payload, completeImmediately);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tryb</label>
        <div className="flex gap-2">
          {(['simple', 'batch'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                mode === m
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              {m === 'simple' ? 'Prosty (wg receptury)' : 'Wsad (ręczne ilości)'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Ilość wyrobów *
          {highlightProductId && !qtyManuallyEdited && (
            <span className="ml-1.5 font-normal text-slate-400">— obliczone z zaznaczonych zamówień</span>
          )}
        </label>
        <input
          type="number"
          min="0"
          step="any"
          className={inputClass}
          value={qtyProduced}
          onChange={(e) => { setQtyProduced(e.target.value); setQtyManuallyEdited(true); }}
          required
        />
      </div>

      {mode === 'batch' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Surowce użyte w wsadzie</label>
          {batchInputs.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                className={cn(inputClass, 'flex-1')}
                value={row.ingredient}
                onChange={(e) => updateBatchIngredient(idx, e.target.value)}
              >
                <option value="">— surowiec —</option>
                {allProducts.filter((p) => p.product_type === 'material' || p.product_type === 'trade').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                placeholder={row.ingredient_unit || 'ilość'}
                className={cn(inputClass, 'w-24')}
                value={row.quantity_used}
                onChange={(e) => updateBatchRow(idx, e.target.value)}
              />
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => removeBatchRow(idx)}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={addBatchRow}
          >
            + Dodaj surowiec
          </button>
        </div>
      )}

      {allOrders.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Powiązane zamówienia</label>
          <div className="divide-y divide-border rounded-lg border border-border">
            {allOrders.map((o) => {
              const po = planningOrderMap.get(o.id);
              return (
                <SourceOrderRow
                  key={o.id}
                  order={o}
                  checked={sourceOrderIds.has(o.id)}
                  highlightProductId={highlightProductId}
                  scheduledQty={po ? Number(po.scheduled_qty) : undefined}
                  totalQty={po ? Number(po.quantity) : undefined}
                  onToggle={() =>
                    setSourceOrderIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(o.id)) next.delete(o.id);
                      else next.add(o.id);
                      return next;
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Notatki</label>
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center gap-2.5">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={completeImmediately}
            onChange={(e) => setCompleteImmediately(e.target.checked)}
          />
          <span className="text-sm text-slate-700">Zakończ produkcję od razu (wystaw RW+PW)</span>
        </label>
        <div className="group relative">
          <svg className="h-4 w-4 shrink-0 cursor-help text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01" strokeLinecap="round"/>
          </svg>
          <div className="absolute bottom-full left-1/2 z-50 mb-1 w-56 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 opacity-0 shadow-apple-md transition-opacity group-hover:opacity-100 group-hover:delay-150">
            Możesz ustawić to na stałe w{' '}
            <Link to="/settings/company" className="font-medium text-primary hover:underline">
              Ustawienia → Przepływ dokumentów
            </Link>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !recipeId || !qtyProduced}>
          {saving
            ? 'Zapisywanie…'
            : completeImmediately
              ? 'Zatwierdź i zakończ'
              : 'Zatwierdź zlecenie'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  canProduction,
  onComplete,
  onDelete,
  completing,
  deleting,
}: {
  order: ProductionOrder;
  canProduction: boolean;
  onComplete: (id: string) => Promise<ProductionOrder>;
  onDelete: (id: string) => Promise<void>;
  completing: boolean;
  deleting: boolean;
}) {
  const isCompleted = order.status === 'completed';
  const [completedData, setCompletedData] = useState<ProductionOrder | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);

  const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

  return (
    <div className={cn(
      'rounded-xl border p-4',
      isCompleted ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/40',
    )}>
      {completedData && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-green-400/40 bg-green-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <p className="text-sm font-semibold text-green-800">Produkcja zatwierdzona!</p>
            </div>
            <p className="text-xs text-green-700">
              RW: {completedData.rw_document_number ?? '—'} · PW: {completedData.pw_document_number ?? '—'}
              {completedData.real_unit_cost !== null && (
                <> · Koszt/szt.: {plnFmt.format(Number(completedData.real_unit_cost))}</>
              )}
            </p>
          </div>
          <button type="button" onClick={() => setCompletedData(null)} className="self-start rounded-lg px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100 sm:self-auto">
            Zamknij
          </button>
        </div>
      )}

      {completeError && (() => {
        const match = completeError.match(/dla '([^']+)':/);
        const productName = match?.[1];
        return (
          <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            {completeError}
            {productName && (
              <Link
                to={`/products?search=${encodeURIComponent(productName)}`}
                className="ml-2 inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-white/60 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-white"
              >
                Uzupełnij stan →
              </Link>
            )}
          </div>
        );
      })()}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{order.order_number}</span>
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
          {order.notes && !order.source_orders_info?.length ? <p className="mt-0.5 text-xs text-muted-foreground">{order.notes}</p> : null}
          {isCompleted && order.real_unit_cost !== null && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Koszt/szt.: {plnFmt.format(Number(order.real_unit_cost))} · Łączny: {plnFmt.format(Number(order.total_input_cost))}
            </p>
          )}
          {order.source_orders_info?.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="text-muted-foreground">Zamówienia:</span>
              {order.source_orders_info.map((o) => (
                <Link
                  key={o.id}
                  to={`/orders/${o.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {o.order_number ?? o.id.slice(0, 8)}
                  {o.customer_name ? ` (${o.customer_name})` : ''}
                </Link>
              ))}
            </div>
          )}
          {isCompleted && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              RW: {order.rw_document_number ?? '—'} · PW: {order.pw_document_number ?? '—'}
            </p>
          )}

          {order.recipe_items?.length > 0 && order.mode === 'simple' && (
            <div className="mt-1.5">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setIngredientsOpen((v) => !v)}
              >
                <svg className={cn('h-3 w-3 transition-transform', ingredientsOpen && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Składniki ({order.recipe_items.length})
              </button>
              {ingredientsOpen && (
                <ul className="mt-1 space-y-0 text-xs text-muted-foreground">
                  {order.recipe_items.map((item) => (
                    <li key={item.ingredient_name}>
                      {item.ingredient_name}: <span className="font-medium text-foreground">{Number(item.quantity_needed).toLocaleString('pl-PL', { maximumFractionDigits: 4 })} {item.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {order.mode === 'batch' && order.inputs.length > 0 && (
            <ul className="mt-1 space-y-0 text-xs text-muted-foreground">
              {order.inputs.map((inp) => (
                <li key={inp.id}>
                  {inp.ingredient_name}: {inp.quantity_used} {inp.unit}
                  {inp.fifo_cost !== null && <span className="ml-1">({plnFmt.format(Number(inp.fifo_cost))})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {canProduction && !isCompleted && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button
              size="sm"
              disabled={completing}
              onClick={() => {
                setCompleteError(null);
                onComplete(order.id)
                  .then((data) => setCompletedData(data))
                  .catch((e: unknown) => {
                    setCompleteError(e instanceof Error ? e.message : 'Błąd zakończenia zlecenia.');
                  });
              }}
            >
              {completing ? '…' : 'Zakończ'}
            </Button>
            <button
              type="button"
              className="rounded-xl border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={deleting}
              onClick={() => void onDelete(order.id)}
            >
              {deleting ? '…' : 'Usuń'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Planning item row (with expandable ingredients) ──────────────────────────

function PlanningItem({
  item,
  isSelected,
  stockTracked,
  hasShortfall,
  draftInProd,
  allInProduction,
  canManage,
  onToggle,
  onOpenModal,
}: {
  item: ProductionPlanningItem;
  isSelected: boolean;
  stockTracked: boolean;
  hasShortfall: boolean;
  draftInProd: number;
  allInProduction: boolean;
  canManage: boolean;
  onToggle: () => void;
  onOpenModal: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasIngredients = item.ingredients.length > 0;

  return (
    <div className={cn('transition-colors', allInProduction ? 'opacity-50' : isSelected && 'bg-primary/5')}>
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary shrink-0"
          checked={isSelected && !allInProduction}
          disabled={allInProduction}
          onChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{item.product_name}</span>
            {stockTracked && hasShortfall && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                niedobór {n2.format(Number(item.shortfall))} {item.product_unit}
              </span>
            )}
            {stockTracked && !hasShortfall && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                stan ok
              </span>
            )}
            {allInProduction && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                wszystkie zamówienia w produkcji
              </span>
            )}
            {!allInProduction && draftInProd > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                w produkcji: {n2.format(draftInProd)} {item.product_unit}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Do zaplanowania: <strong className="text-slate-800">{n2.format(Number(item.suggested_production_qty))} {item.product_unit}</strong>
            {Number(item.already_scheduled) > 0 && (
              <> · Łącznie: <strong className="text-slate-800">{n2.format(Number(item.total_ordered))} {item.product_unit}</strong></>
            )}
            {stockTracked && (
              <> · Stan: <strong className="text-slate-800">{n2.format(Number(item.stock_available))} {item.product_unit}</strong></>
            )}
            {item.estimated_total_cost != null && Number(item.estimated_total_cost) > 0 && (
              <> · Koszt: <strong className="text-slate-800">{pln.format(Number(item.estimated_total_cost))}</strong></>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canManage && !allInProduction && (
            <button
              type="button"
              className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
              onClick={onOpenModal}
            >
              zmień ilość
            </button>
          )}
          {hasIngredients && (
            <button
              type="button"
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                expanded
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
              )}
              onClick={() => setExpanded((v) => !v)}
            >
              surowce
              <svg
                className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {expanded && hasIngredients && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-3 pt-2 md:px-6">
          <div className="space-y-1">
            {item.ingredients.map((ing) => (
              <div key={ing.ingredient_id} className="flex items-center justify-between gap-3">
                <span className={cn('text-xs', !ing.has_enough_stock ? 'font-medium text-red-700' : 'text-slate-600')}>
                  {ing.ingredient_name}
                  {!ing.has_enough_stock && (
                    <span className="ml-1 text-red-400">— za mało!</span>
                  )}
                </span>
                <div className="shrink-0 text-right">
                  <span className={cn('text-xs font-medium tabular-nums', !ing.has_enough_stock ? 'text-red-700' : 'text-slate-800')}>
                    {n2.format(Number(ing.quantity_needed))} {ing.ingredient_unit}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    (stan: {n2.format(Number(ing.stock_available))})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ingredients summary (aggregate across all selected items) ─────────────────

type IngredientSummaryRow = {
  id: string;
  name: string;
  unit: string;
  totalNeeded: number;
  stockAvailable: number;
  hasEnough: boolean;
  sources: { productName: string; qty: number }[];
};

function IngredientsSummary({ items, totalCount }: { items: ProductionPlanningItem[]; totalCount: number }) {
  const [open, setOpen] = useState(true);
  const summary = useMemo(() => {
    const map = new Map<string, IngredientSummaryRow>();
    for (const item of items) {
      for (const ing of item.ingredients) {
        const existing = map.get(ing.ingredient_id);
        const qty = Number(ing.quantity_needed);
        if (existing) {
          existing.totalNeeded += qty;
          existing.sources.push({ productName: item.product_name, qty });
          // has_enough is per-item; recalculate against stock
          existing.hasEnough = existing.stockAvailable >= existing.totalNeeded;
        } else {
          map.set(ing.ingredient_id, {
            id: ing.ingredient_id,
            name: ing.ingredient_name,
            unit: ing.ingredient_unit,
            totalNeeded: qty,
            stockAvailable: Number(ing.stock_available),
            hasEnough: Number(ing.stock_available) >= qty,
            sources: [{ productName: item.product_name, qty }],
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => (a.hasEnough ? 1 : -1) - (b.hasEnough ? 1 : -1));
  }, [items]);

  if (summary.length === 0) return null;

  const missing = summary.filter((r) => !r.hasEnough);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50/60 md:px-6"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-900">Potrzebne surowce</span>
          <p className="text-xs text-slate-400">
            {items.length === totalCount
              ? `dla wszystkich ${totalCount} produktów`
              : `dla ${items.length} z ${totalCount} zaznaczonych`}
          </p>
        </div>
        {missing.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {missing.length} za mało
          </span>
        )}
        <svg
          className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {summary.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
              <div>
                <p className={cn('text-sm font-medium', !row.hasEnough ? 'text-red-700' : 'text-slate-800')}>
                  {row.name}
                  {!row.hasEnough && (
                    <span className="ml-2 text-xs font-normal text-red-500">
                      brakuje {n2.format(row.totalNeeded - row.stockAvailable)} {row.unit}
                    </span>
                  )}
                </p>
                {row.sources.length > 1 && (
                  <p className="text-xs text-slate-400">
                    {row.sources.map((s) => `${s.productName}: ${n2.format(s.qty)} ${row.unit}`).join(' + ')}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={cn('text-sm font-semibold tabular-nums', !row.hasEnough ? 'text-red-700' : 'text-slate-900')}>
                  {n2.format(row.totalNeeded)} {row.unit}
                </p>
                <p className="text-xs text-slate-400">stan: {n2.format(row.stockAvailable)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PlanTab = 'today' | 'open' | 'range';
type FormState =
  | { open: false }
  | { open: true; prefillRecipeId?: string; prefillQty?: number; prefillSourceOrders?: PlanningOrder[]; highlightProductId?: string; error?: string };

export function ProductionOrdersPage() {
  const canProduction = usePermission('can_manage_production');

  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const today = format(new Date(), 'yyyy-MM-dd');

  const [tab, setTab] = useState<PlanTab>('today');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(true);
  const [completedOrdersOpen, setCompletedOrdersOpen] = useState(false);
  const [page] = useState(1);
  const [form, setForm] = useState<FormState>({ open: false });
  const [bulkCreating, setBulkCreating] = useState(false);
  const [completionResult, setCompletionResult] = useState<ProductionOrder | null>(null);

  const planningParams = useMemo(() => {
    if (tab === 'today') return { date_from: today, date_to: today };
    if (tab === 'open') return {};
    return { date_from: dateFrom, date_to: dateTo };
  }, [tab, today, dateFrom, dateTo]);

  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const { data: workflowSettings } = useWorkflowSettingsQuery(companyId || undefined);
  const defaultCompleteImmediately = workflowSettings?.production_complete_immediately ?? false;

  const { data: ordersData, isLoading: ordersLoading } = useProductionOrdersQuery(page);
  const { data: recipes = [] } = useRecipesQuery();
  const { data: planningItems = [], isLoading: planningLoading } = useProductionPlanningQuery(planningParams);

  const createM = useCreateProductionOrderMutation();
  const completeM = useCompleteProductionOrderMutation();
  const deleteM = useDeleteProductionOrderMutation();

  const orders = ordersData?.results ?? [];
  const activeOrders = orders.filter((o) => o.status !== 'completed');
  const completedOrders = orders.filter((o) => o.status === 'completed').slice(0, 10);

  // Auto-switch from "Dziś" to "Otwarte" when today has no items
  useEffect(() => {
    if (tab === 'today' && !planningLoading && planningItems.length === 0) {
      setTab('open');
    }
  }, [tab, planningLoading, planningItems.length]);

  // Items that are schedulable (not all orders fully scheduled)
  const schedulableItems = planningItems.filter(
    (i) => !(i.orders.length > 0 && i.orders.every((o) => Number(o.remaining_qty) <= 0))
  );

  // Auto-select all schedulable items when plan loads or tab changes
  useEffect(() => {
    if (!planningLoading && planningItems.length > 0) {
      setSelectedRecipeIds(new Set(schedulableItems.map((i) => i.recipe_id)));
    }
  }, [planningItems]);

  const selectedItems = planningItems.filter((i) => selectedRecipeIds.has(i.recipe_id));

  function toggleItem(recipeId: string) {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }

  function toggleAll() {
    if (selectedRecipeIds.size === schedulableItems.length) {
      setSelectedRecipeIds(new Set());
    } else {
      setSelectedRecipeIds(new Set(schedulableItems.map((i) => i.recipe_id)));
    }
  }

  async function handleCreate(data: ProductionOrderCreate, completeImmediately = false) {
    try {
      const created = await createM.mutateAsync(data);
      if (completeImmediately) {
        const completed = await completeM.mutateAsync(created.id);
        setCompletionResult(completed);
      }
      setForm({ open: false });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Błąd zapisu zlecenia.';
      setForm((prev) => prev.open ? { ...prev, error: msg } : prev);
    }
  }

  async function handleBulkCreate() {
    if (selectedItems.length === 0) return;
    setBulkCreating(true);
    try {
      for (const item of selectedItems) {
        const ordersWithRemaining = item.orders.filter((o) => Number(o.remaining_qty) > 0);
        if (ordersWithRemaining.length === 0) continue;
        const qty = Number(item.suggested_production_qty);
        if (qty <= 0) continue;
        await createM.mutateAsync({
          recipe: item.recipe_id,
          date: tab === 'today' ? today : format(new Date(), 'yyyy-MM-dd'),
          mode: 'simple',
          quantity_produced: Math.ceil(qty),
          source_orders: ordersWithRemaining.map((o) => ({
            order: o.order_id,
            quantity: Number(o.remaining_qty),
          })),
          notes: `Dla zamówień: ${ordersWithRemaining.map((o) => o.order_number).join(', ')}`,
        });
      }
    } finally {
      setBulkCreating(false);
    }
  }

  function openFormFromPlanning(recipeId: string, qty: number, sourceOrders: string[]) {
    setForm({ open: true, prefillRecipeId: recipeId, prefillQty: Math.ceil(qty), prefillSourceOrders: sourceOrders });
    setTimeout(() => document.getElementById('production-form')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const allSelected = schedulableItems.length > 0 && selectedRecipeIds.size === schedulableItems.length;
  const someSelected = selectedRecipeIds.size > 0 && !allSelected;

  const tabs: { id: PlanTab; label: string }[] = [
    { id: 'today', label: 'Dziś' },
    { id: 'open', label: 'Otwarte' },
    { id: 'range', label: 'Zakres dat' },
  ];

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-slate-900 md:text-xl">Produkcja</h1>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── LEFT COLUMN: plan + surowce ── */}
        <div className="flex flex-col gap-3 lg:min-w-0 lg:flex-1">

      {/* ── Plan section ── */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-100 px-4 pt-3 md:px-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Date range picker for "Zakres" tab */}
        {tab === 'range' && (
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 md:px-6">
            <input
              type="date"
              className="h-8 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className="text-xs text-slate-400">—</span>
            <input
              type="date"
              className="h-8 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        )}

        {/* Header row with select-all + Zatwierdź */}
        {!planningLoading && planningItems.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
              />
              <span className="text-sm text-slate-600">
                {selectedRecipeIds.size > 0
                  ? `Zaznaczono ${selectedRecipeIds.size} z ${schedulableItems.length}`
                  : 'Zaznacz wszystkie'}
              </span>
            </label>
            {canProduction && selectedItems.length > 0 && (
              <Button
                size="sm"
                disabled={bulkCreating}
                onClick={() => void handleBulkCreate()}
              >
                {bulkCreating ? 'Zatwierdzanie…' : `Zatwierdź produkcję (${selectedItems.length})`}
              </Button>
            )}
          </div>
        )}

        {/* Planning items */}
        {planningLoading && <p className="px-4 py-6 text-sm text-slate-400">Ładowanie…</p>}
        {!planningLoading && planningItems.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-400">
            {tab === 'today'
              ? 'Brak zamówień na dziś z recepturami.'
              : 'Brak otwartych zamówień na wyroby z recepturami.'}
          </p>
        )}
        {!planningLoading && planningItems.length > 0 && (
          <div className="divide-y divide-slate-100">
            {planningItems.map((item) => {
              const isSelected = selectedRecipeIds.has(item.recipe_id);
              const stockTracked = item.stock_available != null;
              const hasShortfall = stockTracked && Number(item.shortfall) > 0;
              const draftInProd = orders
                .filter((o) => o.status !== 'completed' && o.recipe === item.recipe_id)
                .reduce((sum, o) => sum + Number(o.quantity_produced), 0);
              // Use fresh activeOrders data to determine in-production status
              const allFullyScheduled = item.orders.length > 0 && item.orders.every((o) => Number(o.remaining_qty) <= 0);

              return (
                <PlanningItem
                  key={item.recipe_id}
                  item={item}
                  isSelected={isSelected}
                  stockTracked={stockTracked}
                  hasShortfall={hasShortfall}
                  draftInProd={draftInProd}
                  allInProduction={allFullyScheduled}
                  canManage={canProduction}
                  onToggle={() => toggleItem(item.recipe_id)}
                  onOpenModal={() => setForm({
                    open: true,
                    prefillRecipeId: item.recipe_id,
                    prefillQty: Math.ceil(Number(item.suggested_production_qty)),
                    prefillSourceOrders: item.orders,
                    highlightProductId: item.product_id,
                  })}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ── Ingredients summary — reacts to checkboxes ── */}
      {selectedItems.length > 0 && <IngredientsSummary items={selectedItems} totalCount={planningItems.length} />}

        </div>{/* end left column */}

        {/* ── RIGHT COLUMN: zlecenia ── */}
        <div className="flex flex-col gap-3 lg:w-[480px] lg:shrink-0">

      {/* ── Active orders (collapsible) ── */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        <div className="flex w-full items-center justify-between px-4 py-3.5 md:px-6">
          <button
            type="button"
            className="flex flex-1 items-center gap-2 text-left"
            onClick={() => setActiveOrdersOpen((v) => !v)}
          >
            <span className="text-sm font-semibold text-slate-900">Aktywne zlecenia</span>
            {activeOrders.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {activeOrders.length}
              </span>
            )}
            <svg
              className={cn('ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform', activeOrdersOpen && 'rotate-180')}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {canProduction && !form.open && (
            <button
              type="button"
              className="ml-3 shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={() => setForm({ open: true })}
            >
              + Ręczne zlecenie
            </button>
          )}
        </div>

        {activeOrdersOpen && (
          <div className="border-t border-slate-100">
            {ordersLoading && <p className="px-4 py-4 text-sm text-slate-400">Ładowanie…</p>}
            {!ordersLoading && activeOrders.length === 0 && (
              <p className="px-4 py-4 text-sm text-slate-400">Brak aktywnych zleceń.</p>
            )}
            {!ordersLoading && activeOrders.length > 0 && (
              <div className="space-y-2 p-3">
                {activeOrders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    canProduction={canProduction}
                    onComplete={async (id) => { const r = await completeM.mutateAsync(id); setCompletionResult(r); }}
                    onDelete={(id) => deleteM.mutateAsync(id)}
                    completing={completeM.isPending}
                    deleting={deleteM.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {completedOrders.length > 0 && (
          <div className="border-t border-slate-100">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50/60"
              onClick={() => setCompletedOrdersOpen((v) => !v)}
            >
              <span className="text-sm font-semibold text-slate-900">Ostatnie zakończone</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {completedOrders.length}
              </span>
              <svg
                className={cn('ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform', completedOrdersOpen && 'rotate-180')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {completedOrdersOpen && (
              <div className="space-y-2 p-3">
                {completedOrders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    canProduction={canProduction}
                    onComplete={async (id) => { const r = await completeM.mutateAsync(id); setCompletionResult(r); }}
                    onDelete={(id) => deleteM.mutateAsync(id)}
                    completing={completeM.isPending}
                    deleting={deleteM.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

        </div>{/* end right column */}
      </div>{/* end two-column layout */}

      {/* ── Manual order modal ── */}
      {form.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setForm({ open: false })} />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-apple-float md:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <p className="text-sm font-semibold text-slate-900">
                {form.prefillRecipeId ? 'Zmień zlecenie produkcji' : 'Nowe zlecenie produkcji'}
              </p>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                onClick={() => setForm({ open: false })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            {form.open && form.error && (
              <div className="mx-5 mt-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                {form.error}
              </div>
            )}
            <div className="max-h-[70vh] overflow-y-auto p-5">
              <OrderForm
                recipes={recipes}
                prefillRecipeId={form.open ? form.prefillRecipeId : undefined}
                prefillQty={form.open ? form.prefillQty : undefined}
                prefillSourceOrders={form.open ? form.prefillSourceOrders : undefined}
                highlightProductId={form.open ? form.highlightProductId : undefined}
                defaultCompleteImmediately={defaultCompleteImmediately}
                onSave={(d, complete) => void handleCreate(d, complete)}
                onCancel={() => setForm({ open: false })}
                saving={createM.isPending}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Completion success modal ── */}
      {completionResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCompletionResult(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-apple-float md:rounded-3xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-base font-semibold text-slate-900">Produkcja zakończona!</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{completionResult.finished_product_name}</p>
            <p className="text-xs text-slate-400">{completionResult.order_number}</p>
            <div className="mt-4 space-y-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Wyprodukowano</span>
                <span className="font-semibold text-slate-900">
                  {n2.format(Number(completionResult.quantity_produced))} szt.
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RW (rozchód surowców)</span>
                <span className="font-medium text-slate-900">{completionResult.rw_document_number ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">PW (przychód wyrobów)</span>
                <span className="font-medium text-slate-900">{completionResult.pw_document_number ?? '—'}</span>
              </div>
              {completionResult.real_unit_cost !== null && (
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="text-slate-500">Koszt jednostkowy</span>
                  <span className="font-semibold text-slate-900">
                    {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(completionResult.real_unit_cost))}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-2xl bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
              onClick={() => setCompletionResult(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

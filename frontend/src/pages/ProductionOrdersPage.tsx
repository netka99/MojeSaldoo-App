import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useProductionOrdersQuery,
  useProductionOrdersListQuery,
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
import { productionService } from '@/services/production.service';
import { usePermission } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';
import { ReportExpandIcon } from '@/lib/reportSurface';
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
  const [isStockProduction, setIsStockProduction] = useState(false);
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
  // Cap at prefillQty when provided (suggested_production_qty already accounts for stock on hand)
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
    if (total > 0) {
      const capped = prefillQty != null ? Math.min(Math.ceil(total), prefillQty) : Math.ceil(total);
      setQtyProduced(String(capped));
    }
  }, [sourceOrderIds, planningOrderMap, highlightProductId, qtyManuallyEdited, prefillQty]);

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
      is_stock_production: sourceOrdersPayload.length === 0 ? isStockProduction : false,
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
        <label className="text-xs font-medium text-muted-foreground">Ilość wyrobów *</label>
        <input
          type="number"
          min="0"
          step="any"
          className={inputClass}
          value={qtyProduced}
          onChange={(e) => { setQtyProduced(e.target.value); setQtyManuallyEdited(true); }}
          required
        />
        {/* Na zapas — tylko gdy ilość > suma zamówień */}
        {(() => {
          const total = Number(qtyProduced) || 0;
          const fromOrders = [...sourceOrderIds].reduce((s, id) => {
            const po = planningOrderMap.get(id);
            return s + (po ? Number(po.remaining_qty) : 0);
          }, 0);
          const onStock = Math.max(0, total - fromOrders);
          if (onStock <= 0) return null;
          return (
            <p className="pt-0.5 text-xs font-medium text-amber-600">+{n2.format(onStock)} {selectedRecipe?.product_unit} na zapas</p>
          );
        })()}
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


      {/* Na zapas toggle — only shown when no source orders are linked */}
      {sourceOrderIds.size === 0 && !prefillSourceOrders?.length && (
        <div className="flex items-center gap-2.5">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={isStockProduction}
              onChange={(e) => setIsStockProduction(e.target.checked)}
            />
            <span className="text-sm text-slate-700">Produkcja na zapas (bez powiązania z zamówieniem)</span>
          </label>
        </div>
      )}

      {/* Notatki — zwinięte domyślnie */}
      <details className="group">
        <summary className="cursor-pointer list-none">
          <span className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600">
            <svg className="h-3 w-3 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Notatki
          </span>
        </summary>
        <div className="mt-1.5">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </details>

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
  const [qtyInput, setQtyInput] = useState('');
  const [showQtyInput, setShowQtyInput] = useState(false);

  const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

  async function handleComplete() {
    setCompleteError(null);
    // If quantity not yet set, ask first
    if (Number(order.quantity_produced) <= 0 && !showQtyInput) {
      setShowQtyInput(true);
      return;
    }
    try {
      if (showQtyInput) {
        const qty = Number(qtyInput);
        if (!qty || qty <= 0) { setCompleteError('Podaj ilość większą od zera.'); return; }
        await productionService.patchOrder(order.id, { quantity_produced: qty });
      }
      const data = await onComplete(order.id);
      setCompletedData(data);
      setShowQtyInput(false);
      setQtyInput('');
    } catch (e: unknown) {
      setCompleteError(e instanceof Error ? e.message : 'Błąd zakończenia zlecenia.');
    }
  }

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
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            <span className="flex-1">
              {completeError}
              {productName && (
                <Link
                  to={`/products?search=${encodeURIComponent(productName)}`}
                  className="ml-2 inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-white/60 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-white"
                >
                  Uzupełnij stan →
                </Link>
              )}
            </span>
            <button type="button" onClick={() => setCompleteError(null)} className="shrink-0 text-destructive/60 hover:text-destructive" aria-label="Zamknij">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })()}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/production/orders/${order.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {order.order_number}
            </Link>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              isCompleted ? 'bg-green-100 text-green-700' : order.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700',
            )}>
              {isCompleted ? 'Zakończone' : order.status === 'in_progress' ? 'W toku' : 'Szkic'}
            </span>
            <span className="text-xs text-muted-foreground">
              {order.mode === 'batch' ? 'wsad' : 'prosty'}
            </span>
          </div>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{order.finished_product_name}</span>
            {Number(order.quantity_produced) > 0 && (
              <> {' — '}<span className="font-semibold">{order.quantity_produced}</span> {order.finished_product_unit}</>
            )}
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
                <ReportExpandIcon open={ingredientsOpen} />
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
            {showQtyInput && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Ilość szt."
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleComplete(); if (e.key === 'Escape') { setShowQtyInput(false); setQtyInput(''); } }}
                />
                <Button size="sm" disabled={completing} onClick={() => void handleComplete()}>
                  {completing ? '…' : 'OK'}
                </Button>
              </div>
            )}
            {!showQtyInput && (
              <Button size="sm" disabled={completing} onClick={() => void handleComplete()}>
                {completing ? '…' : 'Zakończ'}
              </Button>
            )}
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
  isCovered,
  customQty,
  onCustomQtyChange,
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
  isCovered?: boolean;
  customQty?: number;
  onCustomQtyChange?: (qty: number) => void;
  onToggle: () => void;
  onOpenModal: (selectedOrders: PlanningOrder[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [showQtyInput, setShowQtyInput] = useState(false);
  const [qtyInputVal, setQtyInputVal] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(item.orders.filter((o) => Number(o.remaining_qty) > 0).map((o) => o.order_id))
  );
  const hasIngredients = item.ingredients.length > 0;
  const showCheckbox = !isCovered || (customQty != null && customQty > 0);
  const showIngredients = hasIngredients && (!isCovered || (customQty != null && customQty > 0));

  function commitCustomQty() {
    const v = parseFloat(qtyInputVal.replace(',', '.'));
    if (!isNaN(v) && v > 0) {
      onCustomQtyChange?.(v);
    } else {
      onCustomQtyChange?.(0);
    }
    setShowQtyInput(false);
  }

  return (
    <div className={cn('rounded-xl border border-slate-200 transition-colors', allInProduction ? 'opacity-50' : isSelected ? 'bg-primary/5 border-primary/20' : 'bg-white')}>
      <div className="flex items-center gap-3 px-4 py-3.5 md:px-6">
        {/* Expand arrow */}
        <button
          type="button"
          className="shrink-0 text-slate-400 hover:text-slate-600"
          onClick={() => setDetailsExpanded((v) => !v)}
        >
          <svg className={cn('h-4 w-4 transition-transform', detailsExpanded && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Checkbox — always shown for schedulable, shown for covered only when customQty > 0 */}
        {showCheckbox ? (
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary shrink-0"
            checked={isSelected && !allInProduction}
            disabled={allInProduction}
            onChange={onToggle}
          />
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
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
            {isCovered && customQty != null && customQty > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                na zapas: {n2.format(customQty)} {item.product_unit}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Do zlecenia: <strong className="text-slate-800">{n2.format(Number(item.suggested_production_qty))} {item.product_unit}</strong>
            {' · '}Z zamówień: <strong className="text-slate-800">{n2.format(item.orders.reduce((s, o) => s + Number(o.remaining_qty), 0))} {item.product_unit}</strong>
            {stockTracked && (
              <> · Stan: <strong className="text-slate-800">{n2.format(Number(item.stock_available))} {item.product_unit}</strong></>
            )}
            {item.estimated_total_cost != null && Number(item.estimated_total_cost) > 0 && (
              <> · Koszt: <strong className="text-slate-800">{pln.format(Number(item.estimated_total_cost))}</strong></>
            )}
          </p>
          {/* Inline qty input for covered items */}
          {isCovered && canManage && showQtyInput && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="1"
                step="1"
                autoFocus
                className="h-7 w-24 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Ilość"
                value={qtyInputVal}
                onChange={(e) => setQtyInputVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitCustomQty(); if (e.key === 'Escape') setShowQtyInput(false); }}
              />
              <span className="text-xs text-slate-500">{item.product_unit}</span>
              <button
                type="button"
                className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary/90"
                onClick={commitCustomQty}
              >
                OK
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-600"
                onClick={() => setShowQtyInput(false)}
              >
                Anuluj
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canManage && !allInProduction && isCovered && (
            <button
              type="button"
              className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
              onClick={() => { setQtyInputVal(customQty ? String(customQty) : ''); setShowQtyInput((v) => !v); }}
            >
              {customQty && customQty > 0 ? 'zmień ilość' : '+ na zapas'}
            </button>
          )}
          {showIngredients && (
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

      {/* ── Surowce (inline pod headerem) ── */}
      {expanded && showIngredients && (
        <div className="border-t border-emerald-100 bg-emerald-50/40 px-4 pb-4 pt-3 md:px-10">
          {(() => {
            const baseProdQty = Number(item.suggested_production_qty);
            const totalProdQty = baseProdQty + (customQty ?? 0);
            const yieldQty = Number(item.recipe_yield_quantity) || 1;
            const batchesNeeded = totalProdQty / yieldQty;
            return (
              <div className="overflow-hidden rounded-lg border border-emerald-200">
                <div className="flex items-center justify-between border-b border-emerald-200 bg-white px-4 py-1.5">
                  <span className="text-xs font-semibold text-emerald-700">Surowce</span>
                  <span className="text-xs text-slate-400">dla {n2.format(totalProdQty)} {item.product_unit}</span>
                </div>
                <div className="divide-y divide-emerald-100 bg-white">
                  {item.ingredients.map((ing) => {
                    const qtyNeeded = Number(ing.quantity_per_batch) * batchesNeeded;
                    const stockAvail = Number(ing.stock_available);
                    const hasEnough = stockAvail >= qtyNeeded;
                    return (
                      <div key={ing.ingredient_id} className="flex items-center justify-between gap-3 px-4 py-2">
                        <span className={cn('text-xs', !hasEnough ? 'font-medium text-red-700' : 'text-slate-600')}>
                          {ing.ingredient_name}
                          {!hasEnough && <span className="ml-1.5 font-normal text-red-400">— za mało!</span>}
                        </span>
                        <div className="shrink-0 text-right">
                          <span className={cn('text-xs font-semibold tabular-nums', !hasEnough ? 'text-red-700' : 'text-slate-800')}>
                            {n2.format(qtyNeeded)} {ing.ingredient_unit}
                          </span>
                          <span className="ml-2 text-xs text-slate-400">stan: {n2.format(stockAvail)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Szczegóły zamówień ── */}
      {detailsExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-4 pb-4 pt-3 md:px-10">
          <div className="flex flex-col gap-3">

            {/* Zamówienia klientów z checkboxami */}
            {item.orders.length > 0 && (
              <div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Zamówienia klientów</span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{n2.format(item.orders.reduce((s, o) => s + Number(o.remaining_qty), 0))} {item.product_unit}</span>
                  </div>
                  {item.orders.map((o) => {
                    const fullyInProd = o.fully_scheduled;
                    const partialInProd = o.in_production && !o.fully_scheduled;
                    return fullyInProd ? (
                      <div key={o.order_id} className="flex items-center gap-2.5 bg-blue-50/60 px-4 py-2">
                        {/* checkmark icon instead of checkbox */}
                        <svg className="h-3.5 w-3.5 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-medium text-slate-700">{o.customer_name || o.order_number}</span>
                          {o.customer_name && <span className="ml-1.5 text-xs text-slate-400">{o.order_number}</span>}
                          {o.delivery_date && <span className="ml-1.5 text-xs text-slate-400">· {o.delivery_date}</span>}
                          <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">w produkcji</span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                          {n2.format(Number(o.quantity))} {item.product_unit}
                        </span>
                      </div>
                    ) : (
                      <label key={o.order_id} className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-slate-50/60">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary shrink-0"
                          checked={selectedOrderIds.has(o.order_id)}
                          onChange={() => setSelectedOrderIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(o.order_id)) next.delete(o.order_id);
                            else next.add(o.order_id);
                            return next;
                          })}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-medium text-slate-800">{o.customer_name || o.order_number}</span>
                          {o.customer_name && <span className="ml-1.5 text-xs text-slate-400">{o.order_number}</span>}
                          {o.delivery_date && <span className="ml-1.5 text-xs text-slate-400">· {o.delivery_date}</span>}
                          {partialInProd && (
                            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                              częściowo w prod.: {n2.format(Number(o.scheduled_qty))} szt.
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">
                          {n2.format(Number(o.remaining_qty))} {item.product_unit}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {/* Przycisk otwiera form z zaznaczonymi zamówieniami */}
                {canManage && (
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
                    disabled={selectedOrderIds.size === 0}
                    onClick={() => onOpenModal(item.orders.filter((o) => selectedOrderIds.has(o.order_id)))}
                  >
                    Utwórz zlecenie ({n2.format(Number(item.suggested_production_qty))} {item.product_unit})
                  </button>
                )}
              </div>
            )}

            {/* Bilans */}
            {(() => {
              const stock = Number(item.stock_available ?? 0);
              const inProd = Number(item.already_scheduled ?? 0);
              const remainingOrdered = item.orders.reduce((s, o) => s + Number(o.remaining_qty), 0);
              // afterFulfillment = stock on hand + already in production - remaining orders
              const afterFulfillment = stock + inProd - remainingOrdered;
              const isOk = afterFulfillment >= 0;
              // unscheduled = remaining orders not yet covered by any active production order
              const unscheduled = Math.max(0, remainingOrdered - inProd);
              return (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Bilans</p>
                  <div className="divide-y divide-slate-100">
                    {item.stock_available != null && (
                      <div className="flex items-center justify-between px-4 py-2">
                        <span className="text-xs text-slate-500">Stan magazynowy</span>
                        <span className="text-xs font-semibold tabular-nums text-slate-800">
                          {n2.format(stock)} {item.product_unit}
                        </span>
                      </div>
                    )}
                    {inProd > 0 && (
                      <div className="flex items-center justify-between px-4 py-2">
                        <span className="text-xs text-slate-500">W produkcji (zlecenia draft)</span>
                        <span className="text-xs font-semibold tabular-nums text-blue-700">
                          +{n2.format(inProd)} {item.product_unit}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-4 py-2">
                      <span className="text-xs text-slate-500">Zamówienia klientów</span>
                      <span className="text-xs font-semibold tabular-nums text-slate-800">
                        −{n2.format(remainingOrdered)} {item.product_unit}
                        {inProd > 0 && unscheduled < remainingOrdered && (
                          <span className="ml-1.5 text-slate-400 font-normal">
                            ({n2.format(unscheduled)} bez pokrycia)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className={cn('flex items-center justify-between px-4 py-2', isOk ? 'bg-green-50' : 'bg-red-50')}>
                      <span className={cn('text-xs font-semibold', isOk ? 'text-green-700' : 'text-red-700')}>
                        Po realizacji
                      </span>
                      <span className={cn('text-xs font-bold tabular-nums', isOk ? 'text-green-700' : 'text-red-700')}>
                        {isOk
                          ? `+${n2.format(afterFulfillment)} ${item.product_unit} nadwyżki`
                          : `brakuje ${n2.format(Math.abs(afterFulfillment))} ${item.product_unit}`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

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

function IngredientsSummary({ items, totalCount, activeOrders }: { items: ProductionPlanningItem[]; totalCount: number; activeOrders: ProductionOrder[] }) {
  const [open, setOpen] = useState(true);

  // Check if all selected items are fully covered (nothing left to plan)
  const allFullyCovered = items.every((item) =>
    item.ingredients.every((ing) => Number(ing.quantity_needed) === 0)
  );

  const summary = useMemo(() => {
    const map = new Map<string, IngredientSummaryRow>();

    if (allFullyCovered) {
      // Show ingredients needed by active (in-production) orders instead
      for (const order of activeOrders) {
        for (const ri of (order.recipe_items ?? [])) {
          const key = ri.ingredient_name;
          const qty = Number(ri.quantity_needed);
          if (qty <= 0) continue;
          const existing = map.get(key);
          if (existing) {
            existing.totalNeeded += qty;
            existing.sources.push({ productName: order.finished_product_name ?? '', qty });
          } else {
            map.set(key, {
              id: key,
              name: ri.ingredient_name,
              unit: ri.unit,
              totalNeeded: qty,
              stockAvailable: 0,
              hasEnough: true,
              sources: [{ productName: order.finished_product_name ?? '', qty }],
            });
          }
        }
      }
    } else {
      for (const item of items) {
        for (const ing of item.ingredients) {
          const existing = map.get(ing.ingredient_id);
          const qty = Number(ing.quantity_needed);
          if (existing) {
            existing.totalNeeded += qty;
            existing.sources.push({ productName: item.product_name, qty });
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
    }
    return [...map.values()].sort((a, b) => (a.hasEnough ? 1 : -1) - (b.hasEnough ? 1 : -1));
  }, [items, allFullyCovered, activeOrders]);

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
            {allFullyCovered
              ? `dla ${activeOrders.length} aktywnych zleceń`
              : items.length === totalCount
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
  const [coveredCustomQties, setCoveredCustomQties] = useState<Map<string, number>>(new Map());
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

  // Items with remaining qty to plan — use suggested_production_qty as the source of truth
  // (remaining_qty per order can be non-zero even when active production already covers demand)
  const schedulableItems = planningItems.filter(
    (i) => Number(i.suggested_production_qty) > 0
  );
  // Items fully covered (stock ok / all in production) — shown as info only
  const coveredItems = planningItems.filter(
    (i) => Number(i.suggested_production_qty) <= 0
  );

  // Auto-select only items with actual remaining qty to plan
  useEffect(() => {
    if (!planningLoading) {
      setSelectedRecipeIds(new Set(schedulableItems.map((i) => i.recipe_id)));
    }
  }, [planningItems]);

  const selectedItems = planningItems.filter((i) => selectedRecipeIds.has(i.recipe_id));
  // Covered items selected for extra production (na zapas)
  const coveredSelectedItems = coveredItems.filter(
    (i) => (coveredCustomQties.get(i.recipe_id) ?? 0) > 0
  );

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
    if (selectedItems.length === 0 && coveredSelectedItems.length === 0) return;
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
      for (const item of coveredSelectedItems) {
        const qty = coveredCustomQties.get(item.recipe_id) ?? 0;
        if (qty <= 0) continue;
        await createM.mutateAsync({
          recipe: item.recipe_id,
          date: tab === 'today' ? today : format(new Date(), 'yyyy-MM-dd'),
          mode: 'simple',
          quantity_produced: qty,
          source_orders: [],
          notes: 'Produkcja na zapas',
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

        {/* ── Sekcja 1: Do wyprodukowania ── */}
        {planningLoading && <p className="px-4 py-6 text-sm text-slate-400">Ładowanie…</p>}
        {!planningLoading && planningItems.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-400">
            {tab === 'today'
              ? 'Brak zamówień na dziś z recepturami.'
              : 'Brak otwartych zamówień na wyroby z recepturami.'}
          </p>
        )}
        {!planningLoading && schedulableItems.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 md:px-6">
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
                  <svg className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-sm font-semibold text-slate-900">Do wyprodukowania</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                  />
                  <span className="text-xs text-slate-500">
                    {selectedRecipeIds.size > 0
                      ? `${selectedRecipeIds.size} z ${schedulableItems.length}`
                      : 'wszystkie'}
                  </span>
                </label>
                {canProduction && selectedItems.length > 0 && (
                  <Button size="sm" disabled={bulkCreating} onClick={() => void handleBulkCreate()}>
                    {bulkCreating ? 'Zatwierdzanie…' : `Zatwierdź (${selectedItems.length + coveredSelectedItems.length})`}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {schedulableItems.map((item) => {
                const isSelected = selectedRecipeIds.has(item.recipe_id);
                const stockTracked = item.stock_available != null;
                const hasShortfall = stockTracked && Number(item.shortfall) > 0;
                const draftInProd = orders
                  .filter((o) => o.status !== 'completed' && o.recipe === item.recipe_id)
                  .reduce((sum, o) => sum + Number(o.quantity_produced), 0);
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
                    onOpenModal={(selectedOrders) => setForm({
                      open: true,
                      prefillRecipeId: item.recipe_id,
                      prefillQty: Math.ceil(Number(item.suggested_production_qty)),
                      prefillSourceOrders: selectedOrders,
                      highlightProductId: item.product_id,
                    })}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* ── Sekcja 2: Pokryte ze stanu / zleceń ── */}
        {!planningLoading && coveredItems.length > 0 && (
          <>
            {schedulableItems.length > 0 && (
              <div className="mx-4 my-3 border-t border-slate-200 md:mx-6" />
            )}
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 md:px-6">
              <span className="h-6 w-6 rounded-md bg-green-100 flex items-center justify-center">
                <svg className="h-3.5 w-3.5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-sm font-semibold text-slate-900">Pokryte ze stanu / zleceń</span>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {coveredItems.map((item) => {
                const draftInProd = orders
                  .filter((o) => o.status !== 'completed' && o.recipe === item.recipe_id)
                  .reduce((sum, o) => sum + Number(o.quantity_produced), 0);
                const customQty = coveredCustomQties.get(item.recipe_id) ?? 0;
                const isSelected = customQty > 0;
                const stockTracked = item.stock_available != null;
                const hasShortfall = stockTracked && Number(item.shortfall) > 0;
                return (
                  <PlanningItem
                    key={item.recipe_id}
                    item={item}
                    isSelected={isSelected}
                    stockTracked={stockTracked}
                    hasShortfall={hasShortfall}
                    draftInProd={draftInProd}
                    allInProduction={item.orders.every((o) => Number(o.remaining_qty) <= 0)}
                    canManage={canProduction}
                    isCovered
                    customQty={customQty}
                    onCustomQtyChange={(qty) => {
                      setCoveredCustomQties((prev) => {
                        const next = new Map(prev);
                        if (qty > 0) next.set(item.recipe_id, qty);
                        else next.delete(item.recipe_id);
                        return next;
                      });
                    }}
                    onToggle={() => {
                      setCoveredCustomQties((prev) => {
                        const next = new Map(prev);
                        if (next.has(item.recipe_id)) next.delete(item.recipe_id);
                        return next;
                      });
                    }}
                    onOpenModal={(selectedOrders) => setForm({
                      open: true,
                      prefillRecipeId: item.recipe_id,
                      prefillQty: Math.ceil(Number(item.suggested_production_qty)),
                      prefillSourceOrders: selectedOrders,
                      highlightProductId: item.product_id,
                    })}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* ── Zatwierdź button — shown at bottom only when covered items are also selected ── */}
        {!planningLoading && canProduction && coveredSelectedItems.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3 md:px-6">
            <Button
              className="w-full"
              disabled={bulkCreating}
              onClick={() => void handleBulkCreate()}
            >
              {bulkCreating
                ? 'Zatwierdzanie…'
                : `Zatwierdź produkcję (${selectedItems.length + coveredSelectedItems.length})`}
            </Button>
          </div>
        )}
      </section>

      {/* ── Ingredients summary — only when schedulable items are selected with actual qty needed ── */}
      {selectedItems.length > 0 && selectedItems.some((item) => Number(item.suggested_production_qty) > 0 && item.ingredients.some((ing) => Number(ing.quantity_needed) > 0)) && (
        <IngredientsSummary items={selectedItems} totalCount={planningItems.length} activeOrders={activeOrders} />
      )}

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

// ── ProductionOrdersListContent — lightweight list for /documents tab ─────────

function currentMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

function thisWeekRange() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  return { from: monday.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

function prevMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const plDateFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : plDateFmt.format(d);
}

const PRESET_OPTIONS = [
  { label: 'Ten tydzień', value: 'week' },
  { label: 'Ten miesiąc', value: 'month' },
  { label: 'Poprzedni miesiąc', value: 'prev' },
  { label: 'Własny zakres', value: 'custom' },
] as const;

export function ProductionOrdersListContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const canProduction = usePermission('can_manage_production');

  const defaultFrom = currentMonthRange().from;
  const defaultTo = currentMonthRange().to;
  const dateFrom = searchParams.get('zp_from') ?? defaultFrom;
  const dateTo = searchParams.get('zp_to') ?? defaultTo;
  const statusFilter = searchParams.get('zp_status') ?? '';
  const preset = searchParams.get('zp_preset') ?? 'month';

  function set(key: string, val: string) {
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set(key, val); return n; }, { replace: true });
  }

  function applyPreset(value: string) {
    setSearchParams((p) => {
      const n = new URLSearchParams(p);
      n.set('zp_preset', value);
      if (value === 'week') { const r = thisWeekRange(); n.set('zp_from', r.from); n.set('zp_to', r.to); }
      if (value === 'month') { const r = currentMonthRange(); n.set('zp_from', r.from); n.set('zp_to', r.to); }
      if (value === 'prev') { const r = prevMonthRange(); n.set('zp_from', r.from); n.set('zp_to', r.to); }
      return n;
    }, { replace: true });
  }

  const [page, setPage] = useState(1);
  const { data, isLoading } = useProductionOrdersListQuery({
    page,
    date_from: dateFrom,
    date_to: dateTo,
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  const orders = data?.results ?? [];
  const total = data?.count ?? 0;
  const pageCount = Math.ceil(total / 20);

  return (
    <div className="space-y-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 md:text-xl">Zlecenia produkcji (ZP)</h2>
          {total > 0 && <p className="text-xs text-slate-400">Znaleziono: {total}</p>}
        </div>
        {canProduction && (
          <Link
            to="/production/orders"
            className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            Otwórz produkcję →
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <select
          value={preset}
          onChange={(e) => applyPreset(e.target.value)}
          className="h-8 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900"
        >
          {PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { set('zp_from', e.target.value); set('zp_preset', 'custom'); }}
          className="h-8 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900"
        />
        <span className="text-xs text-slate-400">—</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { set('zp_to', e.target.value); set('zp_preset', 'custom'); }}
          className="h-8 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900"
        />
        <select
          value={statusFilter}
          onChange={(e) => { set('zp_status', e.target.value); setPage(1); }}
          className="h-8 rounded-lg border border-slate-300 bg-[#F2F2F7] px-2 text-sm text-slate-900"
        >
          <option value="">Wszystkie statusy</option>
          <option value="draft">W produkcji</option>
          <option value="completed">Zakończone</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        {isLoading && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">Ładowanie…</div>
        )}
        {!isLoading && orders.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            Brak zleceń produkcji w tym okresie.
          </div>
        )}
        {!isLoading && orders.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Numer ZP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Data</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Produkt</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Ilość</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">RW / PW</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/production/orders/${o.id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(o.date)}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{o.finished_product_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {Number(o.quantity_produced).toLocaleString('pl-PL')} {o.finished_product_unit}
                    </td>
                    <td className="px-4 py-2.5">
                      {o.status === 'completed' ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Zakończone</span>
                      ) : o.status === 'in_progress' ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">W toku</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Szkic</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {o.rw_document_number && <span>RW: {o.rw_document_number}</span>}
                      {o.rw_document_number && o.pw_document_number && <span className="mx-1">·</span>}
                      {o.pw_document_number && <span>PW: {o.pw_document_number}</span>}
                      {!o.rw_document_number && !o.pw_document_number && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            ← Poprzednia
          </button>
          <span className="text-sm text-slate-500">{page} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Następna →
          </button>
        </div>
      )}
    </div>
  );
}

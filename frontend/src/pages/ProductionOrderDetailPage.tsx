/**
 * ProductionOrderDetailPage — detal zlecenia produkcyjnego.
 * Route: /production/orders/:id  (id = UUID)
 */

import { useNavigate, useParams, Link } from 'react-router-dom';
import { useProductionOrderQuery, useCompleteProductionOrderMutation, useDeleteProductionOrderMutation } from '@/query/use-production';
import { usePermission } from '@/hooks/usePermission';
import { useState } from 'react';
import { AuditHistorySection } from '@/components/features/AuditHistorySection';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const n4 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        Zakończone
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
      W produkcji
    </span>
  );
}

export function ProductionOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canProduction = usePermission('can_manage_production');

  const { data: order, isLoading, isError } = useProductionOrderQuery(id);
  const completeM = useCompleteProductionOrderMutation();
  const deleteM = useDeleteProductionOrderMutation();

  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completedData, setCompletedData] = useState<typeof order | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="text-sm text-slate-400">Ładowanie…</div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="p-4">
        <div className="text-sm text-red-500">Nie znaleziono zlecenia produkcyjnego.</div>
      </div>
    );
  }

  const isCompleted = order.status === 'completed';
  const displayedOrder = completedData ?? order;

  async function handleComplete() {
    setCompleteError(null);
    try {
      const result = await completeM.mutateAsync(order!.id);
      setCompletedData(result);
    } catch (e: unknown) {
      setCompleteError(e instanceof Error ? e.message : 'Błąd zakończenia zlecenia.');
    }
  }

  async function handleDelete() {
    await deleteM.mutateAsync(order!.id);
    navigate('/production/orders');
  }

  const ingredients =
    order.mode === 'batch'
      ? order.inputs.map((inp) => ({
          name: inp.ingredient_name,
          qty: Number(inp.quantity_used),
          unit: inp.unit || inp.ingredient_unit,
          cost: inp.fifo_cost !== null ? Number(inp.fifo_cost) : null,
        }))
      : order.recipe_items.map((ri) => ({
          name: ri.ingredient_name,
          qty: Number(ri.quantity_needed),
          unit: ri.unit,
          cost: null,
        }));

  return (
    <div className="space-y-3 p-4">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
          aria-label="Wstecz"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold text-slate-900 md:text-xl">{order.order_number}</h1>
            <StatusBadge status={displayedOrder.status} />
            <span className="text-xs text-slate-400">
              {order.mode === 'batch' ? 'Tryb wsadu' : 'Tryb prosty'}
            </span>
            {order.is_stock_production && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                na zapas
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Success banner after completing */}
      {completedData && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm font-semibold text-emerald-800">Produkcja zakończona!</p>
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            RW: {completedData.rw_document_number ?? '—'} · PW: {completedData.pw_document_number ?? '—'}
            {completedData.real_unit_cost !== null && (
              <> · Koszt/szt.: {pln.format(Number(completedData.real_unit_cost))}</>
            )}
          </p>
        </div>
      )}

      {/* Error banner */}
      {completeError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {completeError}
        </div>
      )}

      {/* Main card */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 px-4 py-4 md:px-6">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">{order.finished_product_name}</p>
            <p className="text-sm text-slate-600">
              {n4.format(Number(order.quantity_produced))} {order.finished_product_unit}
              {' · '}
              <span className="text-slate-400">{order.date}</span>
            </p>
            {order.notes && (
              <p className="text-xs text-slate-400">{order.notes}</p>
            )}
          </div>
          {canProduction && !isCompleted && !completedData && (
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button
                type="button"
                disabled={completeM.isPending}
                onClick={() => void handleComplete()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {completeM.isPending ? 'Kończenie…' : 'Zakończ produkcję'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium text-red-500 hover:underline"
              >
                Usuń zlecenie
              </button>
            </div>
          )}
        </div>

        {/* Cost row — only when completed */}
        {isCompleted && (displayedOrder.real_unit_cost !== null || displayedOrder.total_input_cost !== null) && (
          <div className="border-t border-slate-100 px-4 py-3 md:px-6">
            <div className="flex flex-wrap gap-6">
              {displayedOrder.real_unit_cost !== null && (
                <div>
                  <p className="text-xs text-slate-400">Koszt jednostkowy</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {pln.format(Number(displayedOrder.real_unit_cost))}
                  </p>
                </div>
              )}
              {displayedOrder.total_input_cost !== null && (
                <div>
                  <p className="text-xs text-slate-400">Łączny koszt surowców</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {pln.format(Number(displayedOrder.total_input_cost))}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* RW + PW docs — only when completed */}
        {isCompleted && (displayedOrder.rw_document_number || displayedOrder.pw_document_number) && (
          <div className="border-t border-slate-100 px-4 py-3 md:px-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Dokumenty magazynowe</p>
            <div className="flex flex-wrap gap-4">
              {displayedOrder.rw_document && (
                <Link
                  to={`/delivery/${displayedOrder.rw_document}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  RW: {displayedOrder.rw_document_number ?? '—'}
                </Link>
              )}
              {displayedOrder.pw_document && (
                <Link
                  to={`/delivery/${displayedOrder.pw_document}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  PW: {displayedOrder.pw_document_number ?? '—'}
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Ingredients */}
      {ingredients.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          <div className="px-4 py-3 md:px-6">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-900">
                {order.mode === 'batch' ? 'Zużyte surowce (wsad)' : 'Surowce wg receptury'}
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
                <p className="text-sm text-slate-800">{ing.name}</p>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {n4.format(ing.qty)} {ing.unit}
                  </p>
                  {ing.cost !== null && (
                    <p className="text-xs text-slate-400">{pln.format(ing.cost)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Source orders */}
      {order.source_orders_info?.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          <div className="px-4 py-3 md:px-6">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-900">Powiązane zamówienia</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {order.source_orders_info.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
                <div>
                  <Link
                    to={`/orders/${o.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {o.order_number ?? o.id.slice(0, 8)}
                  </Link>
                  {o.customer_name && (
                    <p className="text-xs text-slate-400">{o.customer_name}</p>
                  )}
                </div>
                <p className="text-sm tabular-nums text-slate-600">
                  {n4.format(Number(o.quantity))} szt.
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setConfirmDelete(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-apple-md">
            <h2 className="text-base font-semibold text-slate-900">Usunąć zlecenie?</h2>
            <p className="mt-2 text-sm text-slate-500">
              Zlecenie {order.order_number} zostanie trwale usunięte. Tej operacji nie można cofnąć.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleteM.isPending}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteM.isPending ? 'Usuwanie…' : 'Usuń'}
              </button>
            </div>
          </div>
        </div>
      )}

      {order && (
        <div className="px-4 pb-6 md:px-0">
          <AuditHistorySection objectType="ProductionOrder" objectId={String(order.id)} />
        </div>
      )}
    </div>
  );
}

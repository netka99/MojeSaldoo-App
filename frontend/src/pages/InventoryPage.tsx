import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';
import { warehouseService } from '@/services/warehouse.service';
import { usePermission } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';
import { openINWPrintWindow } from '@/lib/openINWPrintWindow';
import {
  useInventoryListQuery,
  useInventoryDetailQuery,
  useCreateInventoryMutation,
  useUpdateInventoryItemsMutation,
  useCompleteInventoryMutation,
  useCancelInventoryMutation,
} from '@/query/use-inventory';
import type { InventoryCount, InventoryCountItem } from '@/types/inventory.types';

const n3 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 });

function statusLabel(status: InventoryCount['status']) {
  return { draft: 'Szkic', completed: 'Zakończona', cancelled: 'Anulowana' }[status];
}

function statusClass(status: InventoryCount['status']) {
  return {
    draft: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
  }[status];
}

/* ── Create form ────────────────────────────────────────────────── */
function CreateForm({
  onSave,
  onCancel,
  saving,
}: {
  onSave: (warehouse: string, countDate: string, notes: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [warehouseId, setWarehouseId] = useState('');
  const [countDate, setCountDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    warehouseService
      .fetchList({ page_size: 50, is_active: true, warehouse_type: 'main' })
      .then((res) => setWarehouses(res.results.map((w) => ({ id: w.id, name: w.name }))))
      .catch(() => {});
  }, []);

  const inputClass =
    'h-10 w-full rounded-xl border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Magazyn *</label>
        <select
          className={inputClass}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          required
        >
          <option value="">— wybierz magazyn —</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Data inwentaryzacji *</label>
        <input
          type="date"
          className={inputClass}
          value={countDate}
          onChange={(e) => setCountDate(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Uwagi</label>
        <input
          type="text"
          className={inputClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcjonalnie…"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          disabled={saving || !warehouseId || !countDate}
          onClick={() => onSave(warehouseId, countDate, notes)}
        >
          {saving ? 'Tworzenie…' : 'Utwórz INW'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
      </div>
    </div>
  );
}

/* ── Count sheet (detail view) ──────────────────────────────────── */
function CountSheet({ countId, onClose, canManage }: { countId: string; onClose: () => void; canManage: boolean }) {
  const { data: count, isLoading } = useInventoryDetailQuery(countId);
  const updateM = useUpdateInventoryItemsMutation();
  const completeM = useCompleteInventoryMutation();
  const cancelM = useCancelInventoryMutation();

  // Local edits: itemId → quantity_actual string
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // Init edits from loaded data
  useEffect(() => {
    if (!count) return;
    const init: Record<string, string> = {};
    for (const item of count.items) {
      init[item.id] = item.quantity_actual !== null && item.quantity_actual !== undefined
        ? String(item.quantity_actual)
        : '';
    }
    setEdits(init);
  }, [count?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDraft = count?.status === 'draft';

  async function handleSaveDraft() {
    if (!count) return;
    setActionError(null);
    try {
      await updateM.mutateAsync({
        id: countId,
        data: {
          items: count.items.map((item) => ({
            id: item.id,
            quantity_actual: edits[item.id] !== '' && edits[item.id] !== undefined
              ? edits[item.id]
              : null,
          })),
        },
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Błąd zapisu');
    }
  }

  async function handleComplete() {
    setActionError(null);
    try {
      // Save edits first, then complete
      if (count) {
        await updateM.mutateAsync({
          id: countId,
          data: {
            items: count.items.map((item) => ({
              id: item.id,
              quantity_actual: edits[item.id] !== '' && edits[item.id] !== undefined
                ? edits[item.id]
                : null,
            })),
          },
        });
      }
      await completeM.mutateAsync(countId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Błąd zakończenia');
    }
  }

  if (isLoading || !count) {
    return <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>;
  }

  const filledCount = count.items.filter((it) => edits[it.id] !== '' && edits[it.id] !== undefined).length;
  const busy = updateM.isPending || completeM.isPending || cancelM.isPending;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {count.document_number || `INW ${count.id.slice(0, 8)}`}
          </h2>
          <p className="text-xs text-muted-foreground">
            {count.warehouse_name} · {count.count_date}
            {' · '}
            <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-medium', statusClass(count.status))}>
              {statusLabel(count.status)}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openINWPrintWindow(count)}
          >
            Drukuj
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            ← Lista
          </Button>
        </div>
      </div>

      {actionError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {/* Progress */}
      {isDraft && (
        <p className="text-xs text-muted-foreground">
          Zliczone: <span className="font-semibold text-foreground">{filledCount}</span> / {count.items.length} pozycji
        </p>
      )}

      {/* Items table */}
      <div className="overflow-x-auto rounded-2xl bg-card shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Produkt</th>
              <th className="px-3 py-2.5 text-center font-medium text-muted-foreground w-12">J.m.</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-24">Wg systemu</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-28">Policzono</th>
              {!isDraft && (
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-24">Różnica</th>
              )}
            </tr>
          </thead>
          <tbody>
            {count.items.map((item: InventoryCountItem) => {
              const diff = item.difference;
              const editVal = edits[item.id] ?? '';
              return (
                <tr key={item.id} className={cn(
                  'border-b border-border/30 last:border-b-0',
                  !isDraft && diff !== null && diff !== 0 && (diff > 0 ? 'bg-green-50/40' : 'bg-red-50/40'),
                )}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{item.product_name}</td>
                  <td className="px-3 py-2.5 text-center text-muted-foreground">{item.product_unit}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {n3.format(Number(item.quantity_system))}
                  </td>
                  <td className="px-3 py-2.5">
                    {isDraft ? (
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={editVal}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder={n3.format(Number(item.quantity_system))}
                        aria-label={`Ilość zliczona — ${item.product_name}`}
                        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    ) : (
                      <span className="block text-right tabular-nums text-foreground">
                        {item.quantity_actual !== null ? n3.format(Number(item.quantity_actual)) : '—'}
                      </span>
                    )}
                  </td>
                  {!isDraft && (
                    <td className={cn(
                      'px-4 py-2.5 text-right tabular-nums font-medium',
                      diff === null ? 'text-muted-foreground' :
                      diff > 0 ? 'text-green-700' :
                      diff < 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}>
                      {diff !== null ? (diff > 0 ? '+' : '') + n3.format(diff) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      {isDraft && canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void handleSaveDraft()} disabled={busy}>
            {updateM.isPending ? 'Zapisywanie…' : 'Zapisz szkic'}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (confirm('Zakończyć inwentaryzację i zastosować korekty stanów magazynowych?')) {
                void handleComplete();
              }
            }}
            disabled={busy || filledCount === 0}
          >
            {completeM.isPending ? 'Zamykanie…' : 'Zamknij INW i zastosuj korekty'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/5"
            disabled={busy}
            onClick={() => {
              if (confirm('Anulować inwentaryzację?')) {
                void cancelM.mutateAsync(countId).catch((e: unknown) =>
                  setActionError(e instanceof Error ? e.message : 'Błąd anulowania'),
                );
              }
            }}
          >
            Anuluj INW
          </Button>
        </div>
      )}

      {/* Completed summary */}
      {count.status === 'completed' && (
        <div className="rounded-xl border border-green-300/50 bg-green-50/60 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">Inwentaryzacja zakończona · {count.completed_at?.slice(0, 10)}</p>
          <p className="mt-0.5 text-xs text-green-700">
            Korekty zostały zastosowane do stanów magazynowych.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */
export function InventoryPage() {
  const canManageProducts = usePermission('can_manage_inventory');

  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const [page] = useState(1);
  const { data, isLoading } = useInventoryListQuery(page);
  const createM = useCreateInventoryMutation();

  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = data?.results ?? [];

  async function handleCreate(warehouse: string, countDate: string, notes: string) {
    try {
      const doc = await createM.mutateAsync({ warehouse, count_date: countDate, notes: notes || undefined });
      setShowForm(false);
      setSelectedId(doc.id);
    } catch {
      // error handled inline by mutation
    }
  }

  if (selectedId) {
    return (
      <div className="space-y-4 p-4">
        <CountSheet countId={selectedId} onClose={() => setSelectedId(null)} canManage={canManageProducts} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inwentaryzacja</h1>
        {!showForm && canManageProducts && (
          <Button onClick={() => setShowForm(true)}>+ Nowa INW</Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nowa inwentaryzacja</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateForm
              onSave={(w, d, n) => void handleCreate(w, d, n)}
              onCancel={() => setShowForm(false)}
              saving={createM.isPending}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Ładowanie…</p>}
          {!isLoading && counts.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Brak inwentaryzacji. Utwórz pierwszą, aby zliczyć stany magazynowe.
            </p>
          )}
          {counts.length > 0 && (
            <div className="divide-y">
              {counts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {c.document_number || `INW ${c.id.slice(0, 8)}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.warehouse_name} · {c.count_date} · {c.items.length} poz.
                    </p>
                  </div>
                  <span className={cn(
                    'ml-3 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    statusClass(c.status),
                  )}>
                    {statusLabel(c.status)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

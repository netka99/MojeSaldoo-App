import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { authStorage } from '@/services/api';
import { warehouseService } from '@/services/warehouse.service';
import { productService } from '@/services/product.service';
import { usePermission } from '@/hooks/usePermission';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { cn } from '@/lib/utils';
import {
  ReportShell,
  formatReportDate,
  reportCardClass,
  reportLabelClass,
  reportRowClass,
  reportSubtitleClass,
  reportTableClass,
  reportTdClass,
  reportTdMoneyClass,
  reportTdMutedClass,
  reportThClass,
  reportTitleClass,
  statusGreenClass,
} from '@/lib/reportSurface';
import { openINWPrintWindow } from '@/lib/openINWPrintWindow';
import { exportINWtoCsv } from '@/lib/exportINWtoCsv';
import {
  useInventoryListQuery,
  useInventoryDetailQuery,
  useCreateInventoryMutation,
  useUpdateInventoryItemsMutation,
  useCompleteInventoryMutation,
  useCancelInventoryMutation,
  useDeleteInventoryMutation,
  useRemoveInventoryItemMutation,
  useAddInventoryItemMutation,
  useAddManualInventoryItemMutation,
} from '@/query/use-inventory';
import type { InventoryCount, InventoryCountItem } from '@/types/inventory.types';
import type { Product } from '@/types';

const n3 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

/* ── SplitButton ────────────────────────────────────────────────── */
function SplitButton({ label, onMain, mainTitle, onAlt, altTitle }: {
  label: string;
  onMain: () => void;
  mainTitle: string;
  onAlt: () => void;
  altTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={onMain}
        className="rounded-l-2xl border border-r-0 border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-r-2xl border border-slate-200 bg-white px-2 py-2 text-slate-500 hover:bg-slate-50"
        aria-label="Więcej opcji"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-2xl border border-slate-200 bg-white shadow-apple-md">
          <button
            type="button"
            onClick={() => { onMain(); setOpen(false); }}
            className="flex w-full items-center px-4 py-2.5 text-left text-sm hover:bg-slate-50 rounded-t-2xl"
          >
            {mainTitle}
          </button>
          <div className="border-t border-border/50" />
          <button
            type="button"
            onClick={() => { onAlt(); setOpen(false); }}
            className="flex w-full items-center px-4 py-2.5 text-left text-sm hover:bg-slate-50 rounded-b-2xl"
          >
            {altTitle}
          </button>
        </div>
      )}
    </div>
  );
}

function statusLabel(status: InventoryCount['status']) {
  return { draft: 'Szkic', completed: 'Zakończona', cancelled: 'Anulowana' }[status];
}

function statusTextClass(status: InventoryCount['status']) {
  return {
    draft: 'text-sm font-medium text-amber-700',
    completed: 'text-sm font-medium text-emerald-700',
    cancelled: 'text-sm font-medium text-slate-400',
  }[status];
}

const primaryButtonClass =
  'inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass =
  'inline-flex items-center justify-center rounded-2xl border border-[#F2B6B6] bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-50';
const filterControlClass =
  'border-[#D4D2EE] bg-white font-normal text-slate-900 placeholder:text-slate-500 focus:border-primary focus:bg-white';

function fieldStateCls(value: string) {
  return value.trim()
    ? 'border-solid border-[#D4D2EE] bg-white'
    : 'border-dashed border-[#D4D2EE] bg-white placeholder:text-slate-500';
}

/* ── Create form ────────────────────────────────────────────────── */
function CreateForm({
  onSave,
  onCancel,
  saving,
  showWarehouseSelect,
}: {
  onSave: (warehouse: string, countDate: string, notes: string) => void;
  onCancel: () => void;
  saving: boolean;
  showWarehouseSelect: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [warehouseId, setWarehouseId] = useState('');
  const [countDate, setCountDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    warehouseService
      .fetchList({ page_size: 50, is_active: true })
      .then((res) => {
        const list = res.results.map((w) => ({ id: w.id, name: w.name }));
        setWarehouses(list);
        // Always auto-select if only one, or if warehouse select is hidden
        if (!showWarehouseSelect || list.length === 1) setWarehouseId(list[0]?.id ?? '');
      })
      .catch(() => {});
  }, [showWarehouseSelect]);

  return (
    <div className="space-y-3">
      {showWarehouseSelect && warehouses.length > 1 && (
        <label className="block">
          <span className={reportLabelClass}>Magazyn</span>
          <select
            className={cn('select-pill w-full sm:w-56', filterControlClass, fieldStateCls(warehouseId))}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
          >
            <option value="">— wybierz magazyn —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className={reportLabelClass}>Data inwentaryzacji</span>
        <input
          type="date"
          className={cn('date-pill w-full sm:w-52', filterControlClass, fieldStateCls(countDate))}
          value={countDate}
          onChange={(e) => setCountDate(e.target.value)}
        />
      </label>
      <label className="block">
        <span className={reportLabelClass}>Uwagi</span>
        <input
          type="text"
          className={cn('field-ios w-full', filterControlClass, fieldStateCls(notes))}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcjonalnie…"
        />
      </label>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !warehouseId || !countDate}
          onClick={() => onSave(warehouseId, countDate, notes)}
          className={primaryButtonClass}
        >
          {saving ? 'Tworzenie…' : 'Utwórz INW'}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Anuluj
        </button>
      </div>
    </div>
  );
}

/* Merge local edits into count snapshot for print/export */
function countWithEdits(count: InventoryCount, edits: Record<string, string>): InventoryCount {
  return {
    ...count,
    items: count.items.map((item) => {
      const val = edits[item.id];
      return {
        ...item,
        quantity_actual: val !== undefined && val !== '' ? Number(val) : item.quantity_actual,
      };
    }),
  };
}

/* ── AddProductModal ────────────────────────────────────────────── */
function AddProductModal({
  countId, existingProductIds, searchRef, productSearch, setProductSearch,
  productResults, manualName, setManualName, manualUnit, setManualUnit,
  busy, addItemM, addManualM, onClose,
}: {
  countId: string;
  existingProductIds: string[];
  searchRef: React.RefObject<HTMLInputElement>;
  productSearch: string;
  setProductSearch: (v: string) => void;
  productResults: Product[];
  manualName: string;
  setManualName: (v: string) => void;
  manualUnit: string;
  setManualUnit: (v: string) => void;
  busy: boolean;
  addItemM: ReturnType<typeof useAddInventoryItemMutation>;
  addManualM: ReturnType<typeof useAddManualInventoryItemMutation>;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-slate-200 bg-white shadow-apple-md sm:mx-4">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-base font-semibold text-slate-900">Dodaj pozycję</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Search existing */}
          <input
            ref={searchRef}
            type="text"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Szukaj w katalogu…"
            className={cn('field-ios w-full', filterControlClass)}
          />
          {productResults.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white max-h-48 overflow-y-auto">
              {productResults.map((p) => {
                const alreadyAdded = existingProductIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={alreadyAdded || busy}
                    onClick={() => addItemM.mutate({ id: countId, productId: p.id }, { onSuccess: onClose })}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default first:rounded-t-xl last:rounded-b-xl"
                  >
                    <span className="font-medium text-slate-800">{p.name}</span>
                    {alreadyAdded
                      ? <span className="text-xs text-slate-400">już na liście</span>
                      : <span className="text-xs text-primary">+ dodaj</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs text-slate-400">lub dodaj ręcznie</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          {/* Manual add — always visible */}
          <div className="space-y-2">
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Nazwa"
              className={cn('field-ios w-full', filterControlClass, fieldStateCls(manualName))}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={manualUnit}
                onChange={(e) => setManualUnit(e.target.value)}
                placeholder="J.m. (np. kg, szt)"
                className={cn('field-ios min-w-0 flex-1', filterControlClass, fieldStateCls(manualUnit))}
              />
              <button
                type="button"
                disabled={busy || !manualName.trim()}
                onClick={() => addManualM.mutate(
                  { id: countId, name: manualName.trim(), unit: manualUnit.trim() },
                  { onSuccess: onClose },
                )}
                className={primaryButtonClass}
              >
                Dodaj
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── MoreMenu ───────────────────────────────────────────────────── */
function MoreMenu({ items }: { items: { label: string; destructive?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-card text-muted-foreground hover:bg-slate-50"
        aria-label="Więcej opcji"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-40 w-44 rounded-2xl border border-border bg-white shadow-apple-md">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { item.onClick(); setOpen(false); }}
              className={cn(
                'flex w-full items-center px-4 py-3 text-left text-sm',
                i === 0 ? 'rounded-t-2xl' : '',
                i === items.length - 1 ? 'rounded-b-2xl' : 'border-b border-border/50',
                item.destructive ? 'text-destructive hover:bg-red-50' : 'hover:bg-slate-50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Count sheet (detail view) ──────────────────────────────────── */
function CountSheet({ countId, onClose, canManage }: { countId: string; onClose: (saved?: boolean) => void; canManage: boolean }) {
  const { data: count, isLoading } = useInventoryDetailQuery(countId);
  const updateM = useUpdateInventoryItemsMutation();
  const completeM = useCompleteInventoryMutation();
  const cancelM = useCancelInventoryMutation();
  const deleteM = useDeleteInventoryMutation();
  const removeItemM = useRemoveInventoryItemMutation();
  const addItemM = useAddInventoryItemMutation();
  const addManualM = useAddManualInventoryItemMutation();

  // Local edits: itemId → quantity_actual string
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'complete' | 'cancel' | 'delete' | null>(null);

  // Filter items locally
  const [itemFilter, setItemFilter] = useState('');

  // Add product search
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [manualName, setManualName] = useState('');
  const [manualUnit, setManualUnit] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showAddProduct) { setProductSearch(''); setProductResults([]); return; }
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [showAddProduct]);

  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); return; }
    const timer = setTimeout(() => {
      productService.fetchList({ search: productSearch, is_service: false, is_active: true, page_size: 10 })
        .then((res) => setProductResults(res.results))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [productSearch]);

  // Init edits from loaded data
  useEffect(() => {
    if (!count) return;
    const init: Record<string, string> = {};
    for (const item of count.items) {
      init[item.id] = item.quantity_actual !== null && item.quantity_actual !== undefined
        ? String(parseFloat(String(item.quantity_actual)))
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
      onClose(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Błąd zapisu');
    }
  }

  function draftHasUnsavedEdits(): boolean {
    if (!count || !isDraft || !canManage) return false;
    return count.items.some((item) => {
      const edited = edits[item.id] ?? '';
      const saved = item.quantity_actual !== null && item.quantity_actual !== undefined
        ? String(item.quantity_actual)
        : '';
      return edited !== saved;
    });
  }

  async function handleBack() {
    if (draftHasUnsavedEdits()) {
      await handleSaveDraft();
      return;
    }
    onClose();
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
  const busy = updateM.isPending || completeM.isPending || cancelM.isPending || deleteM.isPending || removeItemM.isPending || addItemM.isPending || addManualM.isPending;

  return (
    <div className="space-y-4 pb-36 md:pb-28">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleBack()}
            disabled={busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 md:h-10 md:w-10"
            aria-label="Wróć"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5}>
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1 className={reportTitleClass}>
              {count.document_number || `INW ${count.id.slice(0, 8)}`}
            </h1>
            <p className={reportSubtitleClass}>
              {count.warehouse_name} · {formatReportDate(count.count_date)}
              {' · '}
              <span className={statusTextClass(count.status)}>{statusLabel(count.status)}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isDraft && canManage && (
            <button type="button" onClick={() => setShowAddProduct((v) => !v)} className={primaryButtonClass}>
              + Dodaj produkt
            </button>
          )}
          <SplitButton
            label="Excel"
            onMain={() => exportINWtoCsv(countWithEdits(count, edits))}
            mainTitle="Wszystkie pozycje"
            onAlt={() => exportINWtoCsv(countWithEdits(count, edits), true)}
            altTitle="Tylko wypełnione"
          />
          <SplitButton
            label="Drukuj"
            onMain={() => openINWPrintWindow(countWithEdits(count, edits))}
            mainTitle="Wszystkie pozycje"
            onAlt={() => openINWPrintWindow(countWithEdits(count, edits), true)}
            altTitle="Tylko wypełnione"
          />
        </div>
      </div>

      {actionError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {/* Search + progress */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            placeholder="Szukaj pozycji…"
            className={cn('field-ios w-full pl-9', filterControlClass)}
          />
          {itemFilter && (
            <button type="button" onClick={() => setItemFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        {isDraft && (
          <p className="shrink-0 text-sm text-slate-500">
            Zliczone: <span className="font-semibold text-slate-900">{filledCount}</span> / {count.items.length}
          </p>
        )}
      </div>

      {/* Items table */}
      <div className={cn('overflow-x-auto rounded-2xl md:rounded-3xl', reportCardClass)}>
        <table className={reportTableClass}>
          <thead>
            <tr>
              <th className={reportThClass}>Produkt</th>
              <th className={cn(reportThClass, 'text-center')}>J.m.</th>
              <th className={cn(reportThClass, 'text-right')}>Wg systemu</th>
              <th className={cn(reportThClass, 'w-px whitespace-nowrap text-right')}>Policzono</th>
              {!isDraft && (
                <th className={cn(reportThClass, 'text-right')}>Różnica</th>
              )}
              {isDraft && canManage && <th className={reportThClass} />}
            </tr>
          </thead>
          <tbody>
            {count.items.filter((it) =>
              !itemFilter.trim() || it.product_name.toLowerCase().includes(itemFilter.toLowerCase())
            ).map((item: InventoryCountItem) => {
              const diff = item.difference;
              const editVal = edits[item.id] ?? '';
              return (
                <tr key={item.id} className={reportRowClass}>
                  <td className={reportTdClass}>{item.product_name}</td>
                  <td className={cn(reportTdMutedClass, 'text-center')}>{item.product_unit}</td>
                  <td className={cn(reportTdMutedClass, 'text-right')}>
                    {n3.format(Number(item.quantity_system))}
                  </td>
                  <td className="w-px whitespace-nowrap px-3 py-3 text-right">
                    {isDraft ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editVal}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [item.id]: e.target.value.replace(',', '.') }))}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) setEdits((prev) => ({ ...prev, [item.id]: String(v) }));
                        }}
                        placeholder="—"
                        aria-label={`Ilość zliczona — ${item.product_name}`}
                        className={cn(
                          'field-ios-sm ml-auto w-24 text-right tabular-nums',
                          filterControlClass,
                          editVal.trim() ? 'border-solid' : 'border-dashed',
                        )}
                      />
                    ) : (
                      <span className={reportTdMoneyClass}>
                        {item.quantity_actual !== null ? n3.format(Number(item.quantity_actual)) : '—'}
                      </span>
                    )}
                  </td>
                  {!isDraft && (
                    <td className={cn(
                      'whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums',
                      diff === null || diff === 0 ? 'text-slate-500' :
                      diff > 0 ? 'text-emerald-700' : 'text-red-600',
                    )}>
                      {diff !== null ? (diff > 0 ? '+' : '') + n3.format(diff) : '—'}
                    </td>
                  )}
                  {isDraft && canManage && (
                    <td className="pr-2 text-center">
                      <button
                        type="button"
                        aria-label={`Usuń ${item.product_name}`}
                        disabled={busy}
                        onClick={() => removeItemM.mutate({ id: countId, itemId: item.id })}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add product modal */}
      {isDraft && canManage && showAddProduct && (
        <AddProductModal
          countId={countId}
          existingProductIds={count.items.map((it) => it.product).filter(Boolean) as string[]}
          searchRef={searchRef}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          productResults={productResults}
          manualName={manualName}
          setManualName={setManualName}
          manualUnit={manualUnit}
          setManualUnit={setManualUnit}
          busy={busy}
          addItemM={addItemM}
          addManualM={addManualM}
          onClose={() => { setShowAddProduct(false); setProductSearch(''); setManualName(''); setManualUnit(''); }}
        />
      )}

      {/* Delete button for cancelled */}
      {count.status === 'cancelled' && canManage && (
        <div className="flex gap-2">
          <button
            type="button"
            className={dangerButtonClass}
            disabled={busy}
            onClick={() => setConfirmAction('delete')}
          >
            Usuń INW
          </button>
        </div>
      )}

      {/* Sticky footer — draft actions */}
      {isDraft && canManage && (
        <div className="fixed bottom-[83px] left-0 right-0 z-30 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-3 shadow-apple-md md:bottom-0 md:left-64">
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={busy}
            className={cn(secondaryButtonClass, 'flex-1 sm:flex-none')}
          >
            {updateM.isPending ? 'Zapisywanie…' : 'Zapisz szkic'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmAction('complete')}
            disabled={busy || filledCount === 0}
            className={cn(primaryButtonClass, 'flex-1 sm:flex-none')}
          >
            {completeM.isPending ? 'Zamykanie…' : 'Zamknij INW'}
          </button>
          <button
            type="button"
            className={dangerButtonClass}
            disabled={busy}
            onClick={() => setConfirmAction('cancel')}
          >
            Anuluj INW
          </button>
          <button
            type="button"
            className={dangerButtonClass}
            disabled={busy}
            onClick={() => setConfirmAction('delete')}
          >
            Usuń INW
          </button>
        </div>
      )}

      {/* Completed summary */}
      {count.status === 'completed' && (
        <div className={cn('rounded-2xl px-4 py-3', statusGreenClass)}>
          <p className="text-sm font-semibold text-emerald-800">Inwentaryzacja zakończona · {formatReportDate(count.completed_at?.slice(0, 10))}</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            Korekty zostały zastosowane do stanów magazynowych.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction === 'complete'}
        title="Zamknąć inwentaryzację?"
        message="Korekty stanów magazynowych zostaną zastosowane. Tej operacji nie można cofnąć."
        confirmLabel="Zamknij INW i zastosuj"
        onConfirm={() => { setConfirmAction(null); void handleComplete(); }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="Anulować inwentaryzację?"
        message="Szkic zostanie anulowany. Stany magazynowe nie zostaną zmienione."
        confirmLabel="Anuluj INW"
        destructive
        onConfirm={() => {
          setConfirmAction(null);
          void cancelM.mutateAsync(countId).catch((e: unknown) =>
            setActionError(e instanceof Error ? e.message : 'Błąd anulowania'),
          );
        }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'delete'}
        title="Usunąć inwentaryzację?"
        message="Dokument zostanie trwale usunięty. Tej operacji nie można cofnąć."
        confirmLabel="Usuń"
        destructive
        onConfirm={() => {
          setConfirmAction(null);
          void deleteM.mutateAsync(countId)
            .then(() => onClose())
            .catch((e: unknown) =>
              setActionError(e instanceof Error ? e.message : 'Błąd usunięcia'),
            );
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */
export function InventoryPage() {
  const canManageProducts = usePermission('can_manage_inventory');
  const warehousesEnabled = useModuleGuard('warehouses');

  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace />;

  const [page] = useState(1);
  const { data, isLoading } = useInventoryListQuery(page);
  const createM = useCreateInventoryMutation();

  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

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
      <ReportShell>
        <CountSheet
          countId={selectedId}
          onClose={(saved?: boolean) => { setSelectedId(null); if (saved) setSavedMsg(true); }}
          canManage={canManageProducts}
        />
      </ReportShell>
    );
  }

  return (
    <ReportShell>
      {savedMsg && (
        <div className={cn('flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-emerald-800', statusGreenClass)}>
          <span>Szkic zapisany.</span>
          <button type="button" onClick={() => setSavedMsg(false)} className="text-emerald-700 hover:text-emerald-900" aria-label="Zamknij">✕</button>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={reportTitleClass}>Inwentaryzacja</h1>
          <p className={reportSubtitleClass}>Spis z natury i korekta stanów</p>
        </div>
        {!showForm && canManageProducts && (
          <button type="button" onClick={() => setShowForm(true)} className={primaryButtonClass}>+ Nowa INW</button>
        )}
      </div>

      {showForm && (
        <section className={cn('rounded-2xl px-4 py-4 md:rounded-3xl md:px-5', reportCardClass)}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Nowa inwentaryzacja</h2>
          <CreateForm
            onSave={(w, d, n) => void handleCreate(w, d, n)}
            onCancel={() => setShowForm(false)}
            saving={createM.isPending}
            showWarehouseSelect={warehousesEnabled}
          />
        </section>
      )}

      <section className={cn('overflow-hidden rounded-2xl md:rounded-3xl', reportCardClass)}>
        {isLoading && <p className="px-4 py-12 text-center text-sm text-slate-500">Ładowanie…</p>}
        {!isLoading && counts.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-slate-500">
            Brak inwentaryzacji. Utwórz pierwszą, aby zliczyć stany magazynowe.
          </p>
        )}
        {counts.length > 0 && (
          <div>
            {counts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary">
                    {c.document_number || `INW ${c.id.slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.warehouse_name} · {formatReportDate(c.count_date)} · {c.items.length} poz.
                  </p>
                </div>
                <span className={cn('ml-3 shrink-0', statusTextClass(c.status))}>
                  {statusLabel(c.status)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </ReportShell>
  );
}

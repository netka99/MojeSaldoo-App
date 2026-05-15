import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DELIVERY_STATUS_LABELS_PL } from '@/constants/deliveryStatusPl';
import { deliveryStatusBadgeClassName } from '@/pages/DeliveryDocumentsPage';
import {
  useCompleteDeliveryMutation,
  useDeliveryQuery,
  useDeliveryPreviewQuery,
  usePatchDeliveryMutation,
  useSaveDeliveryMutation,
  useStartDeliveryMutation,
  useUpdateDeliveryLinesMutation,
} from '@/query/use-delivery';
import { useOrderQuery } from '@/query/use-orders';
import { productService } from '@/services/product.service';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { openWZPrintWindow } from '@/lib/openWZPrintWindow';
import type { DeliveryCompleteItemRow, DeliveryItem, LinkedZWDocument, PendingReturnItem } from '@/types';
import type { Order, Product } from '@/types';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Wystąpił błąd';
}

function qtyStr(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

type LineLabelInput = Pick<DeliveryItem, 'order_item_id' | 'product_id'> & {
  product_name?: string | null;
};

/** Resolve product label: API product_name, then order line, then short id (MM lines have null order_item_id). */
export function productLabelForDeliveryLine(order: Order | undefined, line: LineLabelInput): string {
  if (line.product_name?.trim()) return line.product_name.trim();
  if (line.order_item_id) {
    const oi = order?.items.find((i) => i.id === line.order_item_id);
    if (oi?.product_name) return oi.product_name;
    return line.order_item_id.slice(0, 8);
  }
  if (line.product_id) return `Produkt ${line.product_id.slice(0, 8)}…`;
  return '—';
}

type DeliveryLocationState = { fromVanLoading?: boolean };

type LineEditState = {
  quantity_actual: string;
  quantity_returned: string;
  return_reason: string;
  is_damaged: boolean;
  notes: string;
};

function buildInitialLineEdits(items: DeliveryItem[]): Record<string, LineEditState> {
  const next: Record<string, LineEditState> = {};
  for (const it of items) {
    next[it.id] = {
      quantity_actual: qtyStr(it.quantity_actual ?? it.quantity_planned),
      quantity_returned: qtyStr(it.quantity_returned ?? '0'),
      return_reason: it.return_reason ?? '',
      is_damaged: Boolean(it.is_damaged),
      notes: it.notes ?? '',
    };
  }
  return next;
}

/* ── Icons ─────────────────────────────────────────────────────── */
function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

/* ── WZ item card ───────────────────────────────────────────────── */
interface WZItemCardProps {
  item: DeliveryItem;
  label: string;
  isEditing: boolean;
  editQty: number;
  onQtyChange: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  index: number;
}

function WZItemCard({ item, label, isEditing, editQty, onQtyChange, onRemove, index }: WZItemCardProps) {
  const qtyActual =
    item.quantity_actual !== null && item.quantity_actual !== undefined && item.quantity_actual !== ''
      ? parseFloat(String(item.quantity_actual))
      : null;
  const qtyReturned = parseFloat(String(item.quantity_returned)) || 0;
  const displayQty = isEditing ? editQty : parseFloat(String(item.quantity_planned)) || 0;
  const qtyDisplay = Number.isInteger(displayQty) ? String(displayQty) : displayQty.toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-2xl bg-card p-4 shadow-[0_2px_12px_rgba(26,28,31,0.07)]"
    >
      {/* Top row: avatar + name */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-semibold text-primary"
          aria-hidden
        >
          {label.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15px] font-medium text-foreground">{label}</h4>
          {!isEditing && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Zaplanowano:{' '}
              <span className="font-semibold tabular-nums text-foreground">{qtyDisplay} szt.</span>
            </p>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
        {isEditing ? (
          /* Editable: trash + stepper */
          <>
            <motion.button
              whileTap={{ scale: 0.9 }}
              type="button"
              aria-label={`Usuń ${label}`}
              onClick={() => onRemove(item.id)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
            >
              <TrashIcon />
            </motion.button>
            <div className="flex items-center gap-3">
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="button"
                aria-label="Zmniejsz ilość"
                onClick={() => onQtyChange(item.id, -1)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
              >
                <MinusIcon />
              </motion.button>
              <span className="min-w-[2.5rem] text-center text-[15px] font-semibold tabular-nums text-foreground">
                {qtyDisplay}
              </span>
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="button"
                aria-label="Zwiększ ilość"
                onClick={() => onQtyChange(item.id, 1)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <PlusIcon />
              </motion.button>
            </div>
          </>
        ) : (
          /* Read-only: actual + returned if present */
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {qtyActual !== null && (
              <span className="text-[13px] text-muted-foreground">
                Faktyczne:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {Number.isInteger(qtyActual) ? qtyActual : qtyActual.toFixed(2)} szt.
                </span>
              </span>
            )}
            {qtyReturned > 0 && (
              <span className="text-[13px] text-muted-foreground">
                Zwrot:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {Number.isInteger(qtyReturned) ? qtyReturned : qtyReturned.toFixed(2)} szt.
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

const RETURN_REASON_OPTIONS = [
  { value: '', label: 'Podaj powód (opcjonalnie)' },
  { value: 'Po terminie', label: 'Po terminie' },
  { value: 'Uszkodzone', label: 'Uszkodzone' },
  { value: 'Błąd zamówienia', label: 'Błąd zamówienia' },
  { value: 'Inne', label: 'Inne' },
];

/* ── Return items section (draft WZ only) ──────────────────────── */
interface ReturnItemsSectionProps {
  items: PendingReturnItem[];
  onChange: (items: PendingReturnItem[]) => void;
}

function ReturnItemsSection({ items, onChange }: ReturnItemsSectionProps) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (q: string) => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setSearching(true);
    searchRef.current = setTimeout(async () => {
      try {
        const data = await productService.fetchList({ search: q.trim(), page_size: 20, is_active: true });
        setResults(data.results);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const addProduct = (product: Product) => {
    if (items.some((i) => i.product_id === product.id)) return; // already added
    onChange([...items, { product_id: product.id, product_name: product.name, quantity: '1', return_reason: '' }]);
    setSearch('');
    setResults([]);
    setOpen(false);
  };

  const remove = (productId: string) => onChange(items.filter((i) => i.product_id !== productId));

  const setQty = (productId: string, qty: string) =>
    onChange(items.map((i) => (i.product_id === productId ? { ...i, quantity: qty } : i)));

  const setReason = (productId: string, reason: string) =>
    onChange(items.map((i) => (i.product_id === productId ? { ...i, return_reason: reason } : i)));

  return (
    <div className="rounded-2xl bg-card shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
      <div className="px-4 py-3.5">
        <h3 className="text-[14px] font-semibold text-foreground">Zwrot towaru od klienta</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Produkty oddawane przez klienta (np. z poprzedniego dnia). Zostaną zapisane jako dokument ZW przy zapisaniu WZ.
        </p>
      </div>

      {/* Product search */}
      <div className="relative border-t border-border/50 px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); doSearch(e.target.value); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Szukaj produktu do zwrotu…"
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[14px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {searching && (
          <span className="absolute right-7 top-1/2 -translate-y-1/2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent block" />
          </span>
        )}
        {open && results.length > 0 && (
          <ul className="absolute left-4 right-4 z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={() => addProduct(p)}
                  className="w-full px-3 py-2 text-left text-[14px] hover:bg-muted/60"
                >
                  <span className="font-medium text-foreground">{p.name}</span>
                  <span className="ml-2 text-[12px] text-muted-foreground">{p.unit}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Added return lines */}
      {items.length > 0 && (
        <div className="border-t border-border/50 px-4 pb-4 pt-3 space-y-3">
          {items.map((item) => (
            <div key={item.product_id} className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex-1 text-[14px] font-medium text-foreground truncate">
                  {item.product_name ?? item.product_id.slice(0, 8)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(item.product_id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
                  aria-label="Usuń"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="flex gap-2">
                <div className="w-24">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={item.quantity}
                    onChange={(e) => setQty(item.product_id, e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="Ilość"
                  />
                </div>
                <select
                  value={item.return_reason ?? ''}
                  onChange={(e) => setReason(item.product_id, e.target.value)}
                  className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-[13px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {RETURN_REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Linked ZW documents section ───────────────────────────────── */
type ZWItemEditState = {
  quantity_planned: string;
  return_reason: string;
};

/** zwItemEdits: zwDocId → itemId → edit state */
type ZWItemEditsMap = Record<string, Record<string, ZWItemEditState>>;

interface LinkedZWSectionProps {
  documents: LinkedZWDocument[];
  isEditing?: boolean;
  zwItemEdits?: ZWItemEditsMap;
  onZwItemChange?: (zwDocId: string, itemId: string, field: keyof ZWItemEditState, value: string) => void;
}

function LinkedZWSection({ documents, isEditing, zwItemEdits, onZwItemChange }: LinkedZWSectionProps) {
  if (documents.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/20 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
      <div className="px-4 py-3.5 border-b border-amber-400/30">
        <h3 className="text-[14px] font-semibold text-amber-900 dark:text-amber-200">
          Dokumenty zwrotu (ZW)
          {isEditing && <span className="ml-2 text-[12px] font-normal text-amber-600">· tryb edycji</span>}
        </h3>
        <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-400">
          Zwroty przyjęte przy zapisywaniu tego WZ.
        </p>
      </div>
      {documents.map((zw) => (
        <div key={zw.id} className="px-4 py-3 border-b border-amber-400/20 last:border-b-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
              {zw.document_number?.trim() ? zw.document_number : `ZW ${zw.id.slice(0, 8)}`}
            </span>
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              {zw.status}
            </span>
          </div>
          {zw.items.length > 0 && (
            <ul className="space-y-2">
              {zw.items.map((item) => {
                const edit = zwItemEdits?.[zw.id]?.[item.id];
                return (
                  <li key={item.id}>
                    {isEditing && edit && onZwItemChange ? (
                      <div className="flex flex-col gap-1.5 rounded-xl bg-amber-100/60 dark:bg-amber-900/30 p-2.5">
                        <span className="text-[13px] font-medium text-amber-900 dark:text-amber-200 truncate">
                          {item.product_name ?? item.product_id.slice(0, 8)}
                        </span>
                        <div className="flex gap-2">
                          <div className="w-24">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={edit.quantity_planned}
                              onChange={(e) => onZwItemChange(zw.id, item.id, 'quantity_planned', e.target.value)}
                              className="w-full rounded-lg border border-amber-300 bg-white dark:bg-amber-950/40 px-2 py-1.5 text-[13px] tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400"
                              aria-label="Ilość zwrotu"
                            />
                          </div>
                          <select
                            value={edit.return_reason}
                            onChange={(e) => onZwItemChange(zw.id, item.id, 'return_reason', e.target.value)}
                            className="flex-1 rounded-lg border border-amber-300 bg-white dark:bg-amber-950/40 px-2 py-1.5 text-[13px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            {RETURN_REASON_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-amber-800 dark:text-amber-300 truncate">
                          {item.product_name ?? item.product_id.slice(0, 8)}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium text-amber-900 dark:text-amber-200">
                          {String(item.quantity_planned)} szt.
                          {item.return_reason ? ` · ${item.return_reason}` : ''}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */
export function DeliveryDocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: doc, isLoading, isError, error, refetch, isFetching } = useDeliveryQuery(id, Boolean(id));
  const { data: deliveryPreview, isLoading: prevLoading } = useDeliveryPreviewQuery(id, Boolean(id));
  const { data: order } = useOrderQuery(doc?.order_id ?? undefined, Boolean(doc?.order_id));

  const [showVanLoadedBanner, setShowVanLoadedBanner] = useState(
    () => Boolean((location.state as DeliveryLocationState | null)?.fromVanLoading),
  );

  useEffect(() => {
    if (!showVanLoadedBanner) return;
    navigate(location.pathname, { replace: true, state: {} });
  }, [showVanLoadedBanner, location.pathname, navigate]);

  const saveM = useSaveDeliveryMutation();
  const startM = useStartDeliveryMutation();
  const completeM = useCompleteDeliveryMutation();
  const patchM = usePatchDeliveryMutation();
  const updateLinesM = useUpdateDeliveryLinesMutation();

  const [actionError, setActionError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  /* ── Pending returns (collected before saving WZ) ───────────── */
  const [pendingReturns, setPendingReturns] = useState<PendingReturnItem[]>([]);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [lineEdits, setLineEdits] = useState<Record<string, LineEditState>>({});
  const [receiverName, setReceiverName] = useState('');
  const [returnsNotes, setReturnsNotes] = useState('');
  const [headerDraft, setHeaderDraft] = useState({ driver_name: '', notes: '', issue_date: '' });
  const [headerOpen, setHeaderOpen] = useState(false);

  /* ── Planned-qty edit state ─────────────────────────────────── */
  const [isEditing, setIsEditing] = useState(false);
  const [editQtys, setEditQtys] = useState<Record<string, number>>({});
  const [zwItemEdits, setZwItemEdits] = useState<ZWItemEditsMap>({});

  const enterEditMode = useCallback(() => {
    if (!doc) return;
    const initial: Record<string, number> = {};
    for (const it of doc.items) {
      initial[it.id] = parseFloat(String(it.quantity_planned)) || 0;
    }
    setEditQtys(initial);
    // Populate ZW item edits from linked ZW documents
    const zwEdits: ZWItemEditsMap = {};
    for (const zw of doc.return_documents ?? []) {
      zwEdits[zw.id] = {};
      for (const item of zw.items) {
        zwEdits[zw.id][item.id] = {
          quantity_planned: String(item.quantity_planned),
          return_reason: item.return_reason ?? '',
        };
      }
    }
    setZwItemEdits(zwEdits);
    setIsEditing(true);
    setActionError(null);
  }, [doc]);

  const cancelEdit = () => {
    setIsEditing(false);
    setEditQtys({});
    setZwItemEdits({});
  };

  const handleZwItemChange = (zwDocId: string, itemId: string, field: keyof ZWItemEditState, value: string) => {
    setZwItemEdits((prev) => ({
      ...prev,
      [zwDocId]: { ...prev[zwDocId], [itemId]: { ...prev[zwDocId]?.[itemId], [field]: value } },
    }));
  };

  const handleEditQtyChange = (itemId: string, delta: number) => {
    setEditQtys((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] ?? 0) + delta),
    }));
  };

  const handleEditRemove = (itemId: string) => {
    setEditQtys((prev) => ({ ...prev, [itemId]: 0 }));
  };

  const handleSaveEditedLines = async () => {
    if (!id || !doc) return;
    setActionError(null);
    try {
      await updateLinesM.mutateAsync({
        id,
        data: {
          items: doc.items.map((it) => ({
            id: it.id,
            quantity_planned: String(editQtys[it.id] ?? it.quantity_planned),
          })),
        },
      });
      // Also save edits for each linked ZW document
      for (const [zwDocId, itemEdits] of Object.entries(zwItemEdits)) {
        const zwItems = Object.entries(itemEdits).map(([itemId, edit]) => ({
          id: itemId,
          quantity_planned: edit.quantity_planned,
          return_reason: edit.return_reason,
        }));
        if (zwItems.length > 0) {
          await updateLinesM.mutateAsync({ id: zwDocId, data: { items: zwItems } });
        }
      }
      setIsEditing(false);
      setEditQtys({});
      setZwItemEdits({});
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  /* ── Header patch ───────────────────────────────────────────── */
  useEffect(() => {
    if (!doc) return;
    setHeaderDraft({
      driver_name: doc.driver_name ?? '',
      notes: doc.notes ?? '',
      issue_date: doc.issue_date ? doc.issue_date.slice(0, 10) : '',
    });
  }, [doc]);

  useEffect(() => {
    if (doc?.locked_for_edit) setCompleteOpen(false);
  }, [doc?.locked_for_edit]);

  const openCompleteForm = useCallback(() => {
    if (!doc || doc.locked_for_edit) return;
    setLineEdits(buildInitialLineEdits(doc.items));
    setReceiverName(doc.receiver_name?.trim() ? doc.receiver_name : '');
    setReturnsNotes(doc.returns_notes ?? '');
    setCompleteOpen(true);
    setActionError(null);
  }, [doc]);

  const closeCompleteForm = () => {
    setCompleteOpen(false);
    setActionError(null);
  };

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) return <Navigate to="/delivery" replace />;

  /* ── Action handlers ────────────────────────────────────────── */
  const onSave = async () => {
    setActionError(null);
    try {
      await saveM.mutateAsync({ id, returnItems: pendingReturns.length > 0 ? pendingReturns : undefined });
      setPendingReturns([]);
    }
    catch (e) { setActionError(errMsg(e)); }
  };

  const onStart = async () => {
    setActionError(null);
    try { await startM.mutateAsync(id); }
    catch (e) { setActionError(errMsg(e)); }
  };

  const onCompleteSubmit = async () => {
    if (!doc) return;
    setActionError(null);
    const items: DeliveryCompleteItemRow[] = doc.items.map((it) => {
      const row = lineEdits[it.id];
      return {
        id: it.id,
        quantity_actual: row?.quantity_actual?.trim() ? row.quantity_actual : undefined,
        quantity_returned: row?.quantity_returned?.trim() ? row.quantity_returned : '0',
        return_reason: row?.return_reason ?? '',
        is_damaged: row?.is_damaged ?? false,
        notes: row?.notes ?? '',
      };
    });
    try {
      await completeM.mutateAsync({ id, data: { items, receiver_name: receiverName.trim() || undefined, returns_notes: returnsNotes.trim() || undefined } });
      setCompleteOpen(false);
    } catch (e) { setActionError(errMsg(e)); }
  };

  const onHeaderSave = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await patchM.mutateAsync({
        id,
        data: {
          driver_name: headerDraft.driver_name.trim() || undefined,
          notes: headerDraft.notes.trim() || undefined,
          issue_date: headerDraft.issue_date || undefined,
        },
      });
    } catch (e) { setActionError(errMsg(e)); }
  };

  const onPrintWz = () => {
    if (!deliveryPreview) return;
    setPrintError(null);
    const opened = openWZPrintWindow(deliveryPreview);
    if (!opened) setPrintError('Nie udało się otworzyć widoku drukowania. Odśwież stronę i spróbuj ponownie.');
  };

  const locked = Boolean(doc?.locked_for_edit);
  const workflowBusy = saveM.isPending || startM.isPending || completeM.isPending || patchM.isPending || updateLinesM.isPending;

  /* ── Items to display (filter 0-qty in edit mode) ───────────── */
  const displayItems = doc
    ? isEditing
      ? doc.items.filter((it) => (editQtys[it.id] ?? 0) > 0)
      : doc.items
    : [];

  return (
    <div
      className={cn(
        'flex min-h-screen flex-col bg-background',
        isEditing
          ? 'pb-[calc(83px+14rem+env(safe-area-inset-bottom))] md:pb-60'
          : 'pb-[calc(83px+env(safe-area-inset-bottom))] md:pb-6',
      )}
    >
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-5 pb-4 pt-10">
          <div className="flex items-center gap-4">
            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => navigate('/delivery')}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
              aria-label="Wróć"
            >
              <ChevronLeftIcon />
            </motion.button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold text-foreground">
                {doc
                  ? `${doc.document_type} ${doc.document_number?.trim() ? doc.document_number : doc.id.slice(0, 8)}`
                  : 'Dokument WZ'}
              </h1>
              {doc && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      deliveryStatusBadgeClassName(doc.status),
                    )}
                  >
                    {DELIVERY_STATUS_LABELS_PL[doc.status]}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {doc.customer_name || '—'} · {formatIssueDate(doc.issue_date)}
                  </span>
                  {isFetching && (
                    <span className="text-[12px] text-muted-foreground">Aktualizowanie…</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Edit button (not locked, not already editing) */}
              {doc && !locked && !isEditing && (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={enterEditMode}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-card px-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-[13px] font-medium text-foreground"
                  aria-label="Edytuj ilości"
                >
                  <PencilIcon />
                  <span>Edytuj</span>
                </motion.button>
              )}
              {/* Print */}
              {doc && (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={onPrintWz}
                  disabled={!deliveryPreview || prevLoading}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)] disabled:opacity-40"
                  aria-label="Drukuj WZ"
                >
                  <PrintIcon />
                </motion.button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-3xl space-y-3 px-5 py-4">
        {isLoading && (
          <div className="flex justify-center py-16" aria-busy="true" role="status">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex flex-col gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
            <p className="text-sm text-destructive">{errMsg(error)}</p>
            <button type="button" onClick={() => void refetch()} className="self-start rounded-lg border border-border px-3 py-1.5 text-sm">
              Spróbuj ponownie
            </button>
          </div>
        )}

        {actionError && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}

        {printError && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {printError}
          </p>
        )}

        {doc && !isError && (
          <>
            {/* Van loaded banner (MM) */}
            {showVanLoadedBanner && doc.document_type === 'MM' && (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-sm text-foreground">
                  Van został załadowany.{' '}
                  <span className="text-muted-foreground">Numer dokumentu MM:</span>{' '}
                  <span className="font-semibold tabular-nums">
                    {doc.document_number?.trim() ? doc.document_number : '—'}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowVanLoadedBanner(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  Zamknij
                </button>
              </div>
            )}

            {/* Locked banner */}
            {locked && (
              <div
                role="status"
                className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground"
              >
                <p className="font-medium">Dokument powiązany z fakturą — edycja jest zablokowana.</p>
                {(doc.linked_invoices ?? []).length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1">
                    {(doc.linked_invoices ?? []).map((inv) => (
                      <li key={inv.id}>
                        <Link to={`/invoices/${inv.id}`} className="font-medium text-primary hover:underline">
                          Faktura {inv.invoice_number?.trim() ? inv.invoice_number : inv.id.slice(0, 8)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Order link */}
            {doc.order_id && (
              <p className="px-1 text-[13px] text-muted-foreground">
                Zamówienie:{' '}
                <Link to={`/orders/${doc.order_id}`} className="font-medium text-primary hover:underline">
                  {doc.order_number ?? doc.order_id.slice(0, 8)}
                </Link>
                {doc.driver_name?.trim() && ` · Kierowca: ${doc.driver_name}`}
              </p>
            )}

            {/* Items label */}
            <p className="px-1 text-[13px] text-muted-foreground">
              {displayItems.length === 1
                ? '1 pozycja'
                : displayItems.length >= 2 && displayItems.length <= 4
                  ? `${displayItems.length} pozycje`
                  : `${displayItems.length} pozycji`}
              {isEditing && (
                <span className="ml-2 text-amber-600">· tryb edycji</span>
              )}
            </p>

            {/* Item cards */}
            {displayItems.map((it, i) => (
              <WZItemCard
                key={it.id}
                item={it}
                label={productLabelForDeliveryLine(order, it)}
                isEditing={isEditing}
                editQty={editQtys[it.id] ?? (parseFloat(String(it.quantity_planned)) || 0)}
                onQtyChange={handleEditQtyChange}
                onRemove={handleEditRemove}
                index={i}
              />
            ))}

            {displayItems.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {isEditing ? 'Wszystkie pozycje zostały usunięte.' : 'Brak pozycji na tym dokumencie.'}
              </p>
            )}

            {/* Linked ZW return documents */}
            {(doc.return_documents ?? []).length > 0 && (
              <LinkedZWSection
                documents={doc.return_documents!}
                isEditing={isEditing}
                zwItemEdits={zwItemEdits}
                onZwItemChange={handleZwItemChange}
              />
            )}

            {/* Header metadata — collapsible */}
            {!locked && (
              <div className="rounded-2xl bg-card shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
                <button
                  type="button"
                  onClick={() => setHeaderOpen((o) => !o)}
                  className="flex w-full items-center justify-between px-4 py-3.5"
                >
                  <span className="text-[14px] font-medium text-foreground">Dane dokumentu</span>
                  <svg
                    className={cn('h-4 w-4 text-muted-foreground transition-transform', headerOpen && 'rotate-180')}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {headerOpen && (
                  <div className="border-t border-border/50 px-4 pb-4 pt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Data wystawienia"
                        type="date"
                        value={headerDraft.issue_date}
                        onChange={(e) => setHeaderDraft((s) => ({ ...s, issue_date: e.target.value }))}
                        id="delivery-header-issue-date"
                      />
                      <Input
                        label="Kierowca"
                        value={headerDraft.driver_name}
                        onChange={(e) => setHeaderDraft((s) => ({ ...s, driver_name: e.target.value }))}
                        id="delivery-header-driver"
                      />
                      <div className="sm:col-span-2">
                        <Input
                          label="Uwagi"
                          value={headerDraft.notes}
                          onChange={(e) => setHeaderDraft((s) => ({ ...s, notes: e.target.value }))}
                          id="delivery-header-notes"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Button
                          type="button"
                          onClick={() => void onHeaderSave()}
                          disabled={workflowBusy}
                          id="delivery-header-save"
                        >
                          {patchM.isPending ? 'Zapisywanie…' : 'Zapisz dane dokumentu'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Return items (draft WZ only) */}
            {!isEditing && doc.status === 'draft' && doc.document_type === 'WZ' && (
              <ReturnItemsSection
                items={pendingReturns}
                onChange={setPendingReturns}
              />
            )}

            {/* Workflow buttons */}
            {!isEditing && (
              <div className="flex flex-wrap gap-2 pt-1">
                {doc.status === 'draft' && (
                  <Button type="button" onClick={() => void onSave()} disabled={workflowBusy || locked} id="delivery-action-save">
                    {saveM.isPending ? 'Zapisywanie…' : 'Zapisz WZ'}
                  </Button>
                )}
                {doc.status === 'saved' && (
                  <Button type="button" onClick={() => void onStart()} disabled={workflowBusy || locked} id="delivery-action-start">
                    {startM.isPending ? 'Uruchamianie…' : 'Rozpocznij dostawę'}
                  </Button>
                )}
                {doc.status === 'in_transit' && (
                  <Button
                    type="button"
                    variant={completeOpen ? 'outline' : 'default'}
                    onClick={() => (completeOpen ? closeCompleteForm() : openCompleteForm())}
                    disabled={(workflowBusy && !completeOpen) || locked}
                    id="delivery-action-complete-toggle"
                  >
                    {completeOpen ? 'Anuluj formularz' : 'Zakończ dostawę'}
                  </Button>
                )}
              </div>
            )}

            {/* Complete delivery form */}
            {doc.status === 'in_transit' && completeOpen && !locked && (
              <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
                <h3 className="mb-1 text-[15px] font-semibold text-foreground">Zakończenie dostawy</h3>
                <p className="mb-4 text-[13px] text-muted-foreground">
                  Uzupełnij ilości faktycznie dostarczone i ewentualne zwroty.
                </p>

                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Odbiorca"
                    value={receiverName}
                    onChange={(e) => setReceiverName(e.target.value)}
                    id="delivery-complete-receiver"
                  />
                  <Input
                    label="Uwagi do zwrotów"
                    value={returnsNotes}
                    onChange={(e) => setReturnsNotes(e.target.value)}
                    id="delivery-complete-returns-notes"
                  />
                </div>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="min-w-full divide-y divide-border text-sm" aria-label="Linie WZ — zakończenie">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Produkt</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Zaplan.</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Faktyczna</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Zwrot</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Powód</th>
                        <th className="px-3 py-2 text-center font-medium text-muted-foreground">Uszk.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {doc.items.map((it) => {
                        const row = lineEdits[it.id] ?? buildInitialLineEdits([it])[it.id];
                        return (
                          <tr key={it.id}>
                            <td className="max-w-[180px] px-3 py-2 text-foreground">
                              {productLabelForDeliveryLine(order, it)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                              {qtyStr(it.quantity_planned)}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                id={`qa-${it.id}`}
                                type="text"
                                inputMode="decimal"
                                aria-label={`Ilość faktyczna ${it.id}`}
                                className="flex h-9 w-full min-w-[5rem] rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={row.quantity_actual}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({ ...prev, [it.id]: { ...row, quantity_actual: e.target.value } }))
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                id={`qr-${it.id}`}
                                type="text"
                                inputMode="decimal"
                                aria-label={`Zwrot ${it.id}`}
                                className="flex h-9 w-full min-w-[5rem] rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={row.quantity_returned}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({ ...prev, [it.id]: { ...row, quantity_returned: e.target.value } }))
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                aria-label={`Powód zwrotu ${it.id}`}
                                className="flex h-9 w-full min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={row.return_reason}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({ ...prev, [it.id]: { ...row, return_reason: e.target.value } }))
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={row.is_damaged}
                                aria-label={`Uszkodzono ${it.id}`}
                                onChange={(e) =>
                                  setLineEdits((prev) => ({ ...prev, [it.id]: { ...row, is_damaged: e.target.checked } }))
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void onCompleteSubmit()} disabled={completeM.isPending} id="delivery-complete-submit">
                    {completeM.isPending ? 'Wysyłanie…' : 'Potwierdź zakończenie dostawy'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeCompleteForm} disabled={completeM.isPending}>
                    Zamknij
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Fixed bottom panel — shown only in edit mode */}
      {doc && !isError && isEditing && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={cn(
            'fixed left-0 right-0 z-40 px-5',
            'bottom-[calc(83px+env(safe-area-inset-bottom))] md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto max-w-3xl rounded-2xl bg-card p-5 shadow-[0_-4px_32px_rgba(0,0,0,0.10)]">
            <p className="mb-4 text-[13px] text-muted-foreground">
              Zmień ilości zaplanowane na tym dokumencie WZ.
            </p>
            <div className="flex flex-col gap-2">
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={() => void handleSaveEditedLines()}
                disabled={updateLinesM.isPending}
                className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                {updateLinesM.isPending ? 'Zapisywanie…' : 'Zapisz zmiany'}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={cancelEdit}
                disabled={updateLinesM.isPending}
                className="w-full rounded-xl border border-border py-3 text-[14px] font-medium text-muted-foreground disabled:opacity-60"
              >
                Anuluj
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

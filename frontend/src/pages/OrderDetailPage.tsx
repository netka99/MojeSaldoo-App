import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { isOrderCancellableStatus } from '@/lib/order-status-history';
import { orderStatusBadgeClassName } from '@/lib/order-utils';
import { useDeliveryByOrderQuery, useGenerateDeliveryForOrderMutation, useSyncWzFromOrderMutation } from '@/query/use-delivery';
import {
  useCancelOrderMutation,
  useConfirmOrderMutation,
  useOrderChangelogQuery,
  useOrderQuery,
  useUpdateOrderMutation,
} from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';
import { openOrderPrintWindow } from '@/lib/openOrderPrintWindow';
import type { DeliveryDocument, OrderItem } from '@/types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function money(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(n) ? pln.format(n as number) : '—';
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : plDate.format(d);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Wystąpił błąd';
}

function itemCountLabel(n: number): string {
  if (n === 1) return '1 pozycja';
  if (n >= 2 && n <= 4) return `${n} pozycje`;
  return `${n} pozycji`;
}

/* ── Local editable line ────────────────────────────────────────── */
type EditLine = { item: OrderItem; quantity: number };

function buildEditLines(items: OrderItem[]): EditLine[] {
  return items.map((item) => ({
    item,
    quantity: parseFloat(String(item.quantity)) || 0,
  }));
}

/* ── Icons ─────────────────────────────────────────────────────── */
function PencilIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
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

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
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

/* ── Item card ─────────────────────────────────────────────────── */
interface ItemCardProps {
  line: EditLine;
  isDraft: boolean;
  index: number;
  onQtyChange: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
}

function ItemCard({ line, isDraft, index, onQtyChange, onRemove }: ItemCardProps) {
  const { item, quantity } = line;
  const unit = item.product_unit || 'szt.';
  const grossPerUnit = parseFloat(String(item.unit_price_gross)) || 0;
  const lineGross = grossPerUnit * quantity;
  const disc = parseFloat(String(item.discount_percent)) || 0;
  const hasDiscount = disc > 0;
  const lineGrossNoDisc = lineGross;
  const lineGrossAfterDisc = hasDiscount ? lineGross * (1 - disc / 100) : lineGross;
  const qtyDisplay = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-2xl bg-card p-4 shadow-[0_2px_12px_rgba(26,28,31,0.07)]"
    >
      {/* Top row: avatar + name + total */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-semibold text-primary"
          aria-hidden
        >
          {(item.product_name ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15px] font-medium text-foreground">{item.product_name}</h4>
          <p className="text-[13px] text-muted-foreground">
            {money(item.unit_price_gross)} / {unit}
          </p>
          {hasDiscount && (
            <p className="mt-0.5 text-[12px] text-primary">Rabat: {disc}%</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[15px] font-semibold text-foreground">
            {money(hasDiscount ? lineGrossAfterDisc : lineGrossNoDisc)}
          </p>
          {hasDiscount && (
            <p className="text-[12px] text-muted-foreground line-through">{money(lineGrossNoDisc)}</p>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
        {isDraft ? (
          /* Editable: trash + stepper */
          <>
            <motion.button
              whileTap={{ scale: 0.9 }}
              type="button"
              aria-label={`Usuń ${item.product_name}`}
              onClick={() => onRemove(item.product_id)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
            >
              <TrashIcon />
            </motion.button>
            <div className="flex items-center gap-3">
              <motion.button
                whileTap={{ scale: 0.9 }}
                type="button"
                aria-label="Zmniejsz ilość"
                onClick={() => onQtyChange(item.product_id, -1)}
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
                onClick={() => onQtyChange(item.product_id, 1)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <PlusIcon />
              </motion.button>
            </div>
          </>
        ) : (
          /* Read-only: just quantity */
          <span className="ml-auto text-[13px] text-muted-foreground">
            Ilość:{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {qtyDisplay} {unit}
            </span>
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* ── Delivery docs section ─────────────────────────────────────── */

const DELIVERY_STATUS_PL: Record<string, string> = {
  draft: 'Szkic',
  saved: 'Zapisano',
  in_transit: 'W drodze',
  delivered: 'Dostarczono',
  cancelled: 'Anulowano',
};

function deliveryStatusBadgeClass(status: string): string {
  switch (status) {
    case 'saved':     return 'bg-emerald-50 text-emerald-700';
    case 'in_transit':return 'bg-amber-50 text-amber-700';
    case 'delivered': return 'bg-blue-50 text-blue-700';
    case 'cancelled': return 'bg-red-50 text-red-600';
    default:          return 'bg-muted text-muted-foreground';
  }
}

function TruckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M9 14l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10h11a4 4 0 010 8h-1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightSmall() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const plDateShort = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });
function shortDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : plDateShort.format(d);
}

/* ── Change history ─────────────────────────────────────────────── */
const CHANGE_LABELS: Record<string, string> = {
  added: 'Dodano',
  removed: 'Usunięto',
  qty_changed: 'Zmiana ilości',
  price_changed: 'Zmiana ceny',
};

const plDateTime = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function formatChangeLine(entry: { change_type: string; product_name: string; product_unit: string; quantity_before: string | null; quantity_after: string | null; unit_price_gross_before: string | null; unit_price_gross_after: string | null }): string {
  const unit = entry.product_unit ? ` ${entry.product_unit}` : '';
  switch (entry.change_type) {
    case 'added':    return `${entry.product_name}: dodano ${entry.quantity_after}${unit}`;
    case 'removed':  return `${entry.product_name}: usunięto (było ${entry.quantity_before}${unit})`;
    case 'qty_changed': return `${entry.product_name}: ${entry.quantity_before} → ${entry.quantity_after}${unit}`;
    case 'price_changed': return `${entry.product_name}: cena ${entry.unit_price_gross_before} → ${entry.unit_price_gross_after} zł`;
    default: return entry.product_name;
  }
}

function ChevronDownSmall() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpSmall() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChangeHistorySection({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const { data: entries, isLoading } = useOrderChangelogQuery(open ? orderId : undefined);

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-[14px] font-medium text-foreground"
        aria-expanded={open}
      >
        <span>Historia zmian</span>
        {open ? <ChevronUpSmall /> : <ChevronDownSmall />}
      </button>

      {open && (
        <div className="border-t border-border/40 px-5 pb-4 pt-3">
          {isLoading && (
            <p className="text-[13px] text-muted-foreground">Ładowanie…</p>
          )}
          {!isLoading && (!entries || entries.length === 0) && (
            <p className="text-[13px] text-muted-foreground">Brak zapisanych zmian.</p>
          )}
          {entries && entries.length > 0 && (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <li key={entry.id} className="border-b border-border/40 pb-3 last:border-0 last:pb-0">
                  <p className="text-[11px] text-muted-foreground">
                    {plDateTime.format(new Date(entry.changed_at))}
                    {entry.changed_by_name ? ` · ${entry.changed_by_name}` : ''}
                    {entry.change_type !== 'qty_changed' && (
                      <span className="ml-1 font-medium text-primary/80">
                        [{CHANGE_LABELS[entry.change_type] ?? entry.change_type}]
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[13px] text-foreground">{formatChangeLine(entry)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OrderDeliveryDocs({ orderId, items }: { orderId: string; items?: OrderItem[] }) {
  const navigate = useNavigate();
  const { data: docs, isLoading } = useDeliveryByOrderQuery(orderId);

  const wzDocs = docs?.filter((d) => d.document_type === 'WZ') ?? [];
  const totalZwCount = wzDocs.reduce((sum, wz) => sum + (wz.return_documents?.length ?? 0), 0);

  const totalOrdered = items?.reduce((s, i) => s + (parseFloat(String(i.quantity)) || 0), 0) ?? 0;
  const totalDelivered = items?.reduce((s, i) => s + (parseFloat(String(i.quantity_delivered)) || 0), 0) ?? 0;
  const showProgress = items && items.length > 0 && wzDocs.length > 0;
  const isPartial = totalDelivered > 0 && totalDelivered < totalOrdered;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-3 text-[13px] text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        Ładowanie dokumentów…
      </div>
    );
  }

  return (
    <section aria-label="Dokumenty dostawy">
      <div className="mb-2 flex items-center gap-2 px-1">
        <TruckIcon />
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dokumenty dostawy
        </h3>
        {wzDocs.length > 0 && (
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
            {wzDocs.length} WZ{totalZwCount > 0 ? ` · ${totalZwCount} ZW` : ''}
          </span>
        )}
      </div>

      {wzDocs.length === 0 ? (
        <p className="rounded-2xl bg-surface-card px-4 py-3 text-[13px] text-muted-foreground">
          Brak dokumentów WZ dla tego zamówienia.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {wzDocs.map((wz) => (
            <WzDocRow key={wz.id} wz={wz} onNavigate={() => navigate(`/delivery/${wz.id}`)} />
          ))}
        </div>
      )}

      {showProgress && (
        <div className={cn(
          'mt-2 rounded-xl px-4 py-2.5 text-[13px]',
          isPartial
            ? 'bg-orange-50 text-orange-800'
            : 'bg-green-50 text-green-800',
        )}>
          Dostarczone łącznie:{' '}
          <strong>{totalDelivered} / {totalOrdered}</strong>
          {isPartial && (
            <span className="ml-2">· brakuje {(totalOrdered - totalDelivered).toFixed(2).replace(/\.?0+$/, '')} szt.</span>
          )}
        </div>
      )}
    </section>
  );
}

function WzDocRow({ wz, onNavigate }: { wz: DeliveryDocument; onNavigate: () => void }) {
  const zwDocs = wz.return_documents ?? [];
  const itemCount = wz.items.length;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface-card shadow-soft">
      {/* WZ row */}
      <button
        type="button"
        onClick={onNavigate}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-low/40 active:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">
              {wz.document_number ?? '—'}
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', deliveryStatusBadgeClass(wz.status))}>
              {DELIVERY_STATUS_PL[wz.status] ?? wz.status}
            </span>
            {wz.locked_for_edit && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                Zafakturowane
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {shortDate(wz.issue_date)} · {itemCount} {itemCount === 1 ? 'pozycja' : itemCount <= 4 ? 'pozycje' : 'pozycji'}
            {wz.driver_name ? ` · ${wz.driver_name}` : ''}
          </p>
        </div>
        <ChevronRightSmall />
      </button>

      {/* ZW sub-rows */}
      {zwDocs.map((zw) => (
        <div
          key={zw.id}
          className="flex items-center gap-2 border-t border-border/40 bg-amber-50/60 px-4 py-2"
        >
          <ReturnIcon />
          <span className="flex-1 text-[12px] text-amber-800">
            {zw.document_number ?? 'ZW'} · {shortDate(zw.issue_date)}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', deliveryStatusBadgeClass(zw.status))}>
            {DELIVERY_STATUS_PL[zw.status] ?? zw.status}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: order, isLoading, isError, error, refetch } = useOrderQuery(id, Boolean(id));
  const confirmM = useConfirmOrderMutation();
  const cancelM = useCancelOrderMutation();
  const generateWzM = useGenerateDeliveryForOrderMutation();
  const syncWzM = useSyncWzFromOrderMutation();
  const updateM = useUpdateOrderMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [wzDatePicker, setWzDatePicker] = useState<string | null>(null); // null = hidden, string = date value

  const isDraft = order?.status === 'draft';
  const canEdit =
    order?.status !== 'invoiced' && order?.status !== 'cancelled';

  /* isEditing: draft is always in edit mode; other statuses toggle via button */
  const [isEditing, setIsEditing] = useState(false);

  /* ── WZ availability logic (B+C) ──────────────────────────────── */
  const { data: wzDocs } = useDeliveryByOrderQuery(id, order?.status === 'confirmed');
  const deliveryModuleEnabled = useModuleGuard('delivery');
  const canManageDelivery = usePermission('can_manage_delivery');

  const canGenerateWz = (() => {
    if (!deliveryModuleEnabled || !canManageDelivery) return false;
    if (order?.status !== 'confirmed') return false;
    if (isEditing) return false;
    const docs = wzDocs ?? [];

    // C: block if any WZ is currently active (draft or in_transit)
    const hasActiveWz = docs.some(
      (d) => d.document_type === 'WZ' && (d.status === 'draft' || d.status === 'in_transit'),
    );
    if (hasActiveWz) return false;

    // B: show if any order item has remaining undelivered quantity
    const coveredQty = new Map<string, number>();
    for (const doc of docs) {
      if (doc.document_type !== 'WZ' || doc.status === 'cancelled') continue;
      for (const item of doc.items) {
        const prev = coveredQty.get(item.product_id) ?? 0;
        coveredQty.set(item.product_id, prev + (parseFloat(String(item.quantity_planned)) || 0));
      }
    }
    const items = order?.items ?? [];
    if (items.length === 0) return false;
    return items.some((item) => {
      const ordered = parseFloat(String(item.quantity)) || 0;
      const covered = coveredQty.get(item.product_id) ?? 0;
      return ordered > covered;
    });
  })();

  /* Local editable lines */
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editDate, setEditDate] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  /* Sync edit lines when order loads / changes */
  useEffect(() => {
    if (order?.items) {
      setEditLines(buildEditLines(order.items));
      setIsDirty(false);
      /* stay in editing mode if user had it open */
    }
  }, [order?.items]);

  /* Sync editDate when order loads */
  useEffect(() => {
    if (order?.delivery_date) setEditDate(order.delivery_date);
  }, [order?.delivery_date]);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) return <Navigate to="/orders" replace />;

  const backUrl = order?.delivery_date ? `/orders?date=${order.delivery_date}` : '/orders';

  /* ── Edit handlers ───────────────────────────────────────────── */
  const handleQtyChange = (productId: string, delta: number) => {
    setEditLines((prev) =>
      prev.map((l) =>
        l.item.product_id === productId
          ? { ...l, quantity: Math.max(0, l.quantity + delta) }
          : l,
      ).filter((l) => l.quantity > 0),
    );
    setIsDirty(true);
  };

  const handleRemove = (productId: string) => {
    setEditLines((prev) => prev.filter((l) => l.item.product_id !== productId));
    setIsDirty(true);
  };

  const handleSaveChanges = async () => {
    if (!order) return;
    setActionError(null);
    try {
      await updateM.mutateAsync({
        id,
        body: {
          customer_id: order.customer_id,
          delivery_date: editDate || order.delivery_date,
          items: editLines.map((l) => ({
            product_id: l.item.product_id,
            quantity: String(l.quantity),
            unit_price_net: String(l.item.unit_price_net),
            unit_price_gross: String(l.item.unit_price_gross),
            vat_rate: String(l.item.vat_rate),
            discount_percent: String(l.item.discount_percent),
          })),
        },
      });

      // Auto-sync any draft/saved WZ linked to this order
      const activeDraftWz = (wzDocs ?? []).filter(
        (d) => d.document_type === 'WZ' && (d.status === 'draft' || d.status === 'saved'),
      );
      for (const wz of activeDraftWz) {
        await syncWzM.mutateAsync(wz.id);
      }

      setIsDirty(false);
      setIsEditing(false);
    } catch (e) {
      setActionError(errMsg(e));
    }
  };

  /* ── Actions ─────────────────────────────────────────────────── */
  const onConfirm = async () => {
    setActionError(null);
    try { await confirmM.mutateAsync(id); }
    catch (e) { setActionError(errMsg(e)); }
  };

  const onCancel = async () => {
    if (!window.confirm('Czy na pewno anulować to zamówienie?')) return;
    setActionError(null);
    try { await cancelM.mutateAsync(id); }
    catch (e) { setActionError(errMsg(e)); }
  };

  const onCreateWz = async (issueDate: string) => {
    setActionError(null);
    try {
      const doc = await generateWzM.mutateAsync({ orderId: id!, issueDate });
      setWzDatePicker(null);
      navigate(`/delivery/${doc.id}`);
    } catch (e) { setActionError(errMsg(e)); }
  };

  /* ── Totals (from local edit lines when editing, else from API) ── */
  const useLocalLines = isDraft || isEditing;
  const displayLines = useLocalLines
    ? editLines
    : (order?.items ?? []).map((item) => ({
        item,
        quantity: parseFloat(String(item.quantity)) || 0,
      }));

  const computedTotal = displayLines.reduce((sum, l) => {
    const gross = parseFloat(String(l.item.unit_price_gross)) || 0;
    const disc = parseFloat(String(l.item.discount_percent)) || 0;
    return sum + gross * l.quantity * (1 - disc / 100);
  }, 0);

  const computedSubtotal = displayLines.reduce((sum, l) => {
    const gross = parseFloat(String(l.item.unit_price_gross)) || 0;
    return sum + gross * l.quantity;
  }, 0);

  const totalGross = useLocalLines ? computedTotal : (parseFloat(String(order?.total_gross ?? 0)) || 0);
  const subtotalGross = useLocalLines ? computedSubtotal : (parseFloat(String(order?.subtotal_gross ?? 0)) || 0);
  const totalDiscount = subtotalGross - totalGross;

  return (
    <div className={cn(
      'flex min-h-screen flex-col bg-background',
      'pb-[calc(83px+7rem+env(safe-area-inset-bottom))] md:pb-36',
    )}>
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-5 pb-4 pt-10">
          <div className="flex items-center gap-4">
            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
              aria-label="Wróć"
            >
              <ChevronLeftIcon />
            </motion.button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold text-foreground">
                {order ? `Zamówienie — ${order.customer_name}` : 'Zamówienie'}
              </h1>
              {order && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', orderStatusBadgeClassName(order.status))}>
                    {ORDER_STATUS_LABELS_PL[order.status]}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {order.order_number} · dostawa {formatDate(order.delivery_date)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Anuluj zamówienie — next to Edytuj when cancellable */}
              {order && isOrderCancellableStatus(order.status) && !isEditing && (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => void onCancel()}
                  disabled={cancelM.isPending}
                  className="flex h-10 items-center gap-1.5 rounded-full border border-destructive/40 bg-card px-3 text-[13px] font-medium text-destructive shadow-[0_2px_8px_rgba(0,0,0,0.08)] disabled:opacity-60"
                  aria-label="Anuluj zamówienie"
                >
                  <span>{cancelM.isPending ? '…' : 'Anuluj'}</span>
                </motion.button>
              )}
              {/* Edytuj button — non-draft editable orders only */}
              {order && canEdit && !isDraft && !isEditing && (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => { setIsEditing(true); setActionError(null); }}
                  className="flex h-10 items-center gap-1.5 rounded-full bg-card px-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-[13px] font-medium text-foreground"
                  aria-label="Edytuj zamówienie"
                >
                  <PencilIcon />
                  <span>Edytuj</span>
                </motion.button>
              )}
              {/* Print */}
              {order && (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => {
                    setPrintError(null);
                    const ok = openOrderPrintWindow(order);
                    if (!ok) setPrintError('Nie udało się otworzyć widoku drukowania.');
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
                  aria-label="Drukuj zamówienie"
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

        {order && !isError && (
          <>
            {(isDraft || isEditing) && (
              <div className="rounded-2xl bg-surface-card px-4 py-3 shadow-soft">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Data dostawy
                </label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => { setEditDate(e.target.value); setIsDirty(true); }}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </div>
            )}

            <p className="px-1 text-[13px] text-muted-foreground">
              {itemCountLabel(displayLines.length)}
              {(isDraft || isEditing) && isDirty && (
                <span className="ml-2 text-amber-600">· niezapisane zmiany</span>
              )}
              {isEditing && !isDirty && (
                <span className="ml-2 text-amber-600">· tryb edycji</span>
              )}
            </p>

            {displayLines.map((l, i) => (
              <ItemCard
                key={l.item.product_id}
                line={l}
                isDraft={isDraft || isEditing}
                index={i}
                onQtyChange={handleQtyChange}
                onRemove={handleRemove}
              />
            ))}

            {displayLines.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">Brak pozycji.</p>
            )}

            {/* Totals card — inline below items */}
            <div className="rounded-2xl bg-card px-5 py-4 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
              <div className="space-y-2">
                <div className="flex justify-between text-[14px]">
                  <span className="text-muted-foreground">Suma pozycji</span>
                  <span className="tabular-nums text-foreground">{money(subtotalGross)}</span>
                </div>
                {totalDiscount > 0.001 && (
                  <div className="flex justify-between text-[14px]">
                    <span className="text-primary">Rabaty</span>
                    <span className="tabular-nums text-primary">−{money(totalDiscount)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-border/60 pt-2">
                  <span className="text-[17px] font-semibold text-foreground">Razem brutto</span>
                  <span className="text-[22px] font-bold tabular-nums text-foreground">{money(totalGross)}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Delivery documents — WZ + ZW linked to this order */}
        {order && !isError && id && (
          <OrderDeliveryDocs orderId={id} items={order.items} />
        )}

        {/* Change history */}
        {order && !isError && id && (
          <ChangeHistorySection orderId={id} />
        )}
      </main>

      {/* Fixed bottom panel — actions only, no totals */}
      {order && !isError && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={cn(
            'fixed left-0 right-0 z-40',
            'bottom-[calc(96px+env(safe-area-inset-bottom))] md:bottom-4 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto max-w-3xl px-5">
          <div className="rounded-2xl bg-card p-4 shadow-[0_-4px_32px_rgba(0,0,0,0.10)]">
            <div className="flex flex-col gap-2">

              {/* Save changes (editing + dirty) */}
              {((isDraft && isDirty) || (isEditing && isDirty)) && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => void handleSaveChanges()}
                  disabled={updateM.isPending || syncWzM.isPending}
                  className="w-full rounded-xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {syncWzM.isPending ? 'Aktualizacja WZ…' : updateM.isPending ? 'Zapisywanie…' : 'Zapisz zmiany'}
                </motion.button>
              )}

              {/* Done editing (non-dirty) */}
              {isEditing && !isDirty && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="w-full rounded-xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground"
                >
                  Gotowe
                </motion.button>
              )}

              {/* Discard edit changes */}
              {isEditing && isDirty && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => { setEditLines(buildEditLines(order.items)); setIsDirty(false); setIsEditing(false); }}
                  disabled={updateM.isPending}
                  className="w-full rounded-xl border border-border py-2.5 text-[14px] font-medium text-muted-foreground disabled:opacity-60"
                >
                  Anuluj zmiany
                </motion.button>
              )}

              {/* Confirm draft */}
              {isDraft && !isDirty && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => void onConfirm()}
                  disabled={confirmM.isPending || displayLines.length === 0}
                  className="w-full rounded-xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {confirmM.isPending ? 'Potwierdzanie…' : 'Potwierdź zamówienie'}
                </motion.button>
              )}

              {/* Generuj WZ — inline date picker then confirm */}
              {!isEditing && !isDraft && (
                <div className="flex flex-col gap-2">
                  {canGenerateWz && wzDatePicker !== null && (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
                      <label className="shrink-0 text-sm text-muted-foreground">Data WZ:</label>
                      <input
                        type="date"
                        value={wzDatePicker}
                        onChange={(e) => setWzDatePicker(e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        type="button"
                        onClick={() => void onCreateWz(wzDatePicker)}
                        disabled={generateWzM.isPending || !wzDatePicker}
                        className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[13px] font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {generateWzM.isPending ? 'WZ…' : 'Potwierdź'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWzDatePicker(null)}
                        className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {canGenerateWz && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => setWzDatePicker((prev) => prev !== null ? prev : (order?.delivery_date ?? new Date().toISOString().slice(0, 10)))}
                        disabled={generateWzM.isPending}
                        className="w-1/3 shrink-0 rounded-xl bg-primary py-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        Generuj WZ
                      </motion.button>
                    )}
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => navigate(backUrl)}
                      className={cn(
                        'rounded-xl border border-border py-3 text-[14px] font-medium text-foreground',
                        canGenerateWz ? 'flex-1' : 'w-full',
                      )}
                    >
                      Wróć do zamówień
                    </motion.button>
                  </div>
                </div>
              )}

            </div>
          </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

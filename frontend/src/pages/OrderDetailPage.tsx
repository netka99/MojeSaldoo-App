import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { isOrderCancellableStatus } from '@/lib/order-status-history';
import { orderStatusBadgeClassName } from '@/lib/order-utils';
import { useGenerateDeliveryForOrderMutation } from '@/query/use-delivery';
import {
  useCancelOrderMutation,
  useConfirmOrderMutation,
  useOrderQuery,
  useUpdateOrderMutation,
} from '@/query/use-orders';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { openOrderPrintWindow } from '@/lib/openOrderPrintWindow';
import type { OrderItem } from '@/types';

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

/* ── Page ──────────────────────────────────────────────────────── */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: order, isLoading, isError, error, refetch } = useOrderQuery(id, Boolean(id));
  const confirmM = useConfirmOrderMutation();
  const cancelM = useCancelOrderMutation();
  const generateWzM = useGenerateDeliveryForOrderMutation();
  const updateM = useUpdateOrderMutation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  const isDraft = order?.status === 'draft';
  const canEdit =
    order?.status !== 'invoiced' && order?.status !== 'cancelled';

  /* isEditing: draft is always in edit mode; other statuses toggle via button */
  const [isEditing, setIsEditing] = useState(false);

  /* Local editable lines */
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  /* Sync edit lines when order loads / changes */
  useEffect(() => {
    if (order?.items) {
      setEditLines(buildEditLines(order.items));
      setIsDirty(false);
      /* stay in editing mode if user had it open */
    }
  }, [order?.items]);

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
    if (!order || !isDraft) return;
    setActionError(null);
    try {
      await updateM.mutateAsync({
        id,
        body: {
          customer_id: order.customer_id,
          delivery_date: order.delivery_date,
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

  const onCreateWz = async () => {
    setActionError(null);
    try {
      const doc = await generateWzM.mutateAsync(id);
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
      'pb-[calc(83px+18rem+env(safe-area-inset-bottom))] md:pb-72',
    )}>
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-5 pb-4 pt-10">
          <div className="flex items-center gap-4">
            <motion.button
              whileTap={{ scale: 0.94 }}
              type="button"
              onClick={() => navigate(backUrl)}
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
          </>
        )}
      </main>

      {/* Fixed bottom panel */}
      {order && !isError && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={cn(
            'fixed left-0 right-0 z-40 px-5',
            'bottom-[calc(83px+env(safe-area-inset-bottom))] md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto max-w-3xl rounded-2xl bg-card p-5 shadow-[0_-4px_32px_rgba(0,0,0,0.10)]">
            {/* Summary */}
            <div className="mb-4 space-y-2">
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

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {/* Save changes (draft always, or non-draft when editing + dirty) */}
              {(isDraft && isDirty) || (isEditing && isDirty) ? (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => void handleSaveChanges()}
                  disabled={updateM.isPending}
                  className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {updateM.isPending ? 'Zapisywanie…' : 'Zapisz zmiany'}
                </motion.button>
              ) : null}

              {/* Cancel edit mode (non-draft, not dirty) */}
              {isEditing && !isDirty && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground"
                >
                  Gotowe
                </motion.button>
              )}

              {/* Anuluj edycję (when editing + dirty) */}
              {isEditing && isDirty && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => { setEditLines(buildEditLines(order.items)); setIsDirty(false); setIsEditing(false); }}
                  disabled={updateM.isPending}
                  className="w-full rounded-xl border border-border py-3 text-[14px] font-medium text-muted-foreground disabled:opacity-60"
                >
                  Anuluj zmiany
                </motion.button>
              )}

              {/* Confirm (draft + no dirty changes) */}
              {isDraft && !isDirty && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => void onConfirm()}
                  disabled={confirmM.isPending || displayLines.length === 0}
                  className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {confirmM.isPending ? 'Potwierdzanie…' : 'Potwierdź zamówienie'}
                </motion.button>
              )}

              {/* Generate WZ */}
              {order.status === 'confirmed' && !isEditing && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => void onCreateWz()}
                  disabled={generateWzM.isPending}
                  className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {generateWzM.isPending ? 'Tworzenie WZ…' : 'Generuj WZ'}
                </motion.button>
              )}

              {/* Cancel order */}
              {isOrderCancellableStatus(order.status) && !isEditing && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => void onCancel()}
                  disabled={cancelM.isPending}
                  className="w-full rounded-xl border border-destructive/40 py-3 text-[14px] font-medium text-destructive disabled:opacity-60"
                >
                  {cancelM.isPending ? 'Anulowanie…' : 'Anuluj zamówienie'}
                </motion.button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

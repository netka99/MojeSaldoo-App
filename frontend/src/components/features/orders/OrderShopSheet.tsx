import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { formatMoneyGross, orderStatusBadgeClassName } from '@/lib/order-utils';
import { useGenerateDeliveryForOrderMutation } from '@/query/use-delivery';
import { useConfirmOrderMutation } from '@/query/use-orders';
import { cn } from '@/lib/utils';
import type { Customer, Order, OrderItem } from '@/types';

function XIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function ProductRow({ item }: { item: OrderItem }) {
  const qty = parseFloat(String(item.quantity)) || 0;
  const unit = (item.product_unit || 'szt.').trim();
  const priceGross = parseFloat(String(item.unit_price_gross)) || 0;
  const name = item.product_name ?? '—';
  const initial = name.trim().charAt(0).toUpperCase();

  const qtyDisplay = Number.isInteger(qty)
    ? String(qty)
    : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(qty);

  return (
    <div className="flex items-center gap-4 rounded-xl bg-secondary/40 p-3.5">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-semibold text-primary"
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-foreground">{name}</p>
        <p className="text-[13px] text-muted-foreground">
          {priceGross.toFixed(2)} zł / {unit}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[17px] font-semibold tabular-nums text-foreground">
          {qtyDisplay} <span className="text-[13px] font-normal text-muted-foreground">{unit}</span>
        </p>
        {item.line_total_gross && (
          <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
            {formatMoneyGross(item.line_total_gross)}
          </p>
        )}
      </div>
    </div>
  );
}

export interface OrderShopSheetProps {
  customer: Customer | null;
  order: Order | null;
  /** ISO date string — used for "new order" navigation. */
  date: string;
  isOpen: boolean;
  onClose: () => void;
}

export function OrderShopSheet({ customer, order, date, isOpen, onClose }: OrderShopSheetProps) {
  const navigate = useNavigate();
  const confirmM = useConfirmOrderMutation();
  const generateWzM = useGenerateDeliveryForOrderMutation();

  const items: OrderItem[] = order?.items ?? [];
  const isDraft = order?.status === 'draft';
  const isConfirmed = order?.status === 'confirmed';
  const displayName = order?.customer_name ?? customer?.name ?? '—';

  return (
    <AnimatePresence>
      {isOpen && (customer || order) ? (
        <>
          {/* Backdrop */}
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-foreground/10 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />

          {/* Sheet */}
          <motion.div
            key="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label={`Zamówienie ${displayName}`}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-3xl bg-card shadow-[0_-8px_32px_rgba(0,0,0,0.12)]"
          >
            {/* Drag handle */}
            <div className="flex shrink-0 justify-center pt-3 pb-1" aria-hidden>
              <div className="h-1 w-9 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="shrink-0 border-b border-border/60 px-5 pb-3 pt-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[17px] font-semibold leading-snug text-foreground">
                    {displayName}
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {order ? (
                      <>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            orderStatusBadgeClassName(order.status),
                          )}
                        >
                          {ORDER_STATUS_LABELS_PL[order.status]}
                        </span>
                        {order.order_number && (
                          <span className="text-[13px] text-muted-foreground">{order.order_number}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">Brak zamówienia na ten dzień</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Zamknij"
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary transition-colors hover:bg-muted"
                >
                  <XIcon />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {!order ? (
                /* No order state */
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <PlusIcon />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Brak zamówienia</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Nie ma jeszcze zamówienia dla tego sklepu na wybrany dzień.
                    </p>
                  </div>
                </div>
              ) : items.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Brak produktów w zamówieniu.
                </p>
              ) : (
                <div className="space-y-2.5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Produkty
                  </p>
                  {items.map((item, i) => (
                    <ProductRow key={item.id ?? `${item.product_id}-${i}`} item={item} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-border/60 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {order && (
                <div className="mb-4 flex items-baseline justify-between">
                  <span className="text-[15px] text-muted-foreground">Razem</span>
                  <span className="text-[22px] font-semibold tabular-nums text-foreground">
                    {formatMoneyGross(order.total_gross)}
                  </span>
                </div>
              )}

              <div className="flex gap-2.5">
                {!order ? (
                  /* No order — single CTA */
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      const params = new URLSearchParams({ date });
                      if (customer?.id) params.set('customer_id', customer.id);
                      navigate(`/orders/new?${params.toString()}`);
                    }}
                    className="flex-1 rounded-xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground transition-opacity"
                  >
                    + Nowe zamówienie
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate(`/orders/${order.id}`);
                      }}
                      className="flex-1 rounded-xl border border-border py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-muted/40"
                    >
                      Szczegóły
                    </button>

                    {isDraft && (
                      <button
                        type="button"
                        disabled={confirmM.isPending}
                        onClick={() => confirmM.mutate(order.id, { onSuccess: onClose })}
                        className="flex-1 rounded-xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
                      >
                        {confirmM.isPending ? 'Potwierdzam…' : 'Potwierdź'}
                      </button>
                    )}

                    {isConfirmed && (
                      <button
                        type="button"
                        disabled={generateWzM.isPending}
                        onClick={() =>
                          generateWzM.mutate({ orderId: order.id }, {
                            onSuccess: () => {
                              onClose();
                              navigate('/delivery');
                            },
                          })
                        }
                        className="flex-1 rounded-xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
                      >
                        {generateWzM.isPending ? 'Generuję…' : 'Generuj WZ'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

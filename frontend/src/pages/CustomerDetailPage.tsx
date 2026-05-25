import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useCustomerQuery } from '@/query/use-customers';
import { useOrdersByDateQuery } from '@/query/use-orders';
import { useDeliveryByCustomerQuery } from '@/query/use-delivery';
import { authStorage } from '@/services/api';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { orderStatusBadgeClassName } from '@/lib/order-utils';
import type { Order, DeliveryDocument } from '@/types';

/* ── Helpers ───────────────────────────────────────────────────── */
const plnFmt = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function money(v: string | number | null | undefined): string {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? plnFmt.format(n as number) : '—';
}


function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Wystąpił błąd';
}

/* ── Icons ─────────────────────────────────────────────────────── */
function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
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

function ChevronRightSmall() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Order row ─────────────────────────────────────────────────── */
function getOrderDocs(deliveryDocs: DeliveryDocument[], orderId: string) {
  const wzDocs = deliveryDocs.filter(
    (d) => d.document_type === 'WZ' && d.order_id === orderId && d.status !== 'cancelled',
  );
  const zwCount = wzDocs.reduce((sum, w) => sum + (w.return_documents?.length ?? 0), 0);
  return { wzDocs, zwCount };
}

function OrderRow({
  order,
  deliveryDocs,
  onClick,
}: {
  order: Order;
  deliveryDocs: DeliveryDocument[];
  onClick: () => void;
}) {
  const { wzDocs, zwCount } = getOrderDocs(deliveryDocs, order.id);
  const hasWz = wzDocs.length > 0;
  const showMissingWz = !hasWz && order.status !== 'draft' && order.status !== 'cancelled';

  const items = order.items ?? [];
  const subtotal = items.reduce((s, i) => s + (parseFloat(String(i.line_total_gross)) || 0), 0);
  const total = parseFloat(String(order.total_gross)) || 0;
  const discount = subtotal - total;

  return (
    <div className={cn(
      'overflow-hidden rounded-2xl bg-surface-card shadow-soft',
      'border-l-4 border-solid',
      orderStatusLeftBorderClass(order.status),
    )}>
      {/* Header row — click navigates to order detail */}
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-low/40 active:bg-surface-low/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">
              {order.order_number ?? '—'}
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', orderStatusBadgeClassName(order.status))}>
              {ORDER_STATUS_LABELS_PL[order.status]}
            </span>
          </div>
          {/* WZ status line */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {showMissingWz && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Brak WZ
              </span>
            )}
            {wzDocs.map((wz) => (
              <span
                key={wz.id}
                className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              >
                {wz.document_number ?? 'WZ'}
              </span>
            ))}
            {zwCount > 0 && (
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                {zwCount} ZW
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[15px] font-bold tabular-nums text-foreground">{money(order.total_gross)}</p>
        </div>
        <ChevronRightSmall />
      </button>

      {/* Product list — always visible */}
      {items.length > 0 && (
        <div className="border-t border-border/40 px-4 pb-3 pt-2">
          <ul className="space-y-1.5">
            {items.map((item, i) => {
              const unit = (item.product_unit || 'szt.').trim();
              const qty = parseFloat(String(item.quantity)) || 0;
              const qtyLabel = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
              return (
                <li
                  key={item.id ?? `${item.product_id}-${i}`}
                  className="flex items-baseline gap-2 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">{item.product_name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{qtyLabel} {unit}</span>
                  <span className="w-[5.5rem] shrink-0 text-right tabular-nums font-medium text-foreground">
                    {money(item.line_total_gross)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Totals */}
          <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
            {discount > 0.001 && (
              <div className="flex justify-between text-[12px]">
                <span className="text-primary">Rabaty</span>
                <span className="tabular-nums text-primary">−{money(discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[13px] font-semibold">
              <span className="text-foreground">Razem brutto</span>
              <span className="tabular-nums text-foreground">{money(total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function orderStatusLeftBorderClass(status: Order['status']): string {
  switch (status) {
    case 'confirmed':
    case 'delivered':  return 'border-l-emerald-500';
    case 'invoiced':   return 'border-l-violet-500';
    case 'cancelled':  return 'border-l-red-400';
    default:           return 'border-l-amber-400';
  }
}


/* ── Summary cards ──────────────────────────────────────────────── */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-surface-card px-4 py-3 shadow-soft">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-[18px] font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */
export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) return <Navigate to="/customers" replace />;

  return <CustomerDetailContent customerId={id} date={date} />;
}

function CustomerDetailContent({ customerId, date }: { customerId: string; date: string }) {
  const navigate = useNavigate();

  const {
    data: customer,
    isLoading: custLoading,
    isError: custError,
    error: custErr,
  } = useCustomerQuery(customerId);

  // All orders for this date, filtered client-side to this customer
  const { data: allDateOrders, isLoading: ordersLoading } = useOrdersByDateQuery(date);
  const orders: Order[] = (allDateOrders?.results ?? []).filter(
    (o: Order) => o.customer_id === customerId,
  );

  // Delivery docs for this customer (for WZ/ZW counts per order row)
  const { data: deliveryDocs = [] } = useDeliveryByCustomerQuery(customerId);

  /* ── Derived stats ── */
  const dayTotal = orders.reduce(
    (sum: number, o: Order) => sum + (parseFloat(String(o.total_gross)) || 0),
    0,
  );
  const uninvoicedWz = (deliveryDocs as DeliveryDocument[]).filter(
    (d: DeliveryDocument) => d.document_type === 'WZ' && !d.locked_for_edit,
  );

  const isLoading = custLoading || ordersLoading;

  const plDateMed = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateLabel = (() => {
    const d = new Date(date);
    return isNaN(d.getTime()) ? date : plDateMed.format(d);
  })();

  return (
    <div className="flex min-h-screen flex-col bg-background pb-24">
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
                {custLoading ? 'Ładowanie…' : (customer?.name ?? 'Klient')}
              </h1>
              <p className="text-[13px] text-muted-foreground">{dateLabel}</p>
            </div>
            {customer && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                type="button"
                onClick={() => navigate(`/customers/${customerId}/edit`)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
                aria-label="Edytuj klienta"
              >
                <PencilIcon />
              </motion.button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-5 py-4">
        {/* Error */}
        {custError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            {errMsg(custErr)}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-16" role="status" aria-busy="true">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
          </div>
        )}

        {!isLoading && customer && (
          <>
            {/* Stats */}
            <div className="flex gap-3">
              <StatCard
                label="Zamówienia"
                value={orders.length > 0 ? `${orders.length} (${money(dayTotal)})` : '—'}
              />
              <StatCard
                label="WZ bez faktury"
                value={uninvoicedWz.length > 0 ? String(uninvoicedWz.length) : '—'}
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => navigate(`/orders/new?date=${encodeURIComponent(date)}&customer_id=${customerId}`)}
                className="flex-1 rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground"
              >
                + Nowe zamówienie
              </button>
              <button
                type="button"
                onClick={() => navigate(`/invoices/new?customer_id=${customerId}`)}
                className="flex-1 rounded-xl border border-border bg-surface-card py-3 text-[14px] font-semibold text-foreground"
              >
                Utwórz fakturę
              </button>
            </div>

            {/* Orders list for this date */}
            <section aria-label="Zamówienia klienta">
              <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                Zamówienia tego dnia ({orders.length})
              </h2>

              {orders.length === 0 ? (
                <p className="rounded-2xl bg-surface-card px-4 py-4 text-[13px] text-muted-foreground">
                  Brak zamówień na {dateLabel}.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {orders.map((order: Order) => (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <OrderRow
                        order={order}
                        deliveryDocs={deliveryDocs as DeliveryDocument[]}
                        onClick={() => navigate(`/orders/${order.id}`)}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

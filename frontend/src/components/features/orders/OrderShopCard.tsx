import { type KeyboardEvent } from 'react';
import { ORDER_STATUS_LABELS_PL } from '@/constants/orderStatusPl';
import { formatDeliveryDate, formatMoneyGross, orderStatusBadgeClassName } from '@/lib/order-utils';
import { cn } from '@/lib/utils';
import type { Order, OrderItem, OrderStatus } from '@/types';

export type OrderShopCardProps = {
  order: Order;
  onClick: () => void;
  /** When true, shows a selection checkbox (requires `onSelect` for enabled rows). */
  isSelectable?: boolean;
  /** When true, checkbox is visible but disabled (e.g. only confirmed orders are selectable in WZ mode). */
  selectionDisabled?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  /** Shows a per-card loading indicator (e.g. while WZ is being generated for this order). */
  isGenerating?: boolean;
  /** Compact row inspired by shop picker UIs (e.g. ksef-flow): map pin, totals, no line items. */
  variant?: 'default' | 'picker';
};

const pickerShadow = 'shadow-[0_2px_16px_rgba(26,28,31,0.08)]';

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s7-4.86 7-11a7 7 0 10-14 0c0 6.14 7 11 7 11z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

const cardInteractive = cn(
  'w-full rounded-2xl bg-surface-card p-4 text-left shadow-[0_4px_40px_rgba(26,28,31,0.06)]',
  'cursor-pointer transition-colors hover:bg-surface-low active:bg-surface-low/80',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

function orderStatusLeftBorderClass(status: OrderStatus): string {
  switch (status) {
    case 'confirmed':
    case 'delivered':
      return 'border-l-emerald-500';
    case 'draft':
      return 'border-l-amber-500';
    case 'in_preparation':
    case 'loaded':
    case 'in_delivery':
      return 'border-l-amber-500';
    case 'invoiced':
      return 'border-l-violet-500';
    case 'cancelled':
      return 'border-l-red-500';
    default:
      return 'border-l-muted-foreground/35';
  }
}

function positionCountLabel(count: number): string {
  if (count === 1) return '1 pozycja';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} pozycje`;
  }
  return `${count} pozycji`;
}

/** Quantity formatted for display with unit (e.g. `20 szt.`). */
function formatLineQuantityWithUnit(quantity: string | number, unit: string): string {
  const n = typeof quantity === 'string' ? Number.parseFloat(quantity) : quantity;
  const u = (unit || 'szt.').trim();
  if (!Number.isFinite(n)) return u ? `${String(quantity)} ${u}`.trim() : String(quantity);
  const qty = Number.isInteger(n)
    ? String(n)
    : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(n);
  return u ? `${qty} ${u}` : qty;
}

function lineKey(item: OrderItem, index: number): string {
  return item.id || `${item.product_id}-${index}`;
}

export function OrderShopCard({
  order,
  onClick,
  isSelectable = false,
  selectionDisabled = false,
  isSelected = false,
  onSelect,
  isGenerating = false,
  variant = 'default',
}: OrderShopCardProps) {
  const notes = order.customer_notes?.trim() ?? '';
  const items = order.items ?? [];
  const count = items.length;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const selectable = Boolean(isSelectable);
  const checkboxDisabled = selectionDisabled;

  if (variant === 'picker') {
    const num = order.order_number?.trim() || '—';
    return (
      <div
        role="button"
        tabIndex={0}
        className={cn(
          cardInteractive,
          pickerShadow,
          'flex gap-3 border-l-4 border-solid',
          orderStatusLeftBorderClass(order.status),
        )}
        aria-label={`Zamówienie ${order.customer_name}`}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MapPinIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold leading-snug text-foreground">{order.customer_name}</h3>
            <div className="flex shrink-0 items-center gap-1.5">
              {selectable ? (
                <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center">
                  <input
                    type="checkbox"
                    className={cn(
                      'h-5 w-5 shrink-0 rounded border-input text-primary accent-primary',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      checkboxDisabled && 'cursor-not-allowed opacity-50',
                    )}
                    checked={isSelected}
                    disabled={checkboxDisabled}
                    aria-checked={isSelected}
                    aria-disabled={checkboxDisabled}
                    aria-label={
                      checkboxDisabled
                        ? `Wybór niedostępny — tylko zamówienia potwierdzone (${order.order_number})`
                        : `Zaznacz zamówienie ${order.order_number}`
                    }
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (!checkboxDisabled) onSelect?.(order.id);
                    }}
                  />
                </span>
              ) : null}
              {isGenerating ? (
                <span
                  className="inline-flex h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
                  role="status"
                  aria-label="Generowanie WZ…"
                />
              ) : null}
              <span className="text-muted-foreground" aria-hidden>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>
          <span
            className={cn(
              'mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              orderStatusBadgeClassName(order.status),
            )}
          >
            {ORDER_STATUS_LABELS_PL[order.status]}
          </span>
          <p className="mt-2 text-sm text-muted-foreground">
            {num !== '—' ? `${num} · ` : null}
            Dostawa {formatDeliveryDate(order.delivery_date)}
          </p>
          <div className="mt-3 flex items-center gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dziś</p>
              <p className="text-[15px] font-semibold tabular-nums text-foreground">
                {formatMoneyGross(order.total_gross)}
              </p>
            </div>
            <div className="h-8 w-px bg-border" aria-hidden />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pozycje</p>
              <p className="text-[15px] font-semibold tabular-nums text-foreground">{count}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(cardInteractive, 'border-l-4 border-solid', orderStatusLeftBorderClass(order.status))}
      aria-label={`Zamówienie ${order.customer_name}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
            orderStatusBadgeClassName(order.status),
          )}
        >
          {ORDER_STATUS_LABELS_PL[order.status]}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {selectable ? (
            <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center">
              <input
                type="checkbox"
                className={cn(
                  'h-5 w-5 shrink-0 rounded border-input text-primary accent-primary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  checkboxDisabled && 'cursor-not-allowed opacity-50',
                )}
                checked={isSelected}
                disabled={checkboxDisabled}
                aria-checked={isSelected}
                aria-disabled={checkboxDisabled}
                aria-label={
                  checkboxDisabled
                    ? `Wybór niedostępny — tylko zamówienia potwierdzone (${order.order_number})`
                    : `Zaznacz zamówienie ${order.order_number}`
                }
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  if (!checkboxDisabled) onSelect?.(order.id);
                }}
              />
            </span>
          ) : null}
          {isGenerating ? (
            <span
              className="inline-flex h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              role="status"
              aria-label="Generowanie WZ…"
            />
          ) : null}
          <span className="text-lg font-medium text-muted-foreground" aria-hidden>
            ›
          </span>
        </div>
      </div>

      <div className="mt-3 min-w-0">
        <h3 className="text-base font-semibold leading-snug text-foreground">{order.customer_name}</h3>
        {notes ? <p className="mt-0.5 text-sm text-muted-foreground">{notes}</p> : null}
        <p className={cn('text-sm text-muted-foreground', notes ? 'mt-1' : 'mt-0.5')}>{positionCountLabel(count)}</p>
      </div>

      {items.length > 0 ? (
        <div className="mt-4 space-y-2">
          {items.map((item, index) => (
            <div key={lineKey(item, index)} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 text-foreground">
                {item.product_name}
                <span className="text-muted-foreground">
                  {' · '}
                  {formatLineQuantityWithUnit(item.quantity, item.product_unit)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-foreground">
                {formatMoneyGross(item.line_total_gross)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {items.length > 0 ? <div className="my-4 h-px w-full bg-muted/35" aria-hidden /> : null}

      <div className={cn('flex items-baseline justify-between gap-3', items.length === 0 && 'mt-4')}>
        <span className="text-sm font-medium text-muted-foreground">Razem:</span>
        <span className="text-lg font-semibold tabular-nums text-foreground">{formatMoneyGross(order.total_gross)}</span>
      </div>
    </div>
  );
}

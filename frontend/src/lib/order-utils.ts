import type { Order, OrderStatus } from '@/types';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
const plDateLong = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatMoneyGross(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function parseDateInput(iso: string): Date | null {
  const trimmed = iso.trim();
  const cal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (cal) {
    const y = Number(cal[1]);
    const m = Number(cal[2]) - 1;
    const day = Number(cal[3]);
    const d = new Date(y, m, day);
    if (d.getFullYear() !== y || d.getMonth() !== m || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatDeliveryDate(iso: string): string {
  const d = parseDateInput(iso);
  if (!d) return '—';
  return plDate.format(d);
}

export function formatDeliveryDateLong(iso: string): string {
  const d = parseDateInput(iso);
  if (!d) return '—';
  return plDateLong.format(d);
}

export function orderStatusBadgeClassName(status: OrderStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-surface-container text-on-surface';
    case 'confirmed':
      return 'bg-blue-100 text-blue-800';
    case 'delivered':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    case 'in_preparation':
    case 'loaded':
    case 'in_delivery':
      return 'bg-amber-100 text-amber-900';
    case 'invoiced':
      return 'bg-violet-100 text-violet-800';
    default:
      return 'bg-surface-container text-on-surface';
  }
}

export function sumOrdersGross(orders: Order[]): number {
  let sum = 0;
  for (const o of orders) {
    const n = typeof o.total_gross === 'string' ? Number.parseFloat(o.total_gross) : o.total_gross;
    if (Number.isNaN(n)) continue;
    sum += n;
  }
  return sum;
}

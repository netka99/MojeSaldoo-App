import type { OrderStatus } from '@/types';

export const ORDER_STATUS_LABELS_PL: Record<OrderStatus, string> = {
  draft: 'Szkic',
  confirmed: 'Potwierdzone',
  in_preparation: 'W przygotowaniu',
  loaded: 'Załadowane',
  in_delivery: 'W dostawie',
  partially_delivered: 'Częściowo dostarczone',
  delivered: 'Dostarczone',
  invoiced: 'Zafakturowane',
  cancelled: 'Anulowane',
};

const ORDER: OrderStatus[] = [
  'draft',
  'confirmed',
  'in_preparation',
  'loaded',
  'in_delivery',
  'partially_delivered',
  'delivered',
  'invoiced',
  'cancelled',
];

export const orderStatusOptions: { value: OrderStatus; label: string }[] = ORDER.map((value) => ({
  value,
  label: ORDER_STATUS_LABELS_PL[value],
}));

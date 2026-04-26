import type { DeliveryDocumentStatus } from '@/types';

/** Polish labels for delivery document statuses (UI). */
export const DELIVERY_STATUS_LABELS_PL: Record<DeliveryDocumentStatus, string> = {
  draft: 'Szkic',
  saved: 'Zapisano',
  in_transit: 'W drodze',
  delivered: 'Dostarczono',
  cancelled: 'Anulowano',
};

export const deliveryStatusFilterOptions: { value: DeliveryDocumentStatus; label: string }[] = (
  Object.entries(DELIVERY_STATUS_LABELS_PL) as [DeliveryDocumentStatus, string][]
).map(([value, label]) => ({ value, label }));

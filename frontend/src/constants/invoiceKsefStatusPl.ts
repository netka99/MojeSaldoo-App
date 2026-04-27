import type { InvoiceKsefStatus } from '@/types';

/** Polish labels for `Invoice.ksef_status` (UI). */
export const INVOICE_KSEF_STATUS_LABELS_PL: Record<InvoiceKsefStatus, string> = {
  not_sent: 'Nie wysłana',
  pending: 'Oczekuje',
  sent: 'Wysłana',
  accepted: 'Przyjęta',
  rejected: 'Odrzucona',
};

export const invoiceKsefStatusFilterOptions: { value: InvoiceKsefStatus; label: string }[] =
  (['not_sent', 'pending', 'sent', 'accepted', 'rejected'] as const).map((value) => ({
    value,
    label: INVOICE_KSEF_STATUS_LABELS_PL[value],
  }));

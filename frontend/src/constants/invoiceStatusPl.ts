import type { InvoiceStatus } from '@/types';

/** Polish labels for `Invoice.status` (UI). */
export const INVOICE_STATUS_LABELS_PL: Record<InvoiceStatus, string> = {
  draft: 'Szkic',
  issued: 'Wystawiona',
  sent: 'Wysłana',
  paid: 'Opłacona',
  overdue: 'Przeterminowana',
  cancelled: 'Anulowana',
};

export const invoiceStatusFilterOptions: { value: InvoiceStatus; label: string }[] = (
  [
    'draft',
    'issued',
    'sent',
    'paid',
    'overdue',
    'cancelled',
  ] as const
).map((value) => ({ value, label: INVOICE_STATUS_LABELS_PL[value] }));

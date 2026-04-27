/**
 * Invoices / lines — match `apps.invoices.serializers` + models (DRF JSON, snake_case).
 * Decimals are usually strings in API responses; requests may use strings or numbers.
 */

import type { Order } from './order.types';

/** `Invoice.payment_method`. */
export type InvoicePaymentMethod = 'transfer' | 'cash' | 'card';

/** `Invoice.status` (local lifecycle; not KSeF). */
export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'cancelled';

/** `Invoice.ksef_status` — populated after KSeF integration. */
export type InvoiceKsefStatus =
  | 'not_sent'
  | 'pending'
  | 'sent'
  | 'accepted'
  | 'rejected';

/** One invoice line as returned from `GET` (read-only in list/detail). */
export interface InvoiceItem {
  id: string;
  order_item: string | null;
  product: string | null;
  product_name: string;
  product_unit: string;
  pkwiu: string;
  quantity: string | number;
  unit_price_net: string | number;
  vat_rate: string | number;
  line_net: string | number;
  line_vat: string | number;
  line_gross: string | number;
  created_at: string;
}

/** Full invoice from `GET /api/invoices/` / `/:id/` (nested `order` + `items`). */
export interface Invoice {
  id: string;
  company: string;
  user: number | null;
  order: Order;
  customer: string;
  delivery_document: string | null;
  invoice_number: string | null;
  issue_date: string;
  sale_date: string;
  due_date: string;
  payment_method: InvoicePaymentMethod;
  subtotal_net: string | number;
  subtotal_gross: string | number;
  vat_amount: string | number;
  total_gross: string | number;
  ksef_reference_number: string;
  ksef_number: string;
  ksef_status: InvoiceKsefStatus;
  ksef_sent_at: string | null;
  ksef_error_message: string;
  invoice_hash: string;
  upo_received: boolean;
  status: InvoiceStatus;
  paid_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  items: InvoiceItem[];
}

/** `POST /api/invoices/` — writable fields (`status` is server / action controlled). */
export interface InvoiceCreate {
  order_id: string;
  issue_date: string;
  sale_date: string;
  due_date: string;
  customer_id?: string | null;
  delivery_document_id?: string | null;
  payment_method?: InvoicePaymentMethod;
  notes?: string;
  subtotal_net?: string | number;
  subtotal_gross?: string | number;
  vat_amount?: string | number;
  total_gross?: string | number;
}

/** `PATCH /api/invoices/:id/` — only allowed while `status === 'draft'`. */
export type InvoicePatch = Partial<
  Pick<
    InvoiceCreate,
    | 'issue_date'
    | 'sale_date'
    | 'due_date'
    | 'delivery_document_id'
    | 'payment_method'
    | 'notes'
    | 'subtotal_net'
    | 'subtotal_gross'
    | 'vat_amount'
    | 'total_gross'
  >
>;

export interface PaginatedInvoices {
  count: number;
  next: string | null;
  previous: string | null;
  results: Invoice[];
}

/** Optional body for `POST .../generate-from-order/:orderId/`. */
export interface GenerateInvoiceFromOrderBody {
  delivery_document_id?: string;
  issue_date?: string;
  sale_date?: string;
  due_date?: string;
  payment_method?: InvoicePaymentMethod;
}

/** `GET /api/invoices/:id/preview/` — payload for HTML / print layout. */
export interface InvoicePreviewLine {
  position: number;
  product_name: string;
  product_unit: string;
  pkwiu: string;
  quantity: string;
  quantity_display: string;
  unit_price_net: string;
  vat_rate: string;
  vat_rate_display: string;
  line_net: string;
  line_vat: string;
  line_gross: string;
}

export interface InvoicePreviewPayload {
  meta: {
    title: string;
    currency: string;
    locale: string;
  };
  seller: {
    name: string;
    nip: string;
    address_lines: string[];
  };
  buyer: {
    name: string;
    nip: string;
    address_lines: string[];
  };
  invoice: {
    id: string;
    invoice_number: string;
    issue_date: string;
    sale_date: string;
    due_date: string;
    payment_method: string;
    payment_method_label: string;
    status: string;
    notes: string;
    order_number: string;
    delivery_document_number: string;
  };
  totals: {
    subtotal_net: string;
    vat_amount: string;
    subtotal_gross: string;
    total_gross: string;
  };
  lines: InvoicePreviewLine[];
}

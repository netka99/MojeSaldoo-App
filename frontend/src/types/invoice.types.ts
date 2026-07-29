/**
 * Invoices / lines — match `apps.invoices.serializers` + models (DRF JSON, snake_case).
 * Decimals are usually strings in API responses; requests may use strings or numbers.
 */

import type { Order } from './order.types';

/** `Invoice.payment_method`. */
export type InvoicePaymentMethod = 'transfer' | 'cash' | 'card';

/** FA-3 RodzajFaktury (KOR is derived from is_correction, not set here). */
export type KsefInvoiceType = 'VAT' | 'ZAL' | 'ROZ';

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
  is_removed?: boolean;
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
  is_correction: boolean;
  corrects_invoice_id: string | null;
  corrects_invoice_number: string | null;
  correction_reason: string;
  corrections: { id: string; invoice_number: string | null }[];
  paid_at: string | null;
  notes: string;

  // --- KSeF FA-3 optional fields ---
  ksef_invoice_type: KsefInvoiceType;
  // Adnotacje
  annotation_mpp: boolean;
  annotation_kasowa: boolean;
  annotation_odwrotne: boolean;
  annotation_trojstronna: boolean;
  annotation_zwolnienie: boolean;
  annotation_marza: boolean;
  annotation_tp: boolean;
  annotation_fp: boolean;
  annotation_oss: boolean;
  // Płatność
  bank_account_iban: string;
  bank_swift: string;
  bank_name: string;
  payment_link: string;
  ksef_payment_id: string;
  discount_conditions: string;
  // Dokumenty i stopka
  wz_numbers: string[];
  footer_text: string;
  extra_notes: string;
  prices_include_vat: boolean;

  created_at: string;
  updated_at: string;
  items: InvoiceItem[];
}

/** One item entry in a correction payload. */
export type CorrectionItemEntry =
  | { item_id: string; remove: true }
  | { item_id: string; quantity?: string; unit_price_net?: string; vat_rate?: string }
  | { product_name: string; quantity: string; unit_price_net: string; vat_rate: string; product_unit?: string };

/** Body for `POST /api/invoices/:id/create-correction/`. */
export interface CreateCorrectionBody {
  correction_reason: string;
  issue_date?: string;
  due_date?: string;
  payment_method?: string;
  items?: CorrectionItemEntry[];
}

/** KSeF optional fields shared across InvoiceCreate / InvoicePatch / GenerateFromOrder. */
export interface InvoiceKsefOptions {
  ksef_invoice_type?: KsefInvoiceType;
  annotation_mpp?: boolean;
  annotation_kasowa?: boolean;
  annotation_odwrotne?: boolean;
  annotation_trojstronna?: boolean;
  annotation_zwolnienie?: boolean;
  annotation_marza?: boolean;
  annotation_tp?: boolean;
  annotation_fp?: boolean;
  annotation_oss?: boolean;
  bank_account_iban?: string;
  bank_swift?: string;
  bank_name?: string;
  payment_link?: string;
  ksef_payment_id?: string;
  discount_conditions?: string;
  wz_numbers?: string[];
  footer_text?: string;
  extra_notes?: string;
  prices_include_vat?: boolean;
}

/** `POST /api/invoices/` — writable fields (`status` is server / action controlled). */
export interface InvoiceCreate extends InvoiceKsefOptions {
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
export interface GenerateInvoiceFromOrderBody extends InvoiceKsefOptions {
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

/** Structured seller block (print); falls back to `seller` if omitted. */
export interface InvoicePreviewCompanyBlock {
  name: string;
  nip: string;
  address: string;
  city?: string;
  postal_code?: string;
  phone?: string;
  email?: string;
}

/** Structured buyer block (print); falls back to `buyer` if omitted. */
export interface InvoicePreviewCustomerBlock {
  name: string;
  nip: string;
  address: string;
  city?: string;
  postal_code?: string;
}

/** Line row aligned with API `items` array on preview. */
export interface InvoicePreviewItemRow {
  product_name: string;
  pkwiu: string;
  quantity: string;
  unit: string;
  unit_price_net: string;
  vat_rate: string;
  line_net: string;
  line_vat: string;
  line_gross: string;
}

export interface InvoicePreviewVatRateTotal {
  vat_rate: string;
  net: string;
  vat: string;
  gross: string;
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
  company?: InvoicePreviewCompanyBlock;
  customer?: InvoicePreviewCustomerBlock;
  items?: InvoicePreviewItemRow[];
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
    byVatRate?: InvoicePreviewVatRateTotal[];
  };
  lines: InvoicePreviewLine[];
}

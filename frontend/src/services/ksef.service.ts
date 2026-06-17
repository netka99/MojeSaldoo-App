/**
 * KSeF session management service.
 * These endpoints proxy to the SSAPI backend which handles all KSeF complexity.
 * Frontend only manages session state (check / authenticate / clear).
 */

import { api } from './api';

export type KSeFTokenType = 'access' | 'refresh';

export interface KSeFToken {
  token_type: KSeFTokenType;
  valid_until: string;
}

export interface KSeFSessionStatus {
  active: boolean;
  tokens: KSeFToken[];
  access_valid_until: string | null;
}

export interface KSeFSendResult {
  /** Updated invoice object after sending (ksef_status = 'pending', ksef_reference_number set) */
  [key: string]: unknown;
}

export interface KSeFStatusResult {
  /** Updated invoice object with latest ksef_status, ksef_number, etc. */
  [key: string]: unknown;
  _ssapi_processing?: boolean;
}

export interface ReceivedInvoiceParty {
  nip?: string;
  name?: string;
  identifier?: { type: string; value: string };
}

export interface PzDocumentRef {
  id: string;
  documentNumber: string;
  status: string;
}

export type OpexCategory = 'utilities' | 'rent' | 'services' | 'transport' | 'marketing' | 'other';

export const OPEX_CATEGORY_LABELS: Record<OpexCategory, string> = {
  utilities: 'Media',
  rent: 'Czynsz / leasing',
  services: 'Usługi zewnętrzne',
  transport: 'Transport',
  marketing: 'Marketing',
  other: 'Inne',
};

export interface ReceivedInvoiceMeta {
  /** UUID of the ReceivedKSeFInvoice DB record — use for PZ linking. */
  id: string;
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  invoicingDate: string;
  seller: ReceivedInvoiceParty;
  buyer: ReceivedInvoiceParty;
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  invoiceType: string;
  pzDocuments: PzDocumentRef[];
  opex_category: OpexCategory | null;
  opex_tagged_at: string | null;
}

export interface ReceivedInvoicesResult {
  invoices: ReceivedInvoiceMeta[];
  total: number;
  page: number;
  page_size: number;
  hasMore: boolean;
  new_count: number;
  sync_error: string | null;
}

export interface ParsedInvoiceLine {
  name: string;
  unit: string;
  quantity: number;
  unit_net_price: number;
  vat_rate: string;
  line_net: number;
  suggested_product_id: string | null;
  suggested_product_name: string | null;
  /** PZ documents that have already taken items from this invoice line */
  existing_pz_documents: PzDocumentRef[];
}

export interface ParsedInvoiceResult {
  invoice_number: string;
  issue_date: string;
  seller_nip: string;
  seller_name: string;
  seller_country: string;
  seller_address_l1: string;
  seller_address_l2: string;
  suggested_supplier_id: string | null;
  suggested_supplier_name: string | null;
  lines: ParsedInvoiceLine[];
  /** All PZ documents linked to this invoice */
  pz_documents: PzDocumentRef[];
}

export interface PaperScanLine {
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

export interface PaperScanResult {
  seller_name: string;
  seller_nip: string;
  invoice_number: string;
  issue_date: string;
  total_gross: string;
  raw_text: string;
  lines: PaperScanLine[];
}

const ksefPath = '/ksef/session/';

export const ksefService = {
  /**
   * Check whether the company has an active KSeF session on the backend.
   * Returns { active: false } if not authenticated or session expired.
   */
  checkSession: () => api.get<KSeFSessionStatus>(ksefPath),

  /**
   * Authenticate with KSeF via SSAPI.
   * Body: { passphrase: string }  — NIP is resolved server-side from the current company.
   * Backend stores the resulting SSAPI session cookies server-side.
   * Returns 422 if auth is in progress (caller should retry after 2s).
   */
  authenticate: (passphrase: string) =>
    api.post<KSeFSessionStatus>(ksefPath, { passphrase }),

  /** Clear the stored KSeF session for the current company. */
  clearSession: () => api.delete<void>(ksefPath),

  /**
   * Query received invoices (as buyer) from KSeF.
   * date_from / date_to: ISO 8601 datetime strings, e.g. "2026-01-01T00:00:00.000Z"
   */
  queryReceivedInvoices: (
    dateFrom: string,
    dateTo: string,
    page = 1,
    pageSize = 20,
  ) =>
    api.get<ReceivedInvoicesResult>('/ksef/inbox/', {
      params: { date_from: dateFrom, date_to: dateTo, page, page_size: pageSize },
    }),

  parseInvoice: (ksefNumber: string) =>
    api.get<ParsedInvoiceResult>(`/ksef/inbox/${encodeURIComponent(ksefNumber)}/parse/`),

  syncInbox: (dateFrom: string, dateTo: string) =>
    api.post<{ new_count: number; total: number }>('/ksef/inbox/sync/', { date_from: dateFrom, date_to: dateTo }),

  /**
   * Save product mappings for a seller — upserts on (seller_nip, invoice_line_name).
   * Called after PZ creation so future imports auto-fill the same products.
   */
  saveProductMappings: (sellerNip: string, mappings: { invoice_line_name: string; product_id: string }[]) =>
    api.post<{ saved: number }>('/ksef/product-mappings/', { seller_nip: sellerNip, mappings }),

  /**
   * Tag (or clear) an OPEX category on a received invoice.
   * PATCH /api/ksef/inbox/<ksefNumber>/opex/
   * Body: { opex_category: OpexCategory | null }
   */
  tagOpexCategory: (ksefNumber: string, opex_category: OpexCategory | null) =>
    api.patch<ReceivedInvoiceMeta>(
      `/ksef/inbox/${encodeURIComponent(ksefNumber)}/opex/`,
      { opex_category },
    ),

  /**
   * Upload a paper invoice image for OCR extraction.
   * POST /api/ksef/scan-paper/   (multipart/form-data, field: image)
   * Returns best-effort extracted fields; any field may be empty if OCR fails.
   */
  scanPaperInvoice: (image: File) => {
    const fd = new FormData();
    fd.append('image', image);
    return api.postForm<PaperScanResult>('/ksef/scan-paper/', fd);
  },
};

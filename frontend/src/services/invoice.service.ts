import { api } from './api';
import type {
  CreateCorrectionBody,
  CreateManualInvoiceBody,
  GenerateInvoiceFromOrderBody,
  GenerateInvoiceFromOrdersBody,
  Invoice,
  InvoiceCreate,
  InvoicePatch,
  InvoicePreviewPayload,
  PaginatedInvoices,
  PeriodPreviewResult,
} from '../types';

export type InvoiceSummary = {
  unpaid_count: number;
  unpaid_total: string;
  overdue_count: number;
  overdue_total: string;
  paid_this_month_count: number;
  paid_this_month_total: string;
};

/** Query string for `GET /api/invoices/` — filters match `InvoiceFilter` (django-filter). */
export type InvoiceListParams = {
  page?: number;
  status?: string;
  /** Comma-separated list of statuses, e.g. "issued,sent" — maps to status__in on backend */
  'status__in'?: string;
  ksef_status?: string;
  /** Comma-separated KSeF statuses, e.g. "accepted,sent" — maps to ksef_status__in on backend */
  'ksef_status__in'?: string;
  customer?: string;
  issue_date_after?: string;
  issue_date_before?: string;
  /** Filter by correction flag. true = only FV-KOR, false = only regular invoices */
  is_correction?: boolean;
  /** Sort column. Prefix with "-" for descending: "issue_date", "-due_date", "total_gross" */
  ordering?: string;
};

const basePath = '/invoices/';

export const invoiceService = {
  fetchList: (params?: InvoiceListParams) =>
    api.get<PaginatedInvoices>(basePath, { params }),

  fetchById: (id: string) => api.get<Invoice>(`${basePath}${id}/`),

  create: (data: InvoiceCreate) => api.post<Invoice>(basePath, data),

  patch: (id: string, data: InvoicePatch) => api.patch<Invoice>(`${basePath}${id}/`, data),

  delete: (id: string) => api.delete<Record<string, never>>(`${basePath}${id}/`),

  /**
   * Creates a draft invoice + lines from a confirmed, delivered, or invoiced order.
   * Optional `delivery_document_id` in body; server may link latest delivered WZ.
   */
  generateFromOrder: (orderId: string, body: GenerateInvoiceFromOrderBody = {}) =>
    api.post<Invoice>(`${basePath}generate-from-order/${orderId}/`, body),

  issue: (id: string) => api.post<Invoice>(`${basePath}${id}/issue/`, {}),

  setNumber: (id: string, invoiceNumber: string | null) =>
    api.patch<Invoice>(`${basePath}${id}/set-number/`, { invoice_number: invoiceNumber ?? '' }),

  nextNumber: (issueDate: string, isCorrection = false) =>
    api.get<{ next_number: string }>(`${basePath}next-number/`, {
      params: { issue_date: issueDate, is_correction: isCorrection },
    }),

  markPaid: (id: string) => api.post<Invoice>(`${basePath}${id}/mark-paid/`, {}),

  markUnpaid: (id: string) => api.post<Invoice>(`${basePath}${id}/mark-unpaid/`, {}),

  fetchPreview: (id: string) => api.get<InvoicePreviewPayload>(`${basePath}${id}/preview/`),

  /** Download FA-3 KSeF XML for an invoice. Returns raw XML string. */
  downloadXml: async (id: string, filename: string): Promise<void> => {
    const token = (await import('./api')).authStorage.getAccessToken();
    const resp = await fetch(`/api/invoices/${id}/xml/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Submit an issued invoice to KSeF via SSAPI (requires active KSeF session). */
  sendToKsef: (id: string) => api.post<Invoice>(`${basePath}${id}/send-to-ksef/`, {}),

  /** Download UPO (Urzędowe Potwierdzenie Odbioru) XML for an accepted invoice. */
  downloadUpo: async (id: string, filename: string): Promise<void> => {
    const token = (await import('./api')).authStorage.getAccessToken();
    const resp = await fetch(`/api/invoices/${id}/upo/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error((body as { detail?: string }).detail ?? `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Poll SSAPI for updated KSeF processing status.
   * Returns 202 (Accepted) while KSeF is still processing — poll again.
   * Returns 200 when complete (accepted or rejected).
   */
  fetchKsefStatus: (id: string) => api.get<Invoice>(`${basePath}${id}/ksef-status/`),

  /** Create a draft FV-KOR correction for an issued or paid invoice. */
  createCorrection: (id: string, body: CreateCorrectionBody) =>
    api.post<Invoice>(`${basePath}${id}/create-correction/`, body),

  /** Aggregate summary: unpaid, overdue, paid-this-month counts and totals. */
  fetchSummary: () => api.get<InvoiceSummary>(`${basePath}summary/`),

  /** Create one draft invoice from multiple orders (same customer). */
  generateFromOrders: (body: GenerateInvoiceFromOrdersBody) =>
    api.post<Invoice>(`${basePath}generate-from-orders/`, body),

  /** Create a manual draft invoice without any order. */
  createManual: (body: CreateManualInvoiceBody) =>
    api.post<Invoice>(`${basePath}create-manual/`, body),

  /** Aggregate OrderItems per product for a customer over a date range (for period invoicing). */
  periodPreviewOrders: (customerId: string, dateFrom: string, dateTo: string) =>
    api.get<PeriodPreviewResult>(`${basePath}period-preview/orders/`, {
      params: { customer_id: customerId, date_from: dateFrom, date_to: dateTo },
    }),

  /** Aggregate WZ DeliveryItems per product for a customer over a date range (for period invoicing). */
  periodPreviewWz: (customerId: string, dateFrom: string, dateTo: string) =>
    api.get<PeriodPreviewResult>(`${basePath}period-preview/wz/`, {
      params: { customer_id: customerId, date_from: dateFrom, date_to: dateTo },
    }),
};

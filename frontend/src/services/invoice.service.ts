import { api } from './api';
import type {
  GenerateInvoiceFromOrderBody,
  Invoice,
  InvoiceCreate,
  InvoicePatch,
  InvoicePreviewPayload,
  PaginatedInvoices,
} from '../types';

/** Query string for `GET /api/invoices/` — filters match `InvoiceFilter` (django-filter). */
export type InvoiceListParams = {
  page?: number;
  status?: string;
  ksef_status?: string;
  customer?: string;
  issue_date_after?: string;
  issue_date_before?: string;
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

  markPaid: (id: string) => api.post<Invoice>(`${basePath}${id}/mark-paid/`, {}),

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
};

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
};

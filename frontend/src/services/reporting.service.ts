import { api } from './api';
import type {
  InventoryReportRow,
  KsefStatusReport,
  PaginatedReportingInvoices,
  SalesSummaryReport,
  TopCustomerRow,
  TopProductRow,
} from '@/types/reporting.types';

const basePath = '/reports/';

export type ReportDateRangeParams = {
  date_from?: string;
  date_to?: string;
};

/** Query string for `GET /reports/invoices/` (django-filter: `status`; custom dates). */
export type ReportingInvoiceListParams = {
  page?: number;
  date_from?: string;
  date_to?: string;
  status?: string;
};

export const reportingService = {
  fetchSalesSummary: (params?: ReportDateRangeParams) =>
    api.get<SalesSummaryReport>(`${basePath}sales-summary/`, { params }),

  fetchTopProducts: (params?: ReportDateRangeParams & { limit?: number }) =>
    api.get<TopProductRow[]>(`${basePath}top-products/`, { params }),

  fetchTopCustomers: (params?: ReportDateRangeParams & { limit?: number }) =>
    api.get<TopCustomerRow[]>(`${basePath}top-customers/`, { params }),

  fetchKsefStatus: () => api.get<KsefStatusReport>(`${basePath}ksef-status/`),

  /** Paginated invoice list for reporting (includes `ksef_status`). */
  fetchReportingInvoices: (params?: ReportingInvoiceListParams) =>
    api.get<PaginatedReportingInvoices>(`${basePath}invoices/`, { params }),

  /** Stock levels by product and warehouse. */
  fetchInventoryReport: () => api.get<InventoryReportRow[]>(`${basePath}inventory/`),
};

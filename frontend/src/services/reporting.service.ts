import { api } from './api';
import type {
  CustomerMarginReport,
  DashboardSummary,
  ExpiryAlertRow,
  InventoryReportRow,
  KsefStatusReport,
  PaginatedReportingInvoices,
  PaymentAgingReport,
  ProfitLossReport,
  ProfitLossMonthDetail,
  ProductMarginRow,
  ProductMarginDetail,
  SalesSummaryReport,
  SupplierCostsReport,
  SupplierCostsDetail,
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

  /** Operational dashboard summary. */
  fetchDashboardSummary: () => api.get<DashboardSummary>(`${basePath}dashboard/`),

  /** Monthly P&L: revenue vs purchase costs. */
  fetchProfitLoss: (params?: ReportDateRangeParams) =>
    api.get<ProfitLossReport>(`${basePath}profit-loss/`, { params }),

  /** Per-product margin report. */
  fetchProductMargin: (params?: ReportDateRangeParams & { limit?: number }) =>
    api.get<ProductMarginRow[]>(`${basePath}product-margin/`, { params }),

  /** Invoices + PZ docs for a single month (drill-down). */
  fetchProfitLossMonthDetail: (month: string) =>
    api.get<ProfitLossMonthDetail>(`${basePath}profit-loss/month-detail/`, { params: { month } }),

  /** Invoice lines + PZ lines for a single product (drill-down). */
  fetchProductMarginDetail: (params: { product_id: string; date_from?: string; date_to?: string }) =>
    api.get<ProductMarginDetail>(`${basePath}product-margin/product-detail/`, { params }),

  /** Accounts receivable aging (unpaid invoices by days overdue). */
  fetchPaymentAging: () =>
    api.get<PaymentAgingReport>(`${basePath}payment-aging/`),

  /** Purchase costs per supplier per month. */
  fetchSupplierCosts: (params?: ReportDateRangeParams) =>
    api.get<SupplierCostsReport>(`${basePath}supplier-costs/`, { params }),

  /** PZ documents for a single supplier (drill-down). */
  fetchSupplierCostsDetail: (params: { supplier_id?: string; date_from?: string; date_to?: string }) =>
    api.get<SupplierCostsDetail>(`${basePath}supplier-costs/detail/`, { params }),

  /** Batches expiring within `days` days (default 90). */
  fetchExpiryAlerts: (params?: { days?: number }) =>
    api.get<ExpiryAlertRow[]>(`${basePath}expiry-alerts/`, { params }),

  /** Per-customer margin report. */
  fetchCustomerMargin: (params?: ReportDateRangeParams & { limit?: number }) =>
    api.get<CustomerMarginReport>(`${basePath}customer-margin/`, { params }),
};

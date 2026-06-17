import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { reportingService, type ReportingInvoiceListParams } from '@/services/reporting.service';
import { reportKeys } from './keys';

const TOP_LIMIT = 10;

export type ReportingInvoicesListFilters = Omit<ReportingInvoiceListParams, 'page'>;

/**
 * Reporting queries are scoped by JWT + backend `current_company`; cache keys include
 * `companyId` so a company switch refetches cleanly.
 */
export function useSalesSummaryReportQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.salesSummary({ companyId, dateFrom, dateTo }),
    queryFn: () =>
      reportingService.fetchSalesSummary({ date_from: dateFrom, date_to: dateTo }),
    enabled: Boolean(companyId && dateFrom && dateTo),
  });
}

export function useTopProductsReportQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.topProducts({ companyId, dateFrom, dateTo, limit: TOP_LIMIT }),
    queryFn: () =>
      reportingService.fetchTopProducts({
        date_from: dateFrom,
        date_to: dateTo,
        limit: TOP_LIMIT,
      }),
    enabled: Boolean(companyId && dateFrom && dateTo),
  });
}

export function useTopCustomersReportQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.topCustomers({ companyId, dateFrom, dateTo, limit: TOP_LIMIT }),
    queryFn: () =>
      reportingService.fetchTopCustomers({
        date_from: dateFrom,
        date_to: dateTo,
        limit: TOP_LIMIT,
      }),
    enabled: Boolean(companyId && dateFrom && dateTo),
  });
}

export function useKsefStatusReportQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.ksefStatus(companyId),
    queryFn: () => reportingService.fetchKsefStatus(),
    enabled: Boolean(companyId),
  });
}

/**
 * Paginated reporting invoice list (`GET /reports/invoices/`).
 * Optional filters: issue `date_from` / `date_to`, `status`.
 */
export function useReportingInvoicesListQuery(
  page: number,
  filters: ReportingInvoicesListFilters = {},
) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const dateFrom = filters.date_from ?? '';
  const dateTo = filters.date_to ?? '';
  const status = filters.status ?? '';

  return useQuery({
    queryKey: reportKeys.reportingInvoices({ companyId, page, dateFrom, dateTo, status }),
    queryFn: () =>
      reportingService.fetchReportingInvoices({
        page,
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
        ...(status ? { status } : {}),
      }),
    enabled: Boolean(companyId),
  });
}

/** Stock report (`GET /reports/inventory/`). */
export function useInventoryReportQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.inventory(companyId),
    queryFn: () => reportingService.fetchInventoryReport(),
    enabled: Boolean(companyId),
  });
}

/** Operational dashboard summary (`GET /reports/dashboard/`). Refetches every 60 s. */
export function useDashboardSummaryQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.dashboard(companyId),
    queryFn: () => reportingService.fetchDashboardSummary(),
    enabled: Boolean(companyId),
    refetchInterval: 60_000,
  });
}

/** Monthly P&L report (`GET /reports/profit-loss/`). */
export function useProfitLossQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.profitLoss({ companyId, dateFrom, dateTo }),
    queryFn: () => reportingService.fetchProfitLoss({ date_from: dateFrom, date_to: dateTo }),
    enabled: Boolean(companyId),
  });
}

/** Drill-down for a single P&L month (`GET /reports/profit-loss/month-detail/`). */
export function useProfitLossMonthDetailQuery(month: string | null) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: ['reports', 'profit-loss-month-detail', companyId, month],
    queryFn: () => reportingService.fetchProfitLossMonthDetail(month!),
    enabled: Boolean(companyId && month),
  });
}

/** Per-product margin report (`GET /reports/product-margin/`). */
export function useProductMarginQuery(dateFrom: string, dateTo: string, limit = 50) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.productMargin({ companyId, dateFrom, dateTo, limit }),
    queryFn: () =>
      reportingService.fetchProductMargin({ date_from: dateFrom, date_to: dateTo, limit }),
    enabled: Boolean(companyId),
  });
}

/** Drill-down for a single product's margin (`GET /reports/product-margin/product-detail/`). */
export function useProductMarginDetailQuery(productId: string | null, dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: ['reports', 'product-margin-detail', companyId, productId, dateFrom, dateTo],
    queryFn: () => reportingService.fetchProductMarginDetail({
      product_id: productId!,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    enabled: Boolean(companyId && productId),
  });
}

/** Accounts receivable aging (`GET /reports/payment-aging/`). */
export function usePaymentAgingQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.paymentAging(companyId),
    queryFn: () => reportingService.fetchPaymentAging(),
    enabled: Boolean(companyId),
  });
}

/** Supplier costs per month (`GET /reports/supplier-costs/`). */
export function useSupplierCostsQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.supplierCosts({ companyId, dateFrom, dateTo }),
    queryFn: () =>
      reportingService.fetchSupplierCosts({ date_from: dateFrom, date_to: dateTo }),
    enabled: Boolean(companyId),
  });
}

/** PZ documents for a single supplier drill-down (`GET /reports/supplier-costs/detail/`). */
export function useSupplierCostsDetailQuery(
  supplierId: string | null,
  dateFrom: string,
  dateTo: string,
) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.supplierCostsDetail({ companyId, supplierId, dateFrom, dateTo }),
    queryFn: () =>
      reportingService.fetchSupplierCostsDetail({
        ...(supplierId ? { supplier_id: supplierId } : {}),
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    enabled: Boolean(companyId) && supplierId !== undefined,
  });
}

/** Batches expiring within `days` days (`GET /reports/expiry-alerts/`). */
export function useExpiryAlertsQuery(days = 90) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.expiryAlerts(companyId, days),
    queryFn: () => reportingService.fetchExpiryAlerts({ days }),
    enabled: Boolean(companyId),
  });
}

/** Per-customer margin report (`GET /reports/customer-margin/`). */
export function useCustomerMarginQuery(dateFrom: string, dateTo: string, limit = 50) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: reportKeys.customerMargin({ companyId, dateFrom, dateTo, limit }),
    queryFn: () =>
      reportingService.fetchCustomerMargin({ date_from: dateFrom, date_to: dateTo, limit }),
    enabled: Boolean(companyId),
  });
}

export { TOP_LIMIT };

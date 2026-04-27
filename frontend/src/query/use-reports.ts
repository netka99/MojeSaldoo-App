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

export { TOP_LIMIT };

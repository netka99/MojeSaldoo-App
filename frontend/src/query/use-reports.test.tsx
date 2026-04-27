/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { reportKeys } from './keys';
import {
  useSalesSummaryReportQuery,
  useTopProductsReportQuery,
  useTopCustomersReportQuery,
  useKsefStatusReportQuery,
  useReportingInvoicesListQuery,
  useInventoryReportQuery,
  TOP_LIMIT,
} from './use-reports';

const reportingServiceMock = vi.hoisted(() => ({
  fetchSalesSummary: vi.fn(),
  fetchTopProducts: vi.fn(),
  fetchTopCustomers: vi.fn(),
  fetchKsefStatus: vi.fn(),
  fetchReportingInvoices: vi.fn(),
  fetchInventoryReport: vi.fn(),
}));

vi.mock('@/services/reporting.service', () => ({
  reportingService: reportingServiceMock,
}));

const authHoisted = vi.hoisted(() => ({
  user: { current_company: '550e8400-e29b-41d4-a716-446655440000' as string | null },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authHoisted.user }),
}));

describe('use-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authHoisted.user = { current_company: '550e8400-e29b-41d4-a716-446655440000' };
  });

  it('useSalesSummaryReportQuery fetches and caches with reportKeys.salesSummary', async () => {
    const summary = {
      totalOrders: 1,
      totalGross: '10.00',
      avgOrderValue: '10.00',
      byStatus: {},
    };
    reportingServiceMock.fetchSalesSummary.mockResolvedValue(summary);
    const queryClient = createTestQueryClient();
    const from = '2026-04-01';
    const to = '2026-04-30';

    const { result } = renderHook(() => useSalesSummaryReportQuery(from, to), {
      wrapper: ({ children }) => (
        <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportingServiceMock.fetchSalesSummary).toHaveBeenCalledWith({
      date_from: from,
      date_to: to,
    });
    expect(
      queryClient.getQueryData(
        reportKeys.salesSummary({
          companyId: authHoisted.user.current_company!,
          dateFrom: from,
          dateTo: to,
        }),
      ),
    ).toEqual(summary);
  });

  it('useSalesSummaryReportQuery does not fetch when company is unset', () => {
    authHoisted.user = { current_company: null };
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useSalesSummaryReportQuery('2026-04-01', '2026-04-30'),
      {
        wrapper: ({ children }) => (
          <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
        ),
      },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(reportingServiceMock.fetchSalesSummary).not.toHaveBeenCalled();
  });

  it('useTopProductsReportQuery passes limit TOP_LIMIT', async () => {
    reportingServiceMock.fetchTopProducts.mockResolvedValue([]);
    const queryClient = createTestQueryClient();
    const from = '2026-01-01';
    const to = '2026-01-31';

    const { result } = renderHook(() => useTopProductsReportQuery(from, to), {
      wrapper: ({ children }) => (
        <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportingServiceMock.fetchTopProducts).toHaveBeenCalledWith({
      date_from: from,
      date_to: to,
      limit: TOP_LIMIT,
    });
  });

  it('useTopCustomersReportQuery uses topCustomers key', async () => {
    reportingServiceMock.fetchTopCustomers.mockResolvedValue([]);
    const queryClient = createTestQueryClient();
    const from = '2026-02-01';
    const to = '2026-02-28';

    const { result } = renderHook(() => useTopCustomersReportQuery(from, to), {
      wrapper: ({ children }) => (
        <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData(
        reportKeys.topCustomers({
          companyId: authHoisted.user.current_company!,
          dateFrom: from,
          dateTo: to,
          limit: TOP_LIMIT,
        }),
      ),
    ).toEqual([]);
  });

  it('useKsefStatusReportQuery calls fetchKsefStatus', async () => {
    const k = {
      notSent: 0,
      pending: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
      rejectedInvoices: [],
    };
    reportingServiceMock.fetchKsefStatus.mockResolvedValue(k);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useKsefStatusReportQuery(), {
      wrapper: ({ children }) => (
        <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportingServiceMock.fetchKsefStatus).toHaveBeenCalledWith();
    expect(
      queryClient.getQueryData(reportKeys.ksefStatus(authHoisted.user.current_company!)),
    ).toEqual(k);
  });

  it('useReportingInvoicesListQuery passes optional filters', async () => {
    const pageData = { count: 0, next: null, previous: null, results: [] };
    reportingServiceMock.fetchReportingInvoices.mockResolvedValue(pageData);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () =>
        useReportingInvoicesListQuery(2, {
          date_from: '2026-03-01',
          date_to: '2026-03-31',
          status: 'draft',
        }),
      {
        wrapper: ({ children }) => (
          <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
        ),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportingServiceMock.fetchReportingInvoices).toHaveBeenCalledWith({
      page: 2,
      date_from: '2026-03-01',
      date_to: '2026-03-31',
      status: 'draft',
    });
  });

  it('useInventoryReportQuery calls fetchInventoryReport', async () => {
    reportingServiceMock.fetchInventoryReport.mockResolvedValue([]);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useInventoryReportQuery(), {
      wrapper: ({ children }) => (
        <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reportingServiceMock.fetchInventoryReport).toHaveBeenCalledWith();
  });
});

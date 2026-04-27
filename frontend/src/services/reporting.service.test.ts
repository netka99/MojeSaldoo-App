import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('./api', () => ({
  api: {
    get: mocks.get,
  },
}));

import { reportingService } from './reporting.service';

describe('reportingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchSalesSummary calls GET /reports/sales-summary/ with date range', async () => {
    const body = { totalOrders: 1, totalGross: '10', avgOrderValue: '10', byStatus: {} };
    mocks.get.mockResolvedValue(body);
    const result = await reportingService.fetchSalesSummary({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
    });
    expect(result).toBe(body);
    expect(mocks.get).toHaveBeenCalledWith('/reports/sales-summary/', {
      params: { date_from: '2026-04-01', date_to: '2026-04-30' },
    });
  });

  it('fetchTopProducts calls GET /reports/top-products/ with limit', async () => {
    mocks.get.mockResolvedValue([]);
    await reportingService.fetchTopProducts({
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      limit: 10,
    });
    expect(mocks.get).toHaveBeenCalledWith('/reports/top-products/', {
      params: { date_from: '2026-01-01', date_to: '2026-01-31', limit: 10 },
    });
  });

  it('fetchTopCustomers calls GET /reports/top-customers/', async () => {
    mocks.get.mockResolvedValue([]);
    await reportingService.fetchTopCustomers({ limit: 10 });
    expect(mocks.get).toHaveBeenCalledWith('/reports/top-customers/', {
      params: { limit: 10 },
    });
  });

  it('fetchKsefStatus calls GET /reports/ksef-status/', async () => {
    mocks.get.mockResolvedValue({
      notSent: 0,
      pending: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
      rejectedInvoices: [],
    });
    await reportingService.fetchKsefStatus();
    expect(mocks.get).toHaveBeenCalledWith('/reports/ksef-status/');
  });

  it('fetchReportingInvoices calls GET /reports/invoices/ with filters', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);
    await reportingService.fetchReportingInvoices({
      page: 2,
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      status: 'draft',
    });
    expect(mocks.get).toHaveBeenCalledWith('/reports/invoices/', {
      params: {
        page: 2,
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        status: 'draft',
      },
    });
  });

  it('fetchInventoryReport calls GET /reports/inventory/', async () => {
    mocks.get.mockResolvedValue([]);
    await reportingService.fetchInventoryReport();
    expect(mocks.get).toHaveBeenCalledWith('/reports/inventory/');
  });
});

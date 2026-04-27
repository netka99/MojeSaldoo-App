/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import {
  ReportsPage,
  buildKsefConicGradient,
  buildKsefLegendRows,
  KSEF_DONUT_COLORS,
} from './ReportsPage';
import { authStorage } from '@/services/api';
import type { KsefStatusReport, SalesSummaryReport } from '@/types/reporting.types';

const hoisted = vi.hoisted(() => ({
  useSalesSummaryReportQuery: vi.fn(),
  useTopProductsReportQuery: vi.fn(),
  useTopCustomersReportQuery: vi.fn(),
  useKsefStatusReportQuery: vi.fn(),
}));

vi.mock('@/query/use-reports', () => ({
  useSalesSummaryReportQuery: hoisted.useSalesSummaryReportQuery,
  useTopProductsReportQuery: hoisted.useTopProductsReportQuery,
  useTopCustomersReportQuery: hoisted.useTopCustomersReportQuery,
  useKsefStatusReportQuery: hoisted.useKsefStatusReportQuery,
  TOP_LIMIT: 10,
}));

function okQuery<T>(data: T) {
  return { data, isFetching: false, isError: false, error: null };
}

function makeKsef(over: Partial<KsefStatusReport> = {}): KsefStatusReport {
  return {
    notSent: 0,
    pending: 0,
    sent: 0,
    accepted: 0,
    rejected: 0,
    rejectedInvoices: [],
    ...over,
  };
}

function renderReportsRoute() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
          <Route path="/invoices/:id" element={<div>Faktura</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('buildKsefConicGradient', () => {
  it('returns neutral fill when all counts are zero', () => {
    expect(buildKsefConicGradient(makeKsef())).toBe('conic-gradient(#e5e7eb 0% 100%)');
  });

  it('builds proportional stops for non-zero segments', () => {
    const css = buildKsefConicGradient(
      makeKsef({ notSent: 2, pending: 2, sent: 2, accepted: 2, rejected: 2 }),
    );
    expect(css.startsWith('conic-gradient(from 0deg,')).toBe(true);
    expect(css).toContain(KSEF_DONUT_COLORS.notSent);
    expect(css).toContain(KSEF_DONUT_COLORS.rejected);
    expect(css).toContain('0.000% 20.000%');
    expect(css).toContain('80.000% 100.000%');
  });

  it('skips zero segments in gradient', () => {
    const css = buildKsefConicGradient(makeKsef({ notSent: 1, accepted: 3 }));
    expect(css).toContain(KSEF_DONUT_COLORS.notSent);
    expect(css).toContain(KSEF_DONUT_COLORS.accepted);
    expect(css).not.toContain(KSEF_DONUT_COLORS.pending);
  });
});

describe('buildKsefLegendRows', () => {
  it('maps API counts to Polish labels and colors', () => {
    const rows = buildKsefLegendRows(makeKsef({ notSent: 1, rejected: 2 }));
    expect(rows.find((r) => r.label === 'Nie wysłana')?.value).toBe(1);
    expect(rows.find((r) => r.label === 'Odrzucona')?.value).toBe(2);
    expect(rows.find((r) => r.label === 'Odrzucona')?.color).toBe(KSEF_DONUT_COLORS.rejected);
  });
});

describe('ReportsPage', () => {
  const getToken = vi.spyOn(authStorage, 'getAccessToken');

  beforeEach(() => {
    getToken.mockReturnValue('jwt');
    hoisted.useSalesSummaryReportQuery.mockReturnValue(
      okQuery<SalesSummaryReport>({
        totalOrders: 3,
        totalGross: '300.00',
        avgOrderValue: '100.00',
        byStatus: {},
      }),
    );
    hoisted.useTopProductsReportQuery.mockReturnValue(okQuery([]));
    hoisted.useTopCustomersReportQuery.mockReturnValue(okQuery([]));
    hoisted.useKsefStatusReportQuery.mockReturnValue(okQuery(makeKsef()));
  });

  afterEach(() => {
    getToken.mockReset();
    vi.clearAllMocks();
  });

  it('redirects to login when there is no access token', () => {
    getToken.mockReturnValue(null);
    renderReportsRoute();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('renders heading and sales summary metrics from query', () => {
    renderReportsRoute();
    expect(screen.getByRole('heading', { name: 'Raporty' })).toBeInTheDocument();
    expect(screen.getByText('Zamówienia')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Suma brutto')).toBeInTheDocument();
    expect(screen.getByText(/300,00\s*zł/)).toBeInTheDocument();
    expect(screen.getByText('Śr. wartość zamówienia')).toBeInTheDocument();
    expect(screen.getByText(/100,00\s*zł/)).toBeInTheDocument();
  });

  it('renders top products and customers tables when data is present', () => {
    hoisted.useTopProductsReportQuery.mockReturnValue(
      okQuery([
        { productName: 'Alpha', totalQuantity: '2', totalGross: '200.00' },
        { productName: 'Beta', totalQuantity: '1', totalGross: '50.00' },
      ]),
    );
    hoisted.useTopCustomersReportQuery.mockReturnValue(
      okQuery([{ customerName: 'Acme', orderCount: 4, totalGross: '400.00' }]),
    );
    renderReportsRoute();

    const prodTable = screen.getByRole('table', { name: 'Top produktów według przychodu' });
    expect(within(prodTable).getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(within(prodTable).getByRole('cell', { name: 'Beta' })).toBeInTheDocument();

    const custTable = screen.getByRole('table', { name: 'Top klientów według przychodu' });
    expect(within(custTable).getByRole('cell', { name: 'Acme' })).toBeInTheDocument();
    expect(within(custTable).getByRole('cell', { name: '4' })).toBeInTheDocument();
  });

  it('shows KSeF donut aria-label, legend, and rejected invoice link', () => {
    hoisted.useKsefStatusReportQuery.mockReturnValue(
      okQuery(
        makeKsef({
          notSent: 1,
          rejected: 1,
          rejectedInvoices: [
            {
              id: 'inv-r1',
              invoice_number: 'FV/2026/0099',
              issue_date: '2026-04-01',
              ksef_status: 'rejected',
              ksef_error_message: 'Błąd schemy',
              total_gross: '99.00',
              customer_name: 'Klient X',
            },
          ],
        }),
      ),
    );
    renderReportsRoute();

    expect(
      screen.getByRole('img', { name: /Podsumowanie KSeF: 2 faktur łącznie/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Legenda wykresu KSeF' })).toBeInTheDocument();
    const rejLink = screen.getByRole('link', { name: 'FV/2026/0099' });
    expect(rejLink).toHaveAttribute('href', '/invoices/inv-r1');
    expect(screen.getByText(/Błąd schemy/)).toBeInTheDocument();
  });

  it('calls sales summary hook with ISO date strings', () => {
    renderReportsRoute();
    const salesArgs = hoisted.useSalesSummaryReportQuery.mock.calls[0];
    expect(salesArgs).toBeDefined();
    expect(salesArgs![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(salesArgs![1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(salesArgs![0] <= salesArgs![1]).toBe(true);
  });
});

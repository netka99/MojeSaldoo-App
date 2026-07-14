/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { ProfitLossPage } from './ProfitLossPage';
import { authStorage } from '@/services/api';
import type { ProfitLossReport, ProfitLossMonthDetail } from '@/types/reporting.types';

const hoisted = vi.hoisted(() => ({
  useProfitLossQuery: vi.fn(),
  useProfitLossMonthDetailQuery: vi.fn(),
}));

vi.mock('@/query/use-reports', () => ({
  useProfitLossQuery: hoisted.useProfitLossQuery,
  useProfitLossMonthDetailQuery: hoisted.useProfitLossMonthDetailQuery,
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

// ksef.service is imported for OPEX_CATEGORY_LABELS — provide real export
vi.mock('@/services/ksef.service', () => ({
  OPEX_CATEGORY_LABELS: {
    utilities: 'Media',
    rent: 'Czynsz / leasing',
    services: 'Usługi zewnętrzne',
    transport: 'Transport',
    marketing: 'Marketing',
    other: 'Inne',
  },
}));

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/reports/profit-loss']}>
        <Routes>
          <Route path="/reports/profit-loss" element={<ProfitLossPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const REPORT_NO_OPEX: ProfitLossReport = {
  rows: [
    {
      month: '2026-04',
      revenue: '10000.00',
      purchaseCosts: '6000.00',
      grossProfit: '4000.00',
      marginPercent: 40.0,
      invoiceCount: 3,
      pzCount: 2,
      opex: '0',
      opexByCategory: {},
      operatingProfit: '4000.00',
      operatingMarginPercent: 40.0,
      fixedCosts: '0',
      fixedCostsByCategory: {},
      netProfit: '4000.00',
      netMarginPercent: 40.0,
    },
  ],
  totals: {
    revenue: '10000.00',
    purchaseCosts: '6000.00',
    grossProfit: '4000.00',
    marginPercent: 40.0,
    opex: '0',
    operatingProfit: '4000.00',
    operatingMarginPercent: 40.0,
    fixedCosts: '0',
    netProfit: '4000.00',
    netMarginPercent: 40.0,
  },
};

const REPORT_WITH_OPEX: ProfitLossReport = {
  rows: [
    {
      month: '2026-05',
      revenue: '20000.00',
      purchaseCosts: '10000.00',
      grossProfit: '10000.00',
      marginPercent: 50.0,
      invoiceCount: 5,
      pzCount: 3,
      opex: '2000.00',
      opexByCategory: { utilities: '1200.00', rent: '800.00' },
      operatingProfit: '8000.00',
      operatingMarginPercent: 40.0,
      fixedCosts: '0',
      fixedCostsByCategory: {},
      netProfit: '8000.00',
      netMarginPercent: 40.0,
    },
  ],
  totals: {
    revenue: '20000.00',
    purchaseCosts: '10000.00',
    grossProfit: '10000.00',
    marginPercent: 50.0,
    opex: '2000.00',
    operatingProfit: '8000.00',
    operatingMarginPercent: 40.0,
    fixedCosts: '0',
    netProfit: '8000.00',
    netMarginPercent: 40.0,
  },
};

const MONTH_DETAIL_WITH_OPEX: ProfitLossMonthDetail = {
  invoices: [
    {
      id: 'inv1',
      invoice_number: 'FV/2026/001',
      issue_date: '2026-05-10',
      customer_name: 'Sklep ABC',
      total_gross: '5000.00',
      status: 'issued',
    },
  ],
  pz_documents: [],
  opex_invoices: [
    {
      id: 'opex1',
      ksef_number: 'KSeF/123',
      invoice_number: 'EL/2026/001',
      issue_date: '2026-05-05',
      seller_name: 'Energetyka Sp. z o.o.',
      gross_amount: '1200.00',
      opex_category: 'utilities',
    },
    {
      id: 'opex2',
      ksef_number: 'KSeF/124',
      invoice_number: 'CZ/2026/001',
      issue_date: '2026-05-01',
      seller_name: 'Nieruchomości Sp. z o.o.',
      gross_amount: '800.00',
      opex_category: 'rent',
    },
  ],
};

const MONTH_DETAIL_EMPTY: ProfitLossMonthDetail = {
  invoices: [],
  pz_documents: [],
  opex_invoices: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authStorage.getAccessToken).mockReturnValue('tok');
  hoisted.useProfitLossQuery.mockReturnValue({ data: REPORT_NO_OPEX, isLoading: false, isError: false });
  hoisted.useProfitLossMonthDetailQuery.mockReturnValue({ data: MONTH_DETAIL_EMPTY, isLoading: false });
});

describe('ProfitLossPage', () => {
  it('renders page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /zysk i koszty/i })).toBeInTheDocument();
  });

  it('redirects to login when no token', () => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    hoisted.useProfitLossQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPage();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('shows error state', () => {
    hoisted.useProfitLossQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText(/błąd ładowania/i)).toBeInTheDocument();
  });

  it('shows summary cards with formatted values', () => {
    renderPage();
    // Revenue card — labels appear in both summary cards and table headers, so use getAllByText
    expect(screen.getAllByText('Przychody').length).toBeGreaterThan(0);
    expect(screen.getAllByText('COGS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Zysk brutto').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Marża brutto').length).toBeGreaterThan(0);
    // formatPercent uses toFixed(1) — period decimal separator; appears in card and table
    expect(screen.getAllByText('40.0 %').length).toBeGreaterThan(0);
  });

  it('does NOT show OPEX summary cards when opex is zero', () => {
    renderPage();
    expect(screen.queryByText('Koszty operacyjne (OPEX)')).not.toBeInTheDocument();
    expect(screen.queryByText('Zysk operacyjny')).not.toBeInTheDocument();
  });

  it('shows OPEX summary cards when opex > 0', () => {
    hoisted.useProfitLossQuery.mockReturnValue({ data: REPORT_WITH_OPEX, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText('Koszty operacyjne (OPEX)')).toBeInTheDocument();
    expect(screen.getByText('Zysk operacyjny')).toBeInTheDocument();
    expect(screen.getByText('Marża operacyjna')).toBeInTheDocument();
  });

  it('renders table month row', () => {
    renderPage();
    expect(screen.getByText('2026-04')).toBeInTheDocument();
  });

  it('renders OPEX and Zysk oper. columns in table', () => {
    renderPage();
    expect(screen.getByText('OPEX')).toBeInTheDocument();
    expect(screen.getByText('Zysk oper.')).toBeInTheDocument();
  });

  it('shows invoice count badge', () => {
    renderPage();
    expect(screen.getByText('3')).toBeInTheDocument(); // invoiceCount
  });

  it('renders info tip icons', () => {
    renderPage();
    // Each InfoTip renders a circled "i" — there should be several
    const tips = screen.getAllByText('i');
    expect(tips.length).toBeGreaterThanOrEqual(4);
  });

  it('shows empty state when no rows', () => {
    hoisted.useProfitLossQuery.mockReturnValue({
      data: { rows: [], totals: { revenue: 0, purchaseCosts: 0, grossProfit: 0, marginPercent: null, opex: 0, operatingProfit: 0, operatingMarginPercent: null, fixedCosts: 0, netProfit: 0, netMarginPercent: null } },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText(/brak danych dla wybranego okresu/i)).toBeInTheDocument();
  });

  it('expands month row and shows drill-down on click', async () => {
    hoisted.useProfitLossQuery.mockReturnValue({ data: REPORT_WITH_OPEX, isLoading: false, isError: false });
    hoisted.useProfitLossMonthDetailQuery.mockReturnValue({ data: MONTH_DETAIL_WITH_OPEX, isLoading: false });
    renderPage();

    const monthCell = screen.getByText('2026-05');
    await userEvent.click(monthCell.closest('tr')!);

    // OPEX invoices shown in drill-down
    expect(screen.getByText('EL/2026/001')).toBeInTheDocument();
    expect(screen.getByText('Energetyka Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('CZ/2026/001')).toBeInTheDocument();
    // "Media" may appear in both OPEX category badges and drill-down rows
    expect(screen.getAllByText(/media/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/czynsz/i).length).toBeGreaterThan(0);
  });

  it('hides drill-down on second click (toggle)', async () => {
    hoisted.useProfitLossQuery.mockReturnValue({ data: REPORT_WITH_OPEX, isLoading: false, isError: false });
    hoisted.useProfitLossMonthDetailQuery.mockReturnValue({ data: MONTH_DETAIL_WITH_OPEX, isLoading: false });
    renderPage();

    const row = screen.getByText('2026-05').closest('tr')!;
    await userEvent.click(row);
    expect(screen.getByText('EL/2026/001')).toBeInTheDocument();

    await userEvent.click(row);
    expect(screen.queryByText('EL/2026/001')).not.toBeInTheDocument();
  });

  it('preset buttons are rendered', () => {
    renderPage();
    expect(screen.getByRole('button', { name: '3 mies.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12 mies.' })).toBeInTheDocument();
  });
});

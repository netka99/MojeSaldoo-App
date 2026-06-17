/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { CustomerMarginPage } from './CustomerMarginPage';
import { authStorage } from '@/services/api';
import type { CustomerMarginReport } from '@/types/reporting.types';

const hoisted = vi.hoisted(() => ({
  useCustomerMarginQuery: vi.fn(),
}));

vi.mock('@/query/use-reports', () => ({
  useCustomerMarginQuery: hoisted.useCustomerMarginQuery,
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

function okQuery<T>(data: T) {
  return { data, isFetching: false, isError: false, error: null };
}

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/reports/customer-margin']}>
        <Routes>
          <Route path="/reports/customer-margin" element={<CustomerMarginPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const REPORT: CustomerMarginReport = {
  rows: [
    {
      customerId: 'c1',
      customerName: 'Biedronka Sp. z o.o.',
      invoiceCount: 12,
      totalRevenue: '45000.00',
      cogs: '30000.00',
      grossProfit: '15000.00',
      marginPercent: 33.3,
      cogsComplete: true,
      estimatedCogs: null,
      estimatedGrossProfit: null,
      estimatedMarginPercent: null,
      hasEstimate: false,
    },
    {
      customerId: 'c2',
      customerName: 'Żabka Polska S.A.',
      invoiceCount: 5,
      totalRevenue: '8000.00',
      cogs: null,
      grossProfit: null,
      marginPercent: null,
      cogsComplete: false,
      estimatedCogs: null,
      estimatedGrossProfit: null,
      estimatedMarginPercent: null,
      hasEstimate: false,
    },
  ],
  productsMissingCost: [
    { productId: 'p1', productName: 'Jogurt naturalny' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.useCustomerMarginQuery.mockReturnValue(okQuery(REPORT));
});

describe('CustomerMarginPage', () => {
  it('renders page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /marże na klientach/i })).toBeInTheDocument();
  });

  it('renders customer rows', () => {
    renderPage();
    expect(screen.getByText('Biedronka Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('Żabka Polska S.A.')).toBeInTheDocument();
  });

  it('shows margin percent for complete rows', () => {
    renderPage();
    expect(screen.getByText('33.3 %')).toBeInTheDocument();
  });

  it('shows dash for missing margin', () => {
    renderPage();
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('shows warning with missing product names', () => {
    renderPage();
    expect(screen.getByText(/1 klient ma produkty bez kosztu zakupu/i)).toBeInTheDocument();
    expect(screen.getByText('Jogurt naturalny')).toBeInTheDocument();
    expect(screen.getByText(/dodaj PZ z kosztem/i)).toBeInTheDocument();
  });

  it('shows italic dash for incomplete COGS row (cogsComplete=false)', () => {
    renderPage();
    // Component renders <span class="text-xs italic">—</span> for incomplete COGS
    // Multiple dashes exist; at least one should be rendered as an italic element
    const italicDashes = document.querySelectorAll('span.italic');
    expect(italicDashes.length).toBeGreaterThan(0);
  });

  it('shows empty state when no data', () => {
    hoisted.useCustomerMarginQuery.mockReturnValue(okQuery({ rows: [], productsMissingCost: [] }));
    renderPage();
    expect(screen.getByText(/brak faktur/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    hoisted.useCustomerMarginQuery.mockReturnValue({ data: undefined, isFetching: true, isError: false, error: null });
    renderPage();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('redirects to login when no token', () => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { ProductMarginPage } from './ProductMarginPage';
import { authStorage } from '@/services/api';
import type { ProductMarginRow, ProductMarginDetail } from '@/types/reporting.types';

const hoisted = vi.hoisted(() => ({
  useProductMarginQuery: vi.fn(),
  useProductMarginDetailQuery: vi.fn(),
}));

vi.mock('@/query/use-reports', () => ({
  useProductMarginQuery: hoisted.useProductMarginQuery,
  useProductMarginDetailQuery: hoisted.useProductMarginDetailQuery,
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/reports/product-margin']}>
        <Routes>
          <Route path="/reports/product-margin" element={<ProductMarginPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const ROWS: ProductMarginRow[] = [
  {
    productId: 'p1',
    productName: 'Kartacze',
    totalQty: '50',
    totalRevenue: '5000.00',
    avgCost: '60.00',
    lastCost: '62.00',
    costSource: 'pz',
    cogs: '3000.00',
    grossProfit: '2000.00',
    marginPercent: 40.0,
    estimatedCogs: null,
    estimatedGrossProfit: null,
    estimatedMarginPercent: null,
  },
  {
    productId: 'p2',
    productName: 'Pierogi ruskie',
    totalQty: '100',
    totalRevenue: '3000.00',
    avgCost: null,
    lastCost: null,
    costSource: 'recipe_estimate',
    cogs: null,
    grossProfit: null,
    marginPercent: null,
    estimatedCogs: '1800.00',
    estimatedGrossProfit: '1200.00',
    estimatedMarginPercent: 40.0,
  },
  {
    productId: 'p3',
    productName: 'Bigos',
    totalQty: '30',
    totalRevenue: '900.00',
    avgCost: '15.00',
    lastCost: '15.00',
    costSource: 'production',
    cogs: '450.00',
    grossProfit: '450.00',
    marginPercent: 50.0,
    estimatedCogs: null,
    estimatedGrossProfit: null,
    estimatedMarginPercent: null,
  },
];

const DETAIL: ProductMarginDetail = {
  invoice_lines: [
    {
      invoice_id: 'inv1',
      invoice_number: 'FV/2026/001',
      issue_date: '2026-04-10',
      customer_name: 'Klient A',
      quantity: '10',
      unit_price_net: '80.00',
      line_gross: '984.00',
      status: 'issued',
    },
  ],
  pz_lines: [
    {
      pz_id: 'pz1',
      document_number: 'PZ/2026/001',
      issue_date: '2026-04-01',
      supplier_name: 'Dostawca X',
      quantity: '20',
      unit_cost: '60.00',
      line_cost: '1200.00',
    },
  ],
  cost_history: [],
  production_history: [],
  avg_cost: '60.00',
  last_cost: '62.00',
  avg_cost_updated_at: '2026-04-01T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authStorage.getAccessToken).mockReturnValue('tok');
  hoisted.useProductMarginQuery.mockReturnValue({ data: ROWS, isLoading: false, isError: false });
  hoisted.useProductMarginDetailQuery.mockReturnValue({ data: undefined, isLoading: false });
});

describe('ProductMarginPage', () => {
  it('renders page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /marże na produktach/i })).toBeInTheDocument();
  });

  it('redirects to login when no token', () => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    hoisted.useProductMarginQuery.mockReturnValue({ data: [], isLoading: true, isError: false });
    renderPage();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('renders product rows', () => {
    renderPage();
    expect(screen.getByText('Kartacze')).toBeInTheDocument();
    expect(screen.getByText('Pierogi ruskie')).toBeInTheDocument();
    expect(screen.getByText('Bigos')).toBeInTheDocument();
  });

  it('shows PZ cost source badge', () => {
    renderPage();
    expect(screen.getByText('PZ')).toBeInTheDocument();
  });

  it('shows production cost source badge', () => {
    renderPage();
    expect(screen.getByText('prod.')).toBeInTheDocument();
  });

  it('shows estimated COGS column with ~ prefix for recipe_estimate rows', () => {
    renderPage();
    // estimatedCogs 1800 PLN shown with ~ prefix
    expect(screen.getByTitle('Szacunek z receptury')).toBeInTheDocument();
  });

  it('shows info banner when any row has estimated data', () => {
    renderPage();
    expect(screen.getByText(/niektóre produkty nie mają kosztu z pz\/produkcji/i)).toBeInTheDocument();
  });

  it('does NOT show no-cost-data notice when some rows have avg_cost', () => {
    renderPage();
    expect(screen.queryByText(/koszt zakupu.*nie jest jeszcze obliczony dla żadnego produktu/i)).not.toBeInTheDocument();
  });

  it('shows no-cost-data notice when all rows lack avg_cost', () => {
    const noCostRows: ProductMarginRow[] = ROWS.map((r) => ({
      ...r,
      avgCost: null,
      cogs: null,
      grossProfit: null,
      marginPercent: null,
      estimatedCogs: null,
      estimatedGrossProfit: null,
      estimatedMarginPercent: null,
    }));
    hoisted.useProductMarginQuery.mockReturnValue({ data: noCostRows, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText(/koszt zakupu.*nie jest jeszcze obliczony dla żadnego produktu/i)).toBeInTheDocument();
  });

  it('shows empty state when no rows', () => {
    hoisted.useProductMarginQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText(/brak faktur w wybranym okresie/i)).toBeInTheDocument();
  });

  it('expands product row on click and shows drill-down', async () => {
    hoisted.useProductMarginDetailQuery.mockReturnValue({ data: DETAIL, isLoading: false });
    renderPage();

    const row = screen.getByText('Kartacze').closest('tr')!;
    await userEvent.click(row);

    expect(screen.getByText('FV/2026/001')).toBeInTheDocument();
    expect(screen.getByText('Klient A')).toBeInTheDocument();
    expect(screen.getByText('PZ/2026/001')).toBeInTheDocument();
  });

  it('collapses drill-down on second click', async () => {
    hoisted.useProductMarginDetailQuery.mockReturnValue({ data: DETAIL, isLoading: false });
    renderPage();

    const row = screen.getByText('Kartacze').closest('tr')!;
    await userEvent.click(row);
    expect(screen.getByText('FV/2026/001')).toBeInTheDocument();

    await userEvent.click(row);
    expect(screen.queryByText('FV/2026/001')).not.toBeInTheDocument();
  });

  it('renders preset buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: '3 mies.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ten rok' })).toBeInTheDocument();
  });
});

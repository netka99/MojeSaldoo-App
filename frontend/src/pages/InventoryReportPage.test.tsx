/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { InventoryReportPage } from './InventoryReportPage';
import { authStorage } from '@/services/api';
import type { ExpiryAlertRow, InventoryReportRow } from '@/types/reporting.types';

const hoisted = vi.hoisted(() => ({
  useInventoryReportQuery: vi.fn(),
  useExpiryAlertsQuery: vi.fn(),
}));

vi.mock('@/query/use-reports', () => ({
  useInventoryReportQuery: hoisted.useInventoryReportQuery,
  useExpiryAlertsQuery: hoisted.useExpiryAlertsQuery,
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
      <MemoryRouter initialEntries={['/reports/inventory']}>
        <Routes>
          <Route path="/reports/inventory" element={<InventoryReportPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const STOCK_ROWS: InventoryReportRow[] = [
  {
    productName: 'Mleko 3,2%',
    warehouseCode: 'MAG1',
    quantityAvailable: 120,
    minStockAlert: 50,
    belowMinimum: false,
    daysOfStock: 45,
  },
  {
    productName: 'Śmietana 18%',
    warehouseCode: 'MAG1',
    quantityAvailable: 10,
    minStockAlert: 30,
    belowMinimum: true,
    daysOfStock: 3,
  },
];

const EXPIRY_ROWS: ExpiryAlertRow[] = [
  {
    batchId: 'b1',
    productId: 'p1',
    productName: 'Jogurt naturalny',
    warehouseCode: 'MAG1',
    batchNumber: 'LOT001',
    expiryDate: '2026-06-20',
    daysUntilExpiry: 5,
    quantityRemaining: 48,
    unitCost: '2.50',
    expired: false,
  },
  {
    batchId: 'b2',
    productId: 'p2',
    productName: 'Kefir',
    warehouseCode: 'MAG2',
    batchNumber: '',
    expiryDate: '2026-06-10',
    daysUntilExpiry: -5,
    quantityRemaining: 12,
    unitCost: null,
    expired: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.useInventoryReportQuery.mockReturnValue(okQuery(STOCK_ROWS));
  hoisted.useExpiryAlertsQuery.mockReturnValue(okQuery(EXPIRY_ROWS));
});

describe('InventoryReportPage', () => {
  it('renders page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /magazyn/i })).toBeInTheDocument();
  });

  it('shows stock rows', () => {
    renderPage();
    expect(screen.getByText('Mleko 3,2%')).toBeInTheDocument();
    expect(screen.getByText('Śmietana 18%')).toBeInTheDocument();
  });

  it('shows days of stock', () => {
    renderPage();
    expect(screen.getByText('45 dni')).toBeInTheDocument();
    expect(screen.getByText('3 dni')).toBeInTheDocument();
  });

  it('shows low stock alert badge when rows below minimum exist', () => {
    renderPage();
    expect(screen.getByText(/1 pozycji poniżej minimum/i)).toBeInTheDocument();
  });

  it('filters to below-minimum rows when checkbox is checked', async () => {
    renderPage();
    const checkbox = screen.getByRole('checkbox', { name: /tylko poniżej minimum/i });
    await userEvent.click(checkbox);
    expect(screen.queryByText('Mleko 3,2%')).not.toBeInTheDocument();
    expect(screen.getByText('Śmietana 18%')).toBeInTheDocument();
  });

  it('shows expiry alert rows', () => {
    renderPage();
    expect(screen.getByText('Jogurt naturalny')).toBeInTheDocument();
    expect(screen.getByText('Kefir')).toBeInTheDocument();
  });

  it('shows expired badge text', () => {
    renderPage();
    expect(screen.getByText(/wygasło 5 dni temu/i)).toBeInTheDocument();
  });

  it('shows expired batch count badge', () => {
    renderPage();
    expect(screen.getByText(/1 wygasłych partii/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    hoisted.useInventoryReportQuery.mockReturnValue({ data: undefined, isFetching: true, isError: false, error: null });
    hoisted.useExpiryAlertsQuery.mockReturnValue({ data: undefined, isFetching: true, isError: false, error: null });
    renderPage();
    expect(screen.getAllByText('Ładowanie…').length).toBeGreaterThanOrEqual(1);
  });

  it('redirects to login when no token', () => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });
});

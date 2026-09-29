/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StockPage } from './StockPage';
import { authStorage } from '@/services/api';

const hoisted = vi.hoisted(() => ({
  warehouseId: 'wh-1',
  warehouseName: 'Magazyn główny',
  isLoading: false,
  stock: {
    data: [] as Array<{
      id: string;
      product_name: string;
      product_unit: string;
      quantity_available: string;
      quantity_total: string;
    }>,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
}));

vi.mock('@/hooks/useSilentWarehouse', () => ({
  useSilentWarehouse: () => ({
    silent: true,
    warehouseId: hoisted.warehouseId,
    warehouseName: hoisted.warehouseName,
    isLoading: hoisted.isLoading,
  }),
}));

vi.mock('@/query/use-warehouses', () => ({
  useWarehouseStockQuery: () => hoisted.stock,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/stock']}>
      <Routes>
        <Route path="/stock" element={<StockPage />} />
        <Route path="/login" element={<div>Logowanie</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StockPage', () => {
  beforeEach(() => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue('tok');
    hoisted.warehouseId = 'wh-1';
    hoisted.warehouseName = 'Magazyn główny';
    hoisted.isLoading = false;
    hoisted.stock = { data: [], isLoading: false, isError: false };
  });

  it('redirects to login without a token', () => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('shows empty stock for the silent warehouse', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Stany' })).toBeInTheDocument();
    expect(screen.getByText(/magazyn główny/i)).toBeInTheDocument();
    expect(screen.getByText(/na razie pusto/i)).toBeInTheDocument();
  });

  it('renders stock rows', () => {
    hoisted.stock = {
      data: [
        {
          id: 's-1',
          product_name: 'Mąka',
          product_unit: 'kg',
          quantity_available: '12',
          quantity_total: '15',
        },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Mąka')).toBeInTheDocument();
    expect(screen.getByText('12 kg')).toBeInTheDocument();
    expect(screen.getByText('15 kg')).toBeInTheDocument();
  });
});

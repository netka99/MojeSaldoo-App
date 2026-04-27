/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { VanReconciliationPage } from './VanReconciliationPage';
import { authStorage } from '@/services/api';
import { warehouseService } from '@/services/warehouse.service';
import { productService } from '@/services/product.service';

const mutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    warehouse_id: 'w-van-1',
    warehouse_name: 'Van Test',
    reconciliation_date: '2026-04-27',
    items: [],
    total_discrepancies: 0,
    has_discrepancies: false,
  }),
);

vi.mock('@/query/use-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-delivery')>();
  return {
    ...actual,
    useVanReconciliationMutation: () => ({
      mutateAsync: mutateAsync,
      isPending: false,
    }),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { current_company: '550e8400-e29b-41d4-a716-446655440000' as string },
  }),
}));

vi.mock('@/services/warehouse.service', () => ({
  warehouseService: {
    fetchList: vi.fn(),
  },
}));

vi.mock('@/services/product.service', () => ({
  productService: {
    fetchStockSnapshot: vi.fn(),
  },
}));

const warehouse: import('@/types').Warehouse = {
  id: 'w-van-1',
  user: 1,
  code: 'VAN1',
  name: 'Van mobilny',
  warehouse_type: 'mobile',
  address: '',
  is_active: true,
  allow_negative_stock: false,
  fifo_enabled: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/delivery/van-reconciliation']}>
        <Routes>
          <Route path="/delivery/van-reconciliation" element={<VanReconciliationPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const getToken = vi.spyOn(authStorage, 'getAccessToken');

describe('VanReconciliationPage', () => {
  beforeEach(() => {
    getToken.mockReturnValue('token');
    vi.mocked(warehouseService.fetchList).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [warehouse],
    });
    vi.mocked(productService.fetchStockSnapshot).mockResolvedValue({
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      items: [
        {
          product_id: 'p-1',
          product_name: 'Mąka',
          sku: 'SKU-1',
          unit: 'kg',
          quantity_available: '10.000',
        },
      ],
    });
    mutateAsync.mockClear();
  });

  afterEach(() => {
    getToken.mockReset();
  });

  it('redirects to login when there is no access token', () => {
    getToken.mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('loads step 1, then after Dalej shows products and submits reconciliation with mutateAsync', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Rozlicz Van' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Krok 1 — Wybierz van do rozliczenia' })).toBeInTheDocument();

    const warehouseSelect = await waitFor(() => screen.getByRole('combobox', { name: 'Magazyn (van)' }));
    await user.selectOptions(warehouseSelect, warehouse.id);
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Krok 2 — Wpisz stan faktyczny' })).toBeInTheDocument();
    });
    expect(productService.fetchStockSnapshot).toHaveBeenCalledWith(warehouse.id);

    expect(screen.getByRole('cell', { name: 'Mąka' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zatwierdź rozliczenie' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        warehouseId: warehouse.id,
        data: {
          reconciliation_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          items: [{ product_id: 'p-1', quantity_actual: '10.000' }],
        },
      });
    });
  });

  it('shows empty van message when snapshot has no items', async () => {
    const user = userEvent.setup();
    vi.mocked(productService.fetchStockSnapshot).mockResolvedValue({
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      items: [],
    });
    renderPage();
    const whSelect = await waitFor(() => screen.getByRole('combobox', { name: 'Magazyn (van)' }));
    await user.selectOptions(whSelect, warehouse.id);
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => {
      expect(screen.getByText('Van jest pusty')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Zatwierdź rozliczenie' })).not.toBeInTheDocument();
  });

  it('renders result summary after successful reconciliation with discrepancy row', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValueOnce({
      warehouse_id: 'w-van-1',
      warehouse_name: 'Van Test',
      reconciliation_date: '2026-04-27',
      has_discrepancies: true,
      total_discrepancies: 1,
      items: [
        {
          product_id: 'p-1',
          product_name: 'Mąka',
          unit: 'kg',
          quantity_expected: '10.000',
          quantity_actual: '8.000',
          discrepancy: '-2.000',
          movement_type: 'damage' as const,
        },
      ],
    });
    renderPage();
    const whSelect2 = await waitFor(() => screen.getByRole('combobox', { name: 'Magazyn (van)' }));
    await user.selectOptions(whSelect2, warehouse.id);
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() => screen.getByRole('cell', { name: 'Mąka' }));
    await user.click(screen.getByRole('button', { name: 'Zatwierdź rozliczenie' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Rozliczenie zakończone' })).toBeInTheDocument();
    });
    expect(screen.getByText('Szkoda/niedobór')).toBeInTheDocument();
    expect(screen.getByText('Van Test')).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { ProductHistoryDrawer } from './ProductHistoryDrawer';
import type { WarehouseStockItem } from '@/types';

const hoisted = vi.hoisted(() => ({
  useStockMovementsQuery: vi.fn(),
  useWarehouseBatchesQuery: vi.fn(),
}));

vi.mock('@/query/use-products', () => ({
  useStockMovementsQuery: hoisted.useStockMovementsQuery,
}));

vi.mock('@/query/use-warehouses', () => ({
  useWarehouseBatchesQuery: hoisted.useWarehouseBatchesQuery,
}));

const ITEM: WarehouseStockItem = {
  id: 'stock-1',
  product_id: 'prod-1',
  product_name: 'Mąka pszenna',
  product_sku: 'SKU-001',
  product_unit: 'kg',
  quantity_available: '60',
  quantity_reserved: '10',
  quantity_total: '70',
  min_stock_alert: '20',
  is_below_minimum: false,
  nearest_expiry_date: null,
};

const MOVEMENTS = {
  count: 2,
  results: [
    {
      id: 'm1',
      product: 'prod-1',
      product_name: 'Mąka pszenna',
      warehouse: 'wh-1',
      warehouse_name: 'Magazyn główny',
      movement_type: 'PURCHASE',
      quantity: '100',
      quantity_before: '0',
      quantity_after: '100',
      reference_type: null,
      reference_id: null,
      reference_number: null,
      notes: 'Przyjęcie początkowe',
      created_at: '2026-01-15T10:00:00Z',
      created_by_name: 'user@test.com',
    },
    {
      id: 'm2',
      product: 'prod-1',
      product_name: 'Mąka pszenna',
      warehouse: 'wh-1',
      warehouse_name: 'Magazyn główny',
      movement_type: 'SALE',
      quantity: '-40',
      quantity_before: '100',
      quantity_after: '60',
      reference_type: 'order',
      reference_id: 'ord-uuid-1234',
      reference_number: 'ZAM/2026/0001',
      notes: '',
      created_at: '2026-02-20T14:30:00Z',
      created_by_name: null,
    },
  ],
};

const BATCHES = [
  {
    id: 'b1',
    batch_number: 'LOT-001',
    received_date: '2026-01-15',
    expiry_date: '2026-12-31',
    quantity_initial: '100.00',
    quantity_remaining: '60.00',
    unit_cost: '2.50',
  },
];

function renderDrawer(onClose = vi.fn()) {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <ProductHistoryDrawer
          item={ITEM}
          warehouseId="wh-1"
          warehouseName="MG — Magazyn główny"
          onClose={onClose}
        />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.useStockMovementsQuery.mockReturnValue({
    data: MOVEMENTS,
    isLoading: false,
    isError: false,
  });
  hoisted.useWarehouseBatchesQuery.mockReturnValue({
    data: BATCHES,
    isLoading: false,
    isError: false,
  });
});

describe('ProductHistoryDrawer', () => {
  it('shows product name in header', () => {
    renderDrawer();
    expect(screen.getByText('Mąka pszenna')).toBeInTheDocument();
  });

  it('shows warehouse name in header', () => {
    renderDrawer();
    expect(screen.getByText('MG — Magazyn główny')).toBeInTheDocument();
  });

  it('shows stock summary in header', () => {
    renderDrawer();
    expect(screen.getByText(/dostępne/i)).toBeInTheDocument();
    expect(screen.getByText(/razem/i)).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    renderDrawer(onClose);
    fireEvent.click(screen.getByRole('button', { name: /zamknij/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    renderDrawer(onClose);
    // backdrop is the first div with aria-hidden
    const backdrop = document.querySelector('[aria-hidden]');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows movement history by default', () => {
    renderDrawer();
    expect(screen.getByText('Zakup / Przyjęcie')).toBeInTheDocument();
    expect(screen.getByText('Sprzedaż / Wydanie')).toBeInTheDocument();
  });

  it('shows movement notes', () => {
    renderDrawer();
    expect(screen.getByText('Przyjęcie początkowe')).toBeInTheDocument();
  });

  it('shows document link for order movement', () => {
    renderDrawer();
    const link = screen.getByRole('link', { name: 'ZAM/2026/0001' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/orders/ord-uuid-1234');
  });

  it('shows movement count badge on history tab', () => {
    renderDrawer();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('switches to batches tab and shows batch data', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /partie/i }));
    expect(await screen.findByText('LOT-001')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });

  it('shows batch count badge on batches tab', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /partie/i }));
    // badge shows "1"
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows loading state for movements', () => {
    hoisted.useStockMovementsQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderDrawer();
    expect(screen.getByText(/ładowanie historii/i)).toBeInTheDocument();
  });

  it('shows empty state when no movements', () => {
    hoisted.useStockMovementsQuery.mockReturnValue({
      data: { count: 0, results: [] },
      isLoading: false,
      isError: false,
    });
    renderDrawer();
    expect(screen.getByText(/brak ruchów/i)).toBeInTheDocument();
  });

  it('shows empty state when no batches', async () => {
    hoisted.useWarehouseBatchesQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /partie/i }));
    expect(await screen.findByText(/brak aktywnych partii/i)).toBeInTheDocument();
  });

  it('passes correct params to useStockMovementsQuery', () => {
    renderDrawer();
    expect(hoisted.useStockMovementsQuery).toHaveBeenCalledWith(
      expect.objectContaining({ product: 'prod-1', warehouse: 'wh-1' }),
    );
  });

  it('passes correct params to useWarehouseBatchesQuery', () => {
    renderDrawer();
    expect(hoisted.useWarehouseBatchesQuery).toHaveBeenCalledWith('wh-1', 'prod-1');
  });
});

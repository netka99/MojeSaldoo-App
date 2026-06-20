/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { ProductionOrdersPage } from './ProductionOrdersPage';
import { authStorage } from '@/services/api';
import type { ProductionPlanningItem, ProductionOrder, Recipe } from '@/types/production.types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const usePlanningMock = vi.hoisted(() => vi.fn());
const useOrdersMock = vi.hoisted(() => vi.fn());
const useRecipesMock = vi.hoisted(() => vi.fn());
const useCreateMock = vi.hoisted(() => vi.fn());
const useCompleteMock = vi.hoisted(() => vi.fn());
const useDeleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/query/use-production', () => ({
  useProductionPlanningQuery: (p: object) => usePlanningMock(p),
  useProductionOrdersQuery: (p: number) => useOrdersMock(p),
  useRecipesQuery: () => useRecipesMock(),
  useCreateProductionOrderMutation: () => useCreateMock(),
  useCompleteProductionOrderMutation: () => useCompleteMock(),
  useDeleteProductionOrderMutation: () => useDeleteMock(),
}));

vi.mock('@/query/use-products', () => ({
  useAllProductsQuery: () => ({ data: { results: [] } }),
}));

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, authStorage: { ...actual.authStorage, getAccessToken: () => 'tok' } };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlanningItem(shortfall = '20'): ProductionPlanningItem {
  return {
    product_id: 'prod-1',
    product_name: 'Chleb',
    product_unit: 'szt',
    recipe_id: 'rec-1',
    recipe_name: 'Chleb podstawowy',
    recipe_yield_quantity: '5',
    total_ordered: '30',
    stock_available: '10',
    shortfall,
    suggested_production_qty: shortfall,
    estimated_unit_cost: '0.60',
    estimated_total_cost: String(Number(shortfall) * 0.6),
    ingredients: [{
      ingredient_id: 'ing-1', ingredient_name: 'Mąka', ingredient_unit: 'kg',
      quantity_per_batch: '1', quantity_needed: '4', stock_available: '20',
      avg_cost: '3.00', line_cost_per_batch: '3.00', has_enough_stock: true,
    }],
    orders: [{
      order_id: 'ord-1', order_number: 'ZAM/0001', customer_name: 'Sklep A',
      quantity: '30', delivery_date: '2026-06-21',
    }],
  };
}

function makeRecipe(): Recipe {
  return {
    id: 'rec-1', product: 'prod-1', product_name: 'Chleb', product_unit: 'szt',
    name: 'Chleb podstawowy', yield_quantity: '5', is_active: true, notes: '',
    items: [{
      id: 'ri-1', ingredient: 'ing-1', ingredient_name: 'Mąka', ingredient_unit: 'kg',
      ingredient_avg_cost: '3.00', ingredient_stock_total: '20', quantity: '1', unit: 'kg', notes: '',
    }],
    created_at: '', updated_at: '',
  };
}

function makeOrder(): ProductionOrder {
  return {
    id: 'po-1', order_number: 'PRD/2026/0001', recipe: 'rec-1',
    recipe_name: 'Chleb podstawowy', finished_product_name: 'Chleb', finished_product_unit: 'szt',
    date: '2026-06-19', mode: 'simple', status: 'draft', quantity_produced: '20',
    total_input_cost: null, real_unit_cost: null, rw_document: null, rw_document_number: null,
    pw_document: null, pw_document_number: null, notes: '', inputs: [], completed_at: null, created_at: '',
  };
}

function defaultMocks() {
  usePlanningMock.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
  useOrdersMock.mockReturnValue({ data: { results: [], count: 0 }, isLoading: false });
  useRecipesMock.mockReturnValue({ data: [] });
  useCreateMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
  useCompleteMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
  useDeleteMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/production/orders', element: <ProductionOrdersPage /> }],
    { initialEntries: ['/production/orders'] },
  );
  return render(<TestQueryProvider><RouterProvider router={router} /></TestQueryProvider>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProductionOrdersPage', () => {
  beforeEach(() => {
    vi.spyOn(authStorage, 'getAccessToken').mockReturnValue('tok');
    defaultMocks();
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByText('Produkcja')).toBeInTheDocument();
    expect(screen.getByText('Co wyprodukować')).toBeInTheDocument();
    expect(screen.getByText('Zlecenia produkcji')).toBeInTheDocument();
  });

  it('shows planning item with shortfall badge', async () => {
    usePlanningMock.mockReturnValue({ data: [makePlanningItem()], isLoading: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('Chleb')).toBeInTheDocument());
    expect(screen.getByText(/niedobór 20 szt/)).toBeInTheDocument();
  });

  it('shows "stan ok" badge when no shortfall', async () => {
    usePlanningMock.mockReturnValue({ data: [makePlanningItem('0')], isLoading: false });
    renderPage();
    await waitFor(() => expect(screen.getByText(/stan ok/)).toBeInTheDocument());
  });

  it('shows existing draft production order', async () => {
    useOrdersMock.mockReturnValue({ data: { results: [makeOrder()], count: 1 }, isLoading: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('PRD/2026/0001')).toBeInTheDocument());
    expect(screen.getByText('W produkcji')).toBeInTheDocument();
  });

  it('opens blank form on "+ Nowe zlecenie" click', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Nowe zlecenie/ }));
    await waitFor(() => expect(screen.getByText('Nowe zlecenie produkcji')).toBeInTheDocument());
  });

  it('opens pre-filled form on "+ Zlecenie" from planning row', async () => {
    usePlanningMock.mockReturnValue({ data: [makePlanningItem()], isLoading: false });
    useRecipesMock.mockReturnValue({ data: [makeRecipe()] });
    renderPage();
    await waitFor(() => screen.getByText('Chleb'));
    await userEvent.click(screen.getByRole('button', { name: /\+ Zlecenie/ }));
    await waitFor(() => expect(screen.getByText(/z planu/)).toBeInTheDocument());
    // Quantity should be pre-filled with shortfall
    expect((screen.getByPlaceholderText('np. 300') as HTMLInputElement).value).toBe('20');
  });

  it('expands planning details on "szczegóły" click', async () => {
    usePlanningMock.mockReturnValue({ data: [makePlanningItem()], isLoading: false });
    renderPage();
    await waitFor(() => screen.getByText('Chleb'));
    await userEvent.click(screen.getByText('szczegóły'));
    await waitFor(() => {
      expect(screen.getByText(/Mąka/)).toBeInTheDocument();
      expect(screen.getByText(/ZAM\/0001/)).toBeInTheDocument();
    });
  });

  it('shows shortfall count in planning header', async () => {
    usePlanningMock.mockReturnValue({
      data: [makePlanningItem(), { ...makePlanningItem(), product_id: 'prod-2', product_name: 'Bułka', shortfall: '0' }],
      isLoading: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/1 wyrób wymaga produkcji/)).toBeInTheDocument());
  });

  it('shows empty planning message when no demand', () => {
    renderPage();
    expect(screen.getByText(/Brak otwartych zamówień/)).toBeInTheDocument();
  });
});

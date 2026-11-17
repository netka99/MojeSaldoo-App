/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { OrderCreatePage } from './OrderCreatePage';
import { authStorage } from '@/services/api';
import type { Product } from '@/types';

const mutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-order-1' }));
const createMutationState = vi.hoisted(() => ({ isPending: false }));

vi.mock('@/query/use-orders', () => ({
  useCreateOrderMutation: () => ({
    mutateAsync,
    get isPending() {
      return createMutationState.isPending;
    },
  }),
  useConfirmOrderMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useOrdersByCustomerQuery: () => ({ data: undefined }),
}));

const customerResults = vi.hoisted(() => [
  { id: 'c-1', name: 'Firma Test', nip: '5260000000' as string | null },
]);

vi.mock('@/query/use-customers', () => ({
  useCustomerListQuery: () => ({
    data: { count: 1, next: null, previous: null, results: customerResults },
    isFetching: false,
  }),
  useCustomerQuery: () => ({ data: undefined }),
  useCustomerPricesQuery: () => ({ data: [] }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, current_company: '550e8400-e29b-41d4-a716-446655440000' as string | null },
  }),
}));

const generateWzMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'wz-1' }));

vi.mock('@/query/use-delivery', () => ({
  useGenerateDeliveryForOrderMutation: () => ({
    mutateAsync: generateWzMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/query/use-companies', () => ({
  useWorkflowSettingsQuery: () => ({
    data: { orders_required: false, wz_required_before_invoice: true, auto_wz_on_order: false },
  }),
}));

const productFixtures: Product[] = [
  {
    id: 'p-1',
    user: null,
    name: 'Mąka 1kg',
    description: null,
    unit: 'szt',
    price_net: '4.00',
    price_gross: '4.92',
    vat_rate: '23.00',
    sku: 'SKU-1',
    barcode: null,
    pkwiu: '',
    track_batches: false,
    min_stock_alert: '0',
    shelf_life_days: null,
    is_resalable: false,
    markup_percent: null,
    avg_cost: null,
    avg_cost_source: null,
    avg_cost_updated_at: null,
    last_cost: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'p-2',
    user: null,
    name: 'Chleb tostowy',
    description: null,
    unit: 'szt',
    price_net: '5.00',
    price_gross: '6.15',
    vat_rate: '23.00',
    sku: 'SKU-2',
    barcode: null,
    pkwiu: '',
    track_batches: false,
    min_stock_alert: '0',
    shelf_life_days: null,
    is_resalable: false,
    markup_percent: null,
    avg_cost: null,
    avg_cost_source: null,
    avg_cost_updated_at: null,
    last_cost: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const productFetch = vi.hoisted(() =>
  vi.fn().mockImplementation((params?: { page?: number }) => {
    const page = params?.page ?? 1;
    if (page > 1) {
      return Promise.resolve({ count: 2, next: null, previous: null, results: [] });
    }
    return Promise.resolve({
      count: 2,
      next: null,
      previous: null,
      results: productFixtures,
    });
  }),
);

vi.mock('@/services/product.service', () => ({
  productService: {
    fetchList: (params?: object) => productFetch(params as { page?: number }),
  },
}));

vi.mock('@/query/use-offline-mutations', () => ({
  useOfflineOrderCreate: () =>
    vi.fn().mockImplementation((_body: unknown, fn: (b: unknown) => Promise<unknown>) => fn(_body)),
  OfflineQueuedError: class OfflineQueuedError extends Error {},
}));

function renderPage(initialEntry = '/orders/new') {
  const router = createMemoryRouter(
    [
      { path: '/orders', element: <div>Orders list</div> },
      {
        path: '/orders/new',
        element: (
          <TestQueryProvider>
            <OrderCreatePage />
          </TestQueryProvider>
        ),
      },
      { path: '/orders/:id', element: <div>Order created</div> },
      { path: '/login', element: <div>Logowanie</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}

/** `useDebouncedValue` in OrderCreatePage (300ms). */
async function afterDebounce() {
  await new Promise((r) => {
    window.setTimeout(r, 400);
  });
}

const getToken = vi.spyOn(authStorage, 'getAccessToken');

describe('OrderCreatePage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    getToken.mockReturnValue('token');
    createMutationState.isPending = false;
    vi.clearAllMocks();
    productFetch.mockImplementation((params?: { page?: number }) => {
      const page = params?.page ?? 1;
      if (page > 1) {
        return Promise.resolve({ count: 2, next: null, previous: null, results: [] });
      }
      return Promise.resolve({
        count: 2,
        next: null,
        previous: null,
        results: productFixtures,
      });
    });
  });

  afterEach(() => {
    cleanup();
    getToken.mockReset();
  });

  it('redirects to login when unauthenticated', async () => {
    getToken.mockReturnValue(null);
    renderPage();
    expect(await screen.findByText('Logowanie')).toBeInTheDocument();
  });

  it('pre-fills delivery date from ?date= URL param', () => {
    renderPage('/orders/new?date=2026-05-01');
    const date = screen.getByLabelText('Data dostawy') as HTMLInputElement;
    expect(date.value).toBe('2026-05-01');
  });

  it('does not pre-fill date when URL param absent', () => {
    renderPage('/orders/new');
    const date = screen.getByLabelText('Data dostawy') as HTMLInputElement;
    expect(date.value).toBe('');
  });

  it('shows customer autocomplete and selecting a customer sets it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /Produkt Mąka/ });
    const input = screen.getByLabelText('Wyszukaj klienta');
    await user.type(input, 'Firma');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    // After selecting, heading updates to "Dostawa <CustomerName>"
    await waitFor(() =>
      expect(screen.getByText(/Dostawa Firma Test/)).toBeInTheDocument(),
    );
  });

  it('disables submit while mutation is pending', async () => {
    const user = userEvent.setup();
    createMutationState.isPending = true;
    renderPage('/orders/new?date=2026-06-15');
    // Add a product so we can navigate to checkout
    await user.click(await screen.findByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await user.click(screen.getByRole('button', { name: /Do zamówienia/ }));
    expect(screen.getByRole('button', { name: /Utwórz zamówienie|Tworzenie/ })).toBeDisabled();
  });

  it('shows validation error when customer not selected on submit', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-05-20');
    await user.click(await screen.findByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await user.click(screen.getByRole('button', { name: /Do zamówienia/ }));
    await user.click(screen.getByRole('button', { name: /Utwórz zamówienie/ }));
    expect(await screen.findByText('Wybierz klienta')).toBeInTheDocument();
  });

  it('shows validation error when delivery date is missing', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new');
    await screen.findByRole('button', { name: /Produkt Mąka/ });
    await user.type(screen.getByLabelText('Wyszukaj klienta'), 'Firma');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    await user.click(screen.getByRole('button', { name: /Produkt Chleb/ }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await user.click(screen.getByRole('button', { name: /Do zamówienia/ }));
    await user.click(screen.getByRole('button', { name: /Utwórz zamówienie/ }));
    expect(await screen.findByText('Podaj datę dostawy')).toBeInTheDocument();
  });

  it('cart stays empty — "Do zamówienia" not shown when no products added', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-05-20');
    await screen.findByRole('button', { name: /Produkt Mąka/ });
    await user.type(screen.getByLabelText('Wyszukaj klienta'), 'Firma');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    expect(screen.queryByRole('button', { name: /Do zamówienia/ })).not.toBeInTheDocument();
  });

  it('product list loads and renders items', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Produkt Mąka/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Produkt Chleb/ })).toBeInTheDocument();
    expect(productFetch).toHaveBeenCalled();
  });

  it('tapping a product opens numpad with value 0', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Produkt Chleb/ }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('0');
  });

  it('tapping a product already in order opens numpad with its current quantity', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-05-01');
    await user.click(await screen.findByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));

    await user.click(screen.getByRole('button', { name: /Produkt Mąka/ }));
    expect(screen.getByRole('status')).toHaveTextContent('2');
  });

  it('entering qty via numpad and confirming shows "Do zamówienia" bar', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-06-01');
    await user.click(await screen.findByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));

    // Fixed "Do zamówienia" bar should appear with the total price
    const checkoutBtn = await screen.findByRole('button', { name: /Do zamówienia/ });
    expect(checkoutBtn).toBeInTheDocument();
    expect(checkoutBtn).toHaveTextContent(/Do zamówienia/);

    // Updating qty to 5 should update the displayed total
    await user.click(screen.getByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(checkoutBtn).toBeInTheDocument());
  });

  it('confirming qty 0 hides the quantity controls for that product', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-06-01');
    await user.click(await screen.findByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));

    // Quantity badge 4 is shown
    const rowBefore = screen.getByRole('button', { name: /Produkt Mąka/ })
      .closest('[data-product-row]') ?? screen.getByRole('button', { name: /Produkt Mąka/ }).parentElement!.parentElement!;
    expect(rowBefore).toHaveTextContent('4');

    // Clear the quantity
    await user.click(screen.getByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));

    // Quantity controls (minus/plus) should be gone — qty is 0
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Zmniejsz ilość Mąka/ })).not.toBeInTheDocument();
    });
    // "Do zamówienia" button gone when cart is empty
    expect(screen.queryByRole('button', { name: /Do zamówienia/ })).not.toBeInTheDocument();
  });

  it('checkout bar price updates as lines change', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-06-01');
    await screen.findByRole('button', { name: /Produkt Mąka/ });

    // No checkout bar initially (empty cart)
    expect(screen.queryByRole('button', { name: /Do zamówienia/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));

    // Bar appears and shows the gross total (4,92 for 1×Mąka)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Do zamówienia/ })).toHaveTextContent(/4,92/);
    });
  });

  it('successful submit calls createOrderMutation and navigates back to orders list', async () => {
    const user = userEvent.setup();
    const { router } = renderPage('/orders/new?date=2026-07-10');
    await user.type(screen.getByLabelText('Wyszukaj klienta'), 'F');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    await user.click(await screen.findByRole('button', { name: /Produkt Mąka/ }));
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'OK' }));
    // Navigate to checkout view
    await user.click(screen.getByRole('button', { name: /Do zamówienia/ }));
    await user.click(screen.getByRole('button', { name: /Utwórz zamówienie/ }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
    });
    const payload = mutateAsync.mock.calls[0]![0];
    expect(payload).toMatchObject({
      customer_id: 'c-1',
      delivery_date: '2026-07-10',
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.product_id).toBe('p-1');
    // After submit, navigates back to orders list (with date filter)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orders');
    });
    expect(screen.getByText('Orders list')).toBeInTheDocument();
  });

  it('Space on focused product row opens numpad', async () => {
    const user = userEvent.setup();
    renderPage();
    const row = await screen.findByRole('button', { name: /Produkt Chleb/ });
    row.focus();
    expect(row).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });

  it('numpad closes when OK is confirmed', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-06-01');
    await user.click(await screen.findByRole('button', { name: /Produkt Chleb/ }));
    // Numpad open: OK and Cofnij buttons are visible
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'OK' }));
    // Numpad closed: numpad buttons gone
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    });
  });

  it('back button navigates to /orders with current date query param', async () => {
    const user = userEvent.setup();
    const { router } = renderPage('/orders/new');
    await screen.findByRole('button', { name: /Produkt Mąka/ });
    const dateInput = screen.getByLabelText('Data dostawy');
    await user.type(dateInput, '2026-04-15');
    await user.click(screen.getByRole('button', { name: /Wróć do listy sklepów/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orders');
      expect(router.state.location.search).toContain('date=');
      expect(router.state.location.search).toContain('2026-04-15');
    });
    expect(screen.getByText('Orders list')).toBeInTheDocument();
  });

  it('shows "Wygeneruj WZ od razu" checkbox when viewing checkout', async () => {
    const user = userEvent.setup();
    renderPage('/orders/new?date=2026-07-10');
    // Wait for products to load, then tap to open numpad and add product
    await screen.findByRole('button', { name: /Produkt Mąka/ });
    await user.click(screen.getByRole('button', { name: /Produkt Mąka/ }));
    // Increase qty in numpad
    await user.click(screen.getByRole('button', { name: 'Zwiększ ilość' }));
    await user.click(screen.getByRole('button', { name: /Zatwierdź|OK|Gotowe/ }));
    // Go to checkout via cart button
    const cartBtn = await screen.findByRole('button', { name: /Do zamówienia/ });
    await user.click(cartBtn);
    // Checkbox should appear
    const checkbox = await screen.findByRole('checkbox', { name: /Wygeneruj WZ od razu/ });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked(); // default from mock: auto_wz_on_order = false
  });
});

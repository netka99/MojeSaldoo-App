/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { OrderCreatePage } from './OrderCreatePage';
import { authStorage } from '@/services/api';
import type { Product } from '@/types';

const mutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-order-1' }));

vi.mock('@/query/use-orders', () => ({
  useCreateOrderMutation: () => ({
    mutateAsync: mutateAsync,
    isPending: false,
    isError: false,
  }),
}));

const customerResults = vi.hoisted(() => [
  { id: 'c-1', name: 'Firma Test', nip: '5260000000' as string | null },
]);

vi.mock('@/query/use-customers', () => ({
  useCustomerListQuery: () => ({
    data: { count: 1, next: null, previous: null, results: customerResults },
    isFetching: false,
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, current_company: '550e8400-e29b-41d4-a716-446655440000' as string | null },
  }),
}));

const productFetch = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [
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
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      } as Product,
    ],
  }),
);

vi.mock('@/services/product.service', () => ({
  productService: {
    fetchList: (params?: object) => productFetch(params),
  },
}));

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/orders/new']}>
        <Routes>
          <Route path="/orders/new" element={<OrderCreatePage />} />
          <Route path="/orders/:id" element={<div>Order created</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
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
    getToken.mockReturnValue('token');
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    getToken.mockReset();
  });

  it('redirects to login when unauthenticated', async () => {
    getToken.mockReturnValue(null);
    render(
      <TestQueryProvider>
        <MemoryRouter initialEntries={['/orders/new']}>
          <Routes>
            <Route path="/orders/new" element={<OrderCreatePage />} />
            <Route path="/login" element={<div>Logowanie</div>} />
          </Routes>
        </MemoryRouter>
      </TestQueryProvider>,
    );
    expect(await screen.findByText('Logowanie')).toBeInTheDocument();
  });

  it('shows step 1 fields', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Nowe zamówienie' })).toBeInTheDocument();
    expect(screen.getByLabelText('Wyszukaj klienta')).toBeInTheDocument();
    expect(screen.getByLabelText('Data dostawy')).toBeInTheDocument();
  });

  it('validates required fields on Dalej (step 1)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(await screen.findByText('Wybierz klienta')).toBeInTheDocument();
  });

  it('continues to step 2 and shows product form after filling step 1', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText('Wyszukaj klienta');
    await user.type(input, 'Firma');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    const date = screen.getByLabelText('Data dostawy');
    await user.clear(date);
    await user.type(date, '2026-05-20');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(await screen.findByText('Krok 2 — Produkty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj produkt' })).toBeInTheDocument();
  });

  it('shows live line and order totals in step 2', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Wyszukaj klienta'), 'x');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    const date2 = screen.getByLabelText('Data dostawy');
    await user.clear(date2);
    await user.type(date2, '2026-06-01');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    const search = await screen.findByPlaceholderText('Szukaj produktu…');
    await user.click(search);
    await user.type(search, 'Mąk');
    await afterDebounce();
    const pick = await screen.findByRole('button', { name: /Mąka 1kg/ });
    await user.click(pick);
    const sumBruttoLabel = await screen.findByText('Suma brutto', { exact: true });
    expect(sumBruttoLabel.nextElementSibling).toHaveTextContent(/4,92/);
  });

  it('submits from step 3 and navigates to order', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Wyszukaj klienta'), 'F');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Firma Test/ }));
    const date3 = screen.getByLabelText('Data dostawy');
    await user.clear(date3);
    await user.type(date3, '2026-07-10');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    const search = await screen.findByPlaceholderText('Szukaj produktu…');
    await user.click(search);
    await user.type(search, 'M');
    await afterDebounce();
    await user.click(await screen.findByRole('button', { name: /Mąka 1kg/ }));
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(await screen.findByText('Krok 3 — Przegląd i zatwierdzenie')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Utwórz zamówienie' }));
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
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { InvoiceFromOrdersPage } from './InvoiceFromOrdersPage';
import type { Customer, Order } from '@/types';

// ── mocks ──────────────────────────────────────────────────────────────────────

const generateFromOrdersMutateAsync = vi.hoisted(() => vi.fn());
const useAllActiveCustomersQueryMock = vi.hoisted(() => vi.fn());
const useOrderListQueryMock = vi.hoisted(() => vi.fn());
const useResolvedCompanyIdMock = vi.hoisted(() =>
  vi.fn(() => ({ state: 'ready', companyId: 'co-1', isUnsynced: false, company: undefined })),
);

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: () => 'tok' },
  api: {},
}));

vi.mock('@/query/use-invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-invoices')>();
  return {
    ...actual,
    useGenerateFromOrdersMutation: () => ({
      mutateAsync: generateFromOrdersMutateAsync,
      isPending: false,
    }),
  };
});

vi.mock('@/query/use-customers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-customers')>();
  return {
    ...actual,
    useAllActiveCustomersQuery: (...args: unknown[]) => useAllActiveCustomersQueryMock(...args),
  };
});

vi.mock('@/query/use-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-orders')>();
  return {
    ...actual,
    useOrderListQuery: (...args: unknown[]) => useOrderListQueryMock(...args),
  };
});

vi.mock('@/hooks/useResolvedCompanyId', () => ({
  useResolvedCompanyId: () => useResolvedCompanyIdMock(),
}));

// ── helpers ────────────────────────────────────────────────────────────────────

function makeCustomer(id: string, name: string): Customer {
  return {
    id,
    user: null,
    name,
    company_name: null,
    nip: null,
    email: null,
    phone: null,
    street: null,
    city: null,
    postal_code: null,
    country: 'PL',
    distance_km: null,
    delivery_days: null,
    payment_terms: 14,
    credit_limit: '0',
    is_active: true,
    is_jst: false,
    is_gv_member: false,
    podmiot3_role: null,
    podmiot3_name: null,
    podmiot3_id_wew: null,
    podmiot3_street: null,
    podmiot3_city: null,
    podmiot3_postal_code: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeOrder(id: string, orderNumber: string): Order {
  return {
    id,
    customer_id: 'c-1',
    customer_name: 'Piekarnia Nowak',
    company: 'co-1',
    user: null,
    order_number: orderNumber,
    order_date: '2026-09-01',
    delivery_date: '2026-09-10',
    status: 'delivered',
    subtotal_net: '20.00',
    subtotal_gross: '21.60',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '20.00',
    total_gross: '21.60',
    customer_notes: '',
    internal_notes: '',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    confirmed_at: null,
    delivered_at: null,
    items: [
      {
        id: `item-${id}`,
        product: `prod-${id}`,
        product_name: 'Chleb pszenny',
        product_unit: 'szt',
        quantity: '10',
        quantity_delivered: '10',
        quantity_returned: '0',
        unit_price_net: '2.00',
        unit_price_gross: '2.16',
        vat_rate: '8',
        discount_percent: '0',
        line_net: '20.00',
        line_gross: '21.60',
      },
    ],
  };
}

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/invoices/new/orders']}>
        <Routes>
          <Route path="/invoices/new/orders" element={<InvoiceFromOrdersPage />} />
          <Route path="/invoices/:id" element={<div data-testid="invoice-detail">Faktura</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('InvoiceFromOrdersPage', () => {
  beforeEach(() => {
    generateFromOrdersMutateAsync.mockReset();
    useAllActiveCustomersQueryMock.mockReturnValue({ data: undefined });
    useOrderListQueryMock.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('renders step 1 with customer search field', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Wyszukaj klienta/i)).toBeInTheDocument();
  });

  it('Dalej button is disabled until customer is selected', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Dalej/i })).toBeDisabled();
  });

  it('shows customer dropdown and proceeds to step 2', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({
      data: { results: [makeOrder('ord-1', 'ZAM/2026/0001')], count: 1 },
      isLoading: false,
    });
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));
    await user.click(screen.getByRole('button', { name: /Dalej/i }));

    // Step 2: should show order number
    expect(await screen.findByText('ZAM/2026/0001')).toBeInTheDocument();
  });

  it('shows empty state when customer has no orders', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({ data: { results: [], count: 0 }, isLoading: false });
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));
    await user.click(screen.getByRole('button', { name: /Dalej/i }));

    expect(await screen.findByText(/Brak zamówień/i)).toBeInTheDocument();
  });

  it('enables Dalej only after selecting at least one item', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({
      data: { results: [makeOrder('ord-1', 'ZAM/2026/0001')], count: 1 },
      isLoading: false,
    });
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));
    await user.click(screen.getByRole('button', { name: /Dalej/i }));

    await screen.findByText('ZAM/2026/0001');
    // Items are collapsed — Dalej disabled before any selection
    const dalej = screen.getByRole('button', { name: /Dalej/i });
    expect(dalej).toBeDisabled();
  });

  it('calls generateFromOrders mutation with selected item ids', async () => {
    const user = userEvent.setup();
    generateFromOrdersMutateAsync.mockResolvedValue({ id: 'inv-99' });
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({
      data: { results: [makeOrder('ord-1', 'ZAM/2026/0001')], count: 1 },
      isLoading: false,
    });
    renderPage();

    // Step 1
    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));
    await user.click(screen.getByRole('button', { name: /Dalej/i }));

    // Step 2 — expand order and select the item
    await screen.findByText('ZAM/2026/0001');
    // Expand the order row (click the order header)
    await user.click(screen.getByText('ZAM/2026/0001'));
    await screen.findByText('Chleb pszenny');
    await user.click(screen.getByText('Chleb pszenny'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Dalej/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /Dalej/i }));

    // Step 3 — submit
    await screen.findByText(/Data wystawienia/i);
    await user.click(screen.getByRole('button', { name: /Wystaw fakturę/i }));

    await waitFor(() => {
      expect(generateFromOrdersMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          order_ids: ['ord-1'],
          order_item_ids: ['item-ord-1'],
        }),
      );
    });
    expect(await screen.findByTestId('invoice-detail')).toBeInTheDocument();
  });
});

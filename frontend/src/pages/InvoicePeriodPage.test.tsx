/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { InvoicePeriodPage } from './InvoicePeriodPage';
import type { Customer, Order } from '@/types';

// ── mocks ──────────────────────────────────────────────────────────────────────

const generateFromOrdersMutateAsync = vi.hoisted(() => vi.fn());
const createManualMutateAsync = vi.hoisted(() => vi.fn());
const useAllActiveCustomersQueryMock = vi.hoisted(() => vi.fn());
const useOrderListQueryMock = vi.hoisted(() => vi.fn());
const useInvoicePeriodPreviewWzQueryMock = vi.hoisted(() => vi.fn());
const useResolvedCompanyIdMock = vi.hoisted(() =>
  vi.fn(() => ({ state: 'ready', companyId: 'co-1', isUnsynced: false, company: undefined })),
);

vi.mock('@/hooks/usePriceInputMode', () => ({
  usePriceInputMode: () => ({ mode: 'net' as const, isGross: false, priceLabel: 'Cena netto' }),
}));

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
    useCreateManualInvoiceMutation: () => ({
      mutateAsync: createManualMutateAsync,
      isPending: false,
    }),
    useInvoicePeriodPreviewWzQuery: (...args: unknown[]) => useInvoicePeriodPreviewWzQueryMock(...args),
    useAvailableZalQuery: () => ({ data: [] }),
    useInvoiceNextNumberQuery: () => ({ data: { next_number: 'FV/1/10/2026' } }),
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

// ResizeObserver is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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
        product_name: 'Bułka',
        product_unit: 'szt',
        quantity: '20',
        quantity_delivered: '20',
        quantity_returned: '0',
        unit_price_net: '0.50',
        unit_price_gross: '0.54',
        vat_rate: '8',
        discount_percent: '0',
        line_net: '10.00',
        line_gross: '10.80',
      },
    ],
  };
}

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/invoices/new/period']}>
        <Routes>
          <Route path="/invoices/new/period" element={<InvoicePeriodPage />} />
          <Route path="/invoices/:id" element={<div data-testid="invoice-detail">Faktura</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('InvoicePeriodPage', () => {
  beforeEach(() => {
    generateFromOrdersMutateAsync.mockReset();
    createManualMutateAsync.mockReset();
    useAllActiveCustomersQueryMock.mockReturnValue({ data: undefined });
    useOrderListQueryMock.mockReturnValue({ data: undefined, isLoading: false });
    useInvoicePeriodPreviewWzQueryMock.mockReturnValue({ data: undefined, isLoading: false });
  });

  it('renders step 1 with customer search', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Wyszukaj klienta/i)).toBeInTheDocument();
  });

  it('Dalej is disabled without customer and items', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Dalej/i })).toBeDisabled();
  });

  it('shows source toggle and date range in step 1', () => {
    renderPage();
    expect(screen.getByText('Z zamówień')).toBeInTheDocument();
    expect(screen.getByText('Z WZ dokumentów')).toBeInTheDocument();
  });

  it('shows order numbers after customer is selected, items visible on expand', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({
      data: { results: [makeOrder('ord-1', 'ZAM/2026/0099')], count: 1 },
      isLoading: false,
    });
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));

    // Order header visible, items collapsed by default
    expect(await screen.findByText('ZAM/2026/0099')).toBeInTheDocument();
    expect(screen.queryByText('Bułka')).not.toBeInTheDocument();

    // Expand the order
    await user.click(screen.getByText('ZAM/2026/0099'));
    expect(screen.getByText('Bułka')).toBeInTheDocument();
  });

  it('shows Załaduj wyniki button in WZ mode', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({ data: { results: [], count: 0 }, isLoading: false });
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));

    // Switch to WZ mode
    await user.click(screen.getByText('Z WZ dokumentów'));
    expect(await screen.findByRole('button', { name: /Załaduj wyniki/i })).toBeInTheDocument();
  });

  it('shows WZ preview items after clicking Załaduj', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({ data: { results: [], count: 0 }, isLoading: false });
    // Use stable references to avoid infinite re-render from useEffect([wzPreview.data])
    const wzDataEnabled = [{ product_id: 'p-1', product_name: 'Rogal', product_unit: 'szt', qty: '5', unit_price_net: '1.00', vat_rate: '8' }];
    const wzResultEnabled = { data: wzDataEnabled, isLoading: false, isFetching: false };
    const wzResultDisabled = { data: undefined, isLoading: false, isFetching: false };
    useInvoicePeriodPreviewWzQueryMock.mockImplementation(
      (_cid: string, _df: string, _dt: string, enabled: boolean) =>
        enabled ? wzResultEnabled : wzResultDisabled,
    );
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));

    await user.click(screen.getByText('Z WZ dokumentów'));
    await user.click(await screen.findByRole('button', { name: /Załaduj wyniki/i }));

    expect((await screen.findAllByText('Rogal', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });

  it('submits via generateFromOrders in orders mode', async () => {
    const user = userEvent.setup();
    generateFromOrdersMutateAsync.mockResolvedValue({ id: 'inv-period-1' });
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    useOrderListQueryMock.mockReturnValue({
      data: { results: [makeOrder('ord-1', 'ZAM/2026/0099')], count: 1 },
      isLoading: false,
    });
    renderPage();

    // Step 1 — select customer
    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));

    // Step 1 — expand order then select item
    await screen.findByText('ZAM/2026/0099');
    await user.click(screen.getByText('ZAM/2026/0099'));
    await user.click(await screen.findByText('Bułka'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Dalej/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /Dalej/i }));

    // Step 2 — submit
    await screen.findByLabelText(/Data wystawienia/i);
    await user.click(screen.getByRole('button', { name: /Wystaw fakturę/i }));

    await waitFor(() => {
      expect(generateFromOrdersMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ order_ids: ['ord-1'] }),
      );
    });
    expect(await screen.findByTestId('invoice-detail')).toBeInTheDocument();
  });
});

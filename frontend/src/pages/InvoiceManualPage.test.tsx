/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { InvoiceManualPage } from './InvoiceManualPage';
import type { Customer } from '@/types';

// ── mocks ──────────────────────────────────────────────────────────────────────

const createManualMutateAsync = vi.hoisted(() => vi.fn());
const useAllActiveCustomersQueryMock = vi.hoisted(() => vi.fn());
const useProductSearchQueryMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
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

const useAvailableZalQueryMock = vi.hoisted(() =>
  vi.fn(() => ({ data: [] as import('@/types').AvailableZalInvoice[] })),
);

vi.mock('@/query/use-invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-invoices')>();
  return {
    ...actual,
    useCreateManualInvoiceMutation: () => ({
      mutateAsync: createManualMutateAsync,
      isPending: false,
    }),
    useAvailableZalQuery: (...args: unknown[]) => useAvailableZalQueryMock(...args),
  };
});

vi.mock('@/query/use-customers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-customers')>();
  return {
    ...actual,
    useAllActiveCustomersQuery: (...args: unknown[]) => useAllActiveCustomersQueryMock(...args),
  };
});

vi.mock('@/query/use-products', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-products')>();
  return {
    ...actual,
    useProductSearchQuery: (...args: unknown[]) => useProductSearchQueryMock(...args),
    useAllProductsQuery: () => ({ data: { results: [] } }),
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

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/invoices/new/manual']}>
        <Routes>
          <Route path="/invoices/new/manual" element={<InvoiceManualPage />} />
          <Route path="/invoices/:id" element={<div data-testid="invoice-detail">Faktura</div>} />
          <Route path="/invoices/new" element={<div data-testid="landing">Landing</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('InvoiceManualPage', () => {
  beforeEach(() => {
    createManualMutateAsync.mockReset();
    useAllActiveCustomersQueryMock.mockReturnValue({ data: undefined });
    useAvailableZalQueryMock.mockReturnValue({ data: [] });
  });

  it('renders customer search and invoice type selector', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Wyszukaj klienta/i)).toBeInTheDocument();
    // Invoice type dropdown (VAT/ZAL/ROZ select) should be present
    const typeSelects = screen.getAllByRole('combobox');
    const typeSelect = typeSelects.find((s) => (s as HTMLSelectElement).value === 'VAT');
    expect(typeSelect).toBeTruthy();
  });

  it('Wystaw fakturę is disabled until customer and a priced line exist', () => {
    renderPage();
    const buttons = screen.getAllByRole('button', { name: /Wystaw fakturę/i });
    expect(buttons[0]).toBeDisabled();
  });

  it('shows customer dropdown suggestions when typing', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    renderPage();
    await user.type(screen.getByPlaceholderText(/Wyszukaj klienta/i), 'Pie');
    expect(await screen.findByText('Piekarnia Nowak')).toBeInTheDocument();
  });

  it('shows the selected customer and the add-line control', async () => {
    const user = userEvent.setup();
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    renderPage();
    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));
    expect(await screen.findByText(/Dodaj pozycję/i)).toBeInTheDocument();
    expect(screen.getAllByText('Piekarnia Nowak').length).toBeGreaterThan(0);
  });

  it('calls createManual mutation on submit and navigates to invoice', async () => {
    const user = userEvent.setup();
    createManualMutateAsync.mockResolvedValue({ id: 'inv-new-1' });
    useAllActiveCustomersQueryMock.mockReturnValue({
      data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
    });
    renderPage();

    await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
    await user.click(await screen.findByText('Piekarnia Nowak'));

    await screen.findByText(/Dodaj pozycję/i);
    await user.click(screen.getAllByRole('button', { name: /Dodaj pozycję/i })[0]);
    const nameInput = screen.getByPlaceholderText(/Nazwa…/i);
    await user.type(nameInput, 'Chleb pszenny');
    const priceInputs = screen.getAllByLabelText(/Cena netto/i);
    await user.type(priceInputs[0], '2.50');

    await user.click(screen.getAllByRole('button', { name: /Wystaw fakturę/i })[0]);

    await waitFor(() => {
      expect(createManualMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ customer_id: 'c-1' }),
      );
    });
    expect(await screen.findByTestId('invoice-detail')).toBeInTheDocument();
  });

  describe('ROZ invoice type — ZAL selection', () => {
    function makeZal(id: string, num: string): import('@/types').AvailableZalInvoice {
      return { id, invoice_number: num, issue_date: '2026-09-01', total_gross: '500.00' };
    }

    /** Render page with a customer already in the mock, then select it. */
    async function renderWithCustomerAndSelectROZ(
      user: ReturnType<typeof userEvent.setup>,
      zalData: import('@/types').AvailableZalInvoice[] = [],
    ) {
      useAllActiveCustomersQueryMock.mockReturnValue({
        data: { results: [makeCustomer('c-1', 'Piekarnia Nowak')] },
      });
      useAvailableZalQueryMock.mockReturnValue({ data: zalData });
      renderPage();

      await user.click(screen.getByPlaceholderText(/Wyszukaj klienta/i));
      await user.click(await screen.findByText('Piekarnia Nowak'));
      await screen.findByText(/Dodaj pozycję/i);

      // Switch to ROZ type
      const typeSelects = screen.getAllByRole('combobox');
      const typeSelect = typeSelects.find((s) => (s as HTMLSelectElement).value === 'VAT');
      await user.selectOptions(typeSelect!, 'ROZ');
    }

    it('shows ZAL section when invoice type is ROZ', async () => {
      const user = userEvent.setup();
      await renderWithCustomerAndSelectROZ(user, [makeZal('z-1', 'ZAL/2026/0001')]);

      expect(await screen.findByText(/Faktury zaliczkowe \(ZAL\) do rozliczenia/i)).toBeInTheDocument();
      expect(await screen.findByText('ZAL/2026/0001')).toBeInTheDocument();
    });

    it('does not show ZAL section when invoice type is VAT', () => {
      renderPage();
      expect(screen.queryByText(/Faktury zaliczkowe \(ZAL\) do rozliczenia/i)).not.toBeInTheDocument();
    });

    it('submit is disabled when ROZ and no ZAL selected', async () => {
      const user = userEvent.setup();
      await renderWithCustomerAndSelectROZ(user, [makeZal('z-1', 'ZAL/2026/0001')]);

      // Add a priced line without selecting any ZAL
      await user.click(screen.getAllByRole('button', { name: /Dodaj pozycję/i })[0]);
      await user.type(screen.getByPlaceholderText(/Nazwa…/i), 'Usługa');
      const priceInputs = screen.getAllByLabelText(/Cena netto/i);
      await user.type(priceInputs[0], '100');

      const buttons = screen.getAllByRole('button', { name: /Wystaw fakturę/i });
      expect(buttons[0]).toBeDisabled();
    });

    it('submit enabled after selecting a ZAL invoice', async () => {
      const user = userEvent.setup();
      await renderWithCustomerAndSelectROZ(user, [makeZal('z-1', 'ZAL/2026/0001')]);

      // Add a priced line
      await user.click(screen.getAllByRole('button', { name: /Dodaj pozycję/i })[0]);
      await user.type(screen.getByPlaceholderText(/Nazwa…/i), 'Usługa');
      const priceInputs = screen.getAllByLabelText(/Cena netto/i);
      await user.type(priceInputs[0], '100');

      // Select a ZAL invoice
      const zalCheckbox = await screen.findByRole('checkbox', { name: /ZAL\/2026\/0001/i });
      await user.click(zalCheckbox);

      const buttons = screen.getAllByRole('button', { name: /Wystaw fakturę/i });
      expect(buttons[0]).not.toBeDisabled();
    });

    it('passes advance_invoice_ids in submit payload when ROZ', async () => {
      const user = userEvent.setup();
      createManualMutateAsync.mockResolvedValue({ id: 'roz-inv-1' });
      await renderWithCustomerAndSelectROZ(user, [makeZal('z-1', 'ZAL/2026/0001')]);

      await user.click(screen.getAllByRole('button', { name: /Dodaj pozycję/i })[0]);
      await user.type(screen.getByPlaceholderText(/Nazwa…/i), 'Usługa');
      const priceInputs = screen.getAllByLabelText(/Cena netto/i);
      await user.type(priceInputs[0], '100');

      const zalCheckbox = await screen.findByRole('checkbox', { name: /ZAL\/2026\/0001/i });
      await user.click(zalCheckbox);

      await user.click(screen.getAllByRole('button', { name: /Wystaw fakturę/i })[0]);

      await waitFor(() => {
        expect(createManualMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            ksef_invoice_type: 'ROZ',
            advance_invoice_ids: ['z-1'],
          }),
        );
      });
    });

    it('shows empty state when no ZAL available for customer', async () => {
      const user = userEvent.setup();
      await renderWithCustomerAndSelectROZ(user, []);

      expect(
        await screen.findByText(/Brak nierozliczonych faktur zaliczkowych/i),
      ).toBeInTheDocument();
    });
  });
});

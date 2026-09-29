/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { PaperScannerPage } from './PaperScannerPage';
import { authStorage } from '@/services/api';

const hoisted = vi.hoisted(() => ({
  useKsefScanPaperMutation: vi.fn(),
  useCreatePzMutation: vi.fn(),
  useCreatePurchaseDocumentMutation: vi.fn(),
  useSetPurchaseDocCategoryMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useSetLinecategoriesMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useModuleGuard: vi.fn((m: string) => m === 'purchasing'),
}));

vi.mock('@/query/use-invoices', () => ({
  useKsefScanPaperMutation: hoisted.useKsefScanPaperMutation,
}));

vi.mock('@/query/use-delivery', () => ({
  useCreatePzMutation: hoisted.useCreatePzMutation,
}));

vi.mock('@/query/use-purchase-documents', () => ({
  useCreatePurchaseDocumentMutation: hoisted.useCreatePurchaseDocumentMutation,
  useSetPurchaseDocCategoryMutation: hoisted.useSetPurchaseDocCategoryMutation,
  useSetLinecategoriesMutation: hoisted.useSetLinecategoriesMutation,
}));

vi.mock('@/query/use-cashflow', () => ({
  useOpexCategoriesQuery: vi.fn(() => ({ data: [
    { id: '1', slug: 'spozywcze', name: 'Artykuły spożywcze', kpir_column: '13' },
    { id: '2', slug: 'transport', name: 'Transport', kpir_column: '13' },
  ] })),
}));

vi.mock('@/hooks/useModuleGuard', () => ({
  useModuleGuard: (m: string) => hoisted.useModuleGuard(m),
}));

vi.mock('@/query/use-suppliers', () => ({
  useAllSuppliersQuery: vi.fn(() => ({ data: [] })),
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

vi.mock('@/services/warehouse.service', () => ({
  warehouseService: { fetchList: vi.fn(() => Promise.resolve({ results: [{ id: 'wh-1', name: 'Magazyn główny' }] })) },
}));

vi.mock('@/services/product.service', () => ({
  productService: {
    fetchList: vi.fn(() =>
      Promise.resolve({ results: [], count: 0, next: null, previous: null }),
    ),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { current_company: 'company-1' } })),
}));

global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/ksef/scan-paper']}>
        <Routes>
          <Route path="/ksef/scan-paper" element={<PaperScannerPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
          <Route path="/delivery/:id" element={<div>PZ szczegóły</div>} />
          <Route path="/purchase-documents" element={<div>Dokumenty zakupowe</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

const mockIdleScan = {
  mutateAsync: vi.fn(),
  isPending: false,
  isSuccess: false,
};

const mockIdleCreate = {
  mutateAsync: vi.fn(),
  isPending: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.useModuleGuard.mockImplementation((m: string) => m === 'purchasing');
  vi.mocked(authStorage.getAccessToken).mockReturnValue('tok');
  hoisted.useKsefScanPaperMutation.mockReturnValue(mockIdleScan);
  hoisted.useCreatePzMutation.mockReturnValue(mockIdleCreate);
  hoisted.useCreatePurchaseDocumentMutation.mockReturnValue(mockIdleCreate);
});

describe('PaperScannerPage', () => {
  it('renders page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /skanuj fakturę papierową/i })).toBeInTheDocument();
  });

  it('redirects to login when no token', () => {
    vi.mocked(authStorage.getAccessToken).mockReturnValue(null);
    renderPage();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('shows upload area initially', () => {
    renderPage();
    expect(screen.getByText(/kliknij, aby wybrać zdjęcie/i)).toBeInTheDocument();
  });

  it('does not show exclusive scan tiles', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /przyjęcie na stan/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /koszt \/ paragon/i })).not.toBeInTheDocument();
  });

  it('does not show warehouse picker in silent mode', async () => {
    renderPage();
    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    expect(screen.queryByLabelText(/magazyn docelowy/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/kwota brutto/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /przyjmij towar na stan/i })).toBeInTheDocument();
  });

  it('hides stock toggle when production and purchasing are off', async () => {
    hoisted.useModuleGuard.mockReturnValue(false);
    renderPage();
    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    expect(screen.queryByRole('switch', { name: /przyjmij towar na stan/i })).not.toBeInTheDocument();
  });

  it('shows warehouse picker when warehouse module is on and stock is accepted', async () => {
    hoisted.useModuleGuard.mockImplementation((m: string) => m === 'purchasing' || m === 'warehouses');
    renderPage();
    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    expect(screen.getByLabelText(/magazyn docelowy/i)).toBeInTheDocument();
  });

  it('shows OCR button after image is selected', async () => {
    renderPage();
    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    expect(screen.getByRole('button', { name: /odczytaj dane/i })).toBeInTheDocument();
  });

  it('calls scan mutation when OCR button is clicked', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      seller_name: '',
      seller_nip: '1234567890',
      invoice_number: 'FV/2026/001',
      issue_date: '2026-04-15',
      total_gross: '1230.00',
      raw_text: '',
    });
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, mutateAsync });
    renderPage();

    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    const file = new File(['img'], 'invoice.png', { type: 'image/png' });
    await userEvent.upload(fileInput, file);

    await userEvent.click(screen.getByRole('button', { name: /odczytaj dane/i }));
    expect(mutateAsync).toHaveBeenCalledWith(file);
  });

  it('pre-fills fields from OCR result including net and VAT', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      seller_name: 'Firma ABC',
      seller_nip: '1234567890',
      invoice_number: 'FV/2026/001',
      issue_date: '2026-04-15',
      total_gross: '1230.00',
      total_net: '1000.00',
      total_vat: '230.00',
      raw_text: 'some text',
      doc_type: 'faktura_a4',
    });
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, mutateAsync });
    renderPage();

    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /odczytaj dane/i }));

    expect(screen.getByDisplayValue('FV/2026/001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1234567890')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Firma ABC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue('2026-04-15')).toBeInTheDocument();
    expect(screen.getByLabelText(/^netto$/i)).toHaveValue(1000);
    expect(screen.getByLabelText(/^vat$/i)).toHaveValue(230);
    expect(screen.getByText(/samochód osobowy/i)).toBeInTheDocument();
  });

  it('saves PAR_VAT when buyer NIP matches company', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      seller_name: 'Sklep',
      seller_nip: '1111111111',
      invoice_number: '480130',
      issue_date: '2026-06-10',
      total_gross: '82.53',
      total_net: '76.42',
      total_vat: '6.11',
      raw_text: '',
      doc_type: 'paragon',
      buyer_nip: '8442120248',
      buyer_nip_matches_company: true,
    });
    const createDoc = vi.fn().mockResolvedValue({});
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, mutateAsync });
    hoisted.useCreatePurchaseDocumentMutation.mockReturnValue({ mutateAsync: createDoc, isPending: false });
    renderPage();

    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'receipt.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /odczytaj dane/i }));
    await userEvent.click(await screen.findByRole('button', { name: /zapisz par z nip/i }));

    expect(createDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        doc_type: 'PAR_VAT',
        total_net: '76.42',
        total_vat: '6.11',
        vat_deduction: 'full',
        is_private: false,
      }),
    );
  });

  it('saves PAR without VAT when buyer NIP does not match', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      seller_name: 'Sklep',
      seller_nip: '1111111111',
      invoice_number: '480130',
      issue_date: '2026-06-10',
      total_gross: '82.53',
      total_net: '76.42',
      total_vat: '6.11',
      raw_text: '',
      doc_type: 'paragon',
      buyer_nip: '',
      buyer_nip_matches_company: false,
    });
    const createDoc = vi.fn().mockResolvedValue({});
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, mutateAsync });
    hoisted.useCreatePurchaseDocumentMutation.mockReturnValue({ mutateAsync: createDoc, isPending: false });
    renderPage();

    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'receipt.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /odczytaj dane/i }));
    await userEvent.click(await screen.findByRole('button', { name: /zapisz paragon/i }));

    expect(createDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        doc_type: 'PAR',
        vat_deduction: 'none',
        is_private: false,
      }),
    );
  });

  it('preserves stock toggle state after OCR with no product lines', async () => {
    // Toggle is never auto-reset by OCR — user controls it manually
    const mutateAsync = vi.fn().mockResolvedValue({
      seller_name: 'PGNiG',
      seller_nip: '1234567890',
      invoice_number: 'FV/GAZ/1',
      issue_date: '2026-04-15',
      total_gross: '200.00',
      raw_text: '',
      doc_type: 'faktura_a4',
      lines: [],
    });
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, mutateAsync });
    renderPage();
    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'gas.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /odczytaj dane/i }));
    // Default is ON — OCR does not reset it
    expect(await screen.findByRole('switch', { name: /przyjmij towar na stan/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not create PZ when saving without matched stock lines', async () => {
    const createDoc = vi.fn().mockResolvedValue({});
    const createPz = vi.fn().mockResolvedValue({ id: 'pz-1' });
    hoisted.useCreatePurchaseDocumentMutation.mockReturnValue({ mutateAsync: createDoc, isPending: false });
    hoisted.useCreatePzMutation.mockReturnValue({ mutateAsync: createPz, isPending: false });
    renderPage();
    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /zapisz paragon/i }));
    expect(createDoc).toHaveBeenCalled();
    expect(createPz).not.toHaveBeenCalled();
  });

  it('shows scanning state while OCR is pending', () => {
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, isPending: true });
    renderPage();
    expect(hoisted.useKsefScanPaperMutation).toHaveBeenCalled();
  });

  it('shows success message after scan', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      seller_name: '',
      seller_nip: '',
      invoice_number: '',
      issue_date: '',
      total_gross: '',
      raw_text: '',
    });
    hoisted.useKsefScanPaperMutation.mockReturnValue({
      ...mockIdleScan, mutateAsync, isSuccess: true,
    });
    renderPage();

    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));

    expect(screen.getByText(/dane odczytane/i)).toBeInTheDocument();
  });

  it('shows error message when scan fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('OCR failed'));
    hoisted.useKsefScanPaperMutation.mockReturnValue({ ...mockIdleScan, mutateAsync });
    renderPage();

    const fileInput = screen.getByLabelText(/wybierz zdjęcie faktury/i);
    await userEvent.upload(fileInput, new File(['img'], 'invoice.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: /odczytaj dane/i }));

    expect(await screen.findByText(/nie udało się przetworzyć/i)).toBeInTheDocument();
  });
});

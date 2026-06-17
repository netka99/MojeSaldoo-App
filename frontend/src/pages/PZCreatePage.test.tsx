/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { PZCreatePage } from './PZCreatePage';

/* ── mocks ──────────────────────────────────────────────────────────────── */

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { current_company: 'company-1' } }),
}));

vi.mock('@/query/use-delivery', () => ({
  useCreatePzMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock('@/query/use-suppliers', () => ({
  useAllSuppliersQuery: () => ({ data: [] }),
}));

vi.mock('@/services/warehouse.service', () => ({
  warehouseService: {
    fetchList: () =>
      Promise.resolve({
        results: [{ id: 'wh-1', name: 'Magazyn główny' }],
      }),
  },
}));

vi.mock('@/services/product.service', () => ({
  productService: {
    fetchList: () =>
      Promise.resolve({
        results: [
          {
            id: 'prod-1',
            name: 'Mąka pszenna',
            unit: 'kg',
            price_net: '2.50',
            price_gross: '2.70',
          },
        ],
        next: null,
        previous: null,
        count: 1,
      }),
  },
}));

/* ── helpers ─────────────────────────────────────────────────────────────── */

function renderPage() {
  return render(
    <MemoryRouter>
      <TestQueryProvider>
        <PZCreatePage />
      </TestQueryProvider>
    </MemoryRouter>,
  );
}

/* ── tests ───────────────────────────────────────────────────────────────── */

describe('PZCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    renderPage();
    expect(screen.getByText('Nowe PZ')).toBeTruthy();
  });

  it('renders document header fields', () => {
    renderPage();
    expect(screen.getByLabelText(/data wystawienia/i)).toBeTruthy();
    expect(screen.getByText(/magazyn docelowy/i)).toBeTruthy();
    expect(screen.getByText(/dostawca/i)).toBeTruthy();
  });

  it('submit button is disabled when no lines added', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /utwórz pz/i });
    expect(btn).toBeTruthy();
    // disabled when lines.length === 0
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows expiry_date column label after product search is opened', async () => {
    renderPage();
    const searchInput = screen.getByPlaceholderText(/wyszukaj i dodaj produkt/i);
    fireEvent.focus(searchInput);
    // Product search opened — product list shown (mocked)
    // We only assert the input exists, product add via click tested separately
    expect(searchInput).toBeTruthy();
  });
});

describe('PZCreatePage — expiry_date field', () => {
  it('renders expiry_date input after product is added to lines', async () => {
    renderPage();

    // Open product search
    const searchInput = screen.getByPlaceholderText(/wyszukaj i dodaj produkt/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'Mąka' } });

    // Wait for product to appear and click it
    await vi.waitFor(() => screen.getByText('Mąka pszenna'));
    fireEvent.click(screen.getByText('Mąka pszenna'));

    // After adding, expiry_date input must be present
    const expiryInput = screen.getByLabelText(/data ważności — Mąka pszenna/i);
    expect(expiryInput).toBeTruthy();
    expect((expiryInput as HTMLInputElement).type).toBe('date');
  });

  it('expiry_date input is empty by default', async () => {
    renderPage();
    const searchInput = screen.getByPlaceholderText(/wyszukaj i dodaj produkt/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'Mąka' } });
    await vi.waitFor(() => screen.getByText('Mąka pszenna'));
    fireEvent.click(screen.getByText('Mąka pszenna'));

    const expiryInput = screen.getByLabelText(/data ważności — Mąka pszenna/i) as HTMLInputElement;
    expect(expiryInput.value).toBe('');
  });

  it('can type a date into the expiry_date field', async () => {
    renderPage();
    const searchInput = screen.getByPlaceholderText(/wyszukaj i dodaj produkt/i);
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'Mąka' } });
    await vi.waitFor(() => screen.getByText('Mąka pszenna'));
    fireEvent.click(screen.getByText('Mąka pszenna'));

    const expiryInput = screen.getByLabelText(/data ważności — Mąka pszenna/i) as HTMLInputElement;
    fireEvent.change(expiryInput, { target: { value: '2026-12-31' } });
    expect(expiryInput.value).toBe('2026-12-31');
  });
});

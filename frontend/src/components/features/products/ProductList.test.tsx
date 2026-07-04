/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ProductList } from './ProductList';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import type { Product } from '@/types';

const mocks = vi.hoisted(() => ({
  fetchList: vi.fn(),
}));

vi.mock('@/services/product.service', () => ({
  productService: {
    fetchList: mocks.fetchList,
  },
}));

function product(over: Partial<Product> = {}): Product {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    user: 1,
    name: 'Mleko',
    description: null,
    unit: 'l',
    price_net: '4.00',
    price_gross: '4.92',
    vat_rate: '23',
    sku: 'SKU-1',
    barcode: null,
    pkwiu: '',
    track_batches: false,
    min_stock_alert: '0',
    shelf_life_days: null,
    is_service: false,
    is_resalable: true,
    markup_percent: null,
    avg_cost: null,
    avg_cost_source: null,
    avg_cost_updated_at: null,
    last_cost: null,
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

function renderList(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <TestQueryProvider>{ui}</TestQueryProvider>
    </MemoryRouter>,
  );
}

describe('ProductList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchList.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [product()],
    });
  });

  it('loads products and shows heading', async () => {
    renderList(<ProductList />);

    expect(screen.getByRole('heading', { name: /produkty/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenCalledWith({
        page: 1,
        sku: undefined,
        ordering: '-created_at',
        is_service: undefined,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('1 produkt')).toBeInTheDocument();
    });
  });

  it('renders product row in the table', async () => {
    renderList(<ProductList />);

    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Mleko')).toBeInTheDocument();
    expect(within(table).getByText('SKU-1')).toBeInTheDocument();
  });

  it('shows empty state when there are no results', async () => {
    mocks.fetchList.mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });

    renderList(<ProductList />);

    expect(await screen.findByText(/brak produktów spełniających ten filtr/i)).toBeInTheDocument();
  });

  it('shows error and retries fetch', async () => {
    mocks.fetchList.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce({
      count: 1,
      next: null,
      previous: null,
      results: [product({ name: 'Ok' })],
    });

    renderList(<ProductList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');

    await userEvent.click(screen.getByRole('button', { name: /spróbuj ponownie/i }));

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenCalledTimes(2);
    });

    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Ok')).toBeInTheDocument();
  });

  it('paginates when count exceeds page size', async () => {
    mocks.fetchList
      .mockResolvedValueOnce({
        count: 25,
        next: 'http://localhost/api/products/?page=2',
        previous: null,
        results: [product({ id: '11111111-1111-1111-1111-111111111111', name: 'Page1' })],
      })
      .mockResolvedValueOnce({
        count: 25,
        next: null,
        previous: 'http://localhost/api/products/?page=1',
        results: [product({ id: '22222222-2222-2222-2222-222222222222', name: 'Page2' })],
      });

    renderList(<ProductList />);

    const table1 = await screen.findByRole('table');
    expect(await within(table1).findByText('Page1')).toBeInTheDocument();

    expect(screen.getByRole('navigation', { name: /paginacja/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^następna$/i }));

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenLastCalledWith({
        page: 2,
        sku: undefined,
        ordering: '-created_at',
        is_service: undefined,
      });
    });

    const table2 = await screen.findByRole('table');
    expect(await within(table2).findByText('Page2')).toBeInTheDocument();
  });

  it('debounces search before refetching', async () => {
    const user = userEvent.setup();

    renderList(<ProductList />);

    await waitFor(() => expect(mocks.fetchList).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/filtruj produkty po kodzie sku/i), 'abc');

    await waitFor(
      () => {
        expect(mocks.fetchList).toHaveBeenLastCalledWith({
          page: 1,
          sku: 'abc',
          ordering: '-created_at',
          is_service: undefined,
        });
      },
      { timeout: 4000 },
    );
  });

  it('invokes onEdit when Edit is clicked', async () => {
    const onEdit = vi.fn();
    renderList(<ProductList onEdit={onEdit} />);

    const table = await screen.findByRole('table');
    await within(table).findByText('Mleko');

    const editButtons = screen.getAllByRole('button', { name: /^edytuj$/i });
    await userEvent.click(editButtons[0]!);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mleko' }));
  });

  it('invokes onRowClick when table row is clicked', async () => {
    const onRowClick = vi.fn();
    renderList(<ProductList onRowClick={onRowClick} />);

    const table = await screen.findByRole('table');
    const row = (await within(table).findByText('Mleko')).closest('tr');
    expect(row).toBeTruthy();
    await userEvent.click(row!);

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mleko' }));
  });

  it('renders Wszystkie / Produkty / Usługi filter tabs', async () => {
    renderList(<ProductList />);
    expect(screen.getByRole('button', { name: 'Wszystkie' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Produkty' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usługi' })).toBeInTheDocument();
  });

  it('clicking Usługi tab passes is_service=true to fetchList', async () => {
    renderList(<ProductList />);
    await waitFor(() => expect(mocks.fetchList).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Usługi' }));

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ is_service: true }),
      );
    });
  });

  it('clicking Produkty tab passes is_service=false to fetchList', async () => {
    renderList(<ProductList />);
    await waitFor(() => expect(mocks.fetchList).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Produkty' }));

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ is_service: false }),
      );
    });
  });

  it('Usługi tab shows correct count label and empty state', async () => {
    mocks.fetchList.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    renderList(<ProductList />);

    await userEvent.click(screen.getByRole('button', { name: 'Usługi' }));

    expect(await screen.findByText(/brak usług spełniających ten filtr/i)).toBeInTheDocument();
  });

  it('shows type badge in All view when product is a service', async () => {
    mocks.fetchList.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [product({ name: 'Usługa testowa', is_service: true })],
    });
    renderList(<ProductList />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Usługa')).toBeInTheDocument();
  });
});

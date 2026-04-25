/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import {
  OrdersPage,
  buildOrderListApiFilters,
  orderStatusBadgeClassName,
} from './OrdersPage';
import { authStorage } from '@/services/api';
import type { OrderListFilters } from '@/query/use-orders';
import type { Order } from '@/types';

const useOrderListQueryMock = vi.hoisted(() =>
  vi.fn(((_page: number, _filters: OrderListFilters) => ({
    data: {
      count: 0,
      next: null,
      previous: null,
      results: [] as Order[],
    },
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })) as (
    page: number,
    filters: OrderListFilters,
  ) => {
    data: { count: number; next: null; previous: null; results: Order[] };
    isFetching: false;
    isError: false;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  }),
);

vi.mock('@/query/use-orders', () => ({
  useOrderListQuery: (page: number, filters: OrderListFilters) => useOrderListQueryMock(page, filters),
}));

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    customer_id: 'c-1',
    customer_name: 'Jan Kowalski',
    company: 'co-1',
    user: null,
    order_number: 'ZAM/2026/01',
    order_date: '2026-04-01',
    delivery_date: '2026-04-20',
    status: 'confirmed',
    subtotal_net: '100.00',
    subtotal_gross: '123.00',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '100.00',
    total_gross: '123.00',
    customer_notes: '',
    internal_notes: '',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    confirmed_at: '2026-04-01T10:00:00Z',
    delivered_at: null,
    items: [],
    ...over,
  };
}

function renderOrdersRoute() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/new" element={<div>New order form</div>} />
          <Route path="/orders/:id" element={<div>Order detail</div>} />
          <Route path="/login" element={<div>Logowanie</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('buildOrderListApiFilters + orderStatusBadgeClassName', () => {
  it('builds filters only for non-empty fields', () => {
    expect(buildOrderListApiFilters('', '', '', '')).toEqual({});
    expect(buildOrderListApiFilters('  test ', 'confirmed' as const, '2026-01-10', '2026-01-20')).toEqual({
      search: 'test',
      status: 'confirmed',
      delivery_date_after: '2026-01-10',
      delivery_date_before: '2026-01-20',
    });
  });

  it('uses specified badge colors for draft, confirmed, delivered, cancelled', () => {
    expect(orderStatusBadgeClassName('draft')).toContain('gray');
    expect(orderStatusBadgeClassName('confirmed')).toContain('blue');
    expect(orderStatusBadgeClassName('delivered')).toContain('green');
    expect(orderStatusBadgeClassName('cancelled')).toContain('red');
  });
});

describe('OrdersPage', () => {
  const getToken = vi.spyOn(authStorage, 'getAccessToken');

  beforeEach(() => {
    getToken.mockReturnValue('test-access-token');
    useOrderListQueryMock.mockReset();
    useOrderListQueryMock.mockImplementation((_page, _filters) => ({
      data: {
        count: 0,
        next: null,
        previous: null,
        results: [] as Order[],
      },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  afterEach(() => {
    getToken.mockReset();
  });

  it('redirects to login when there is no access token', () => {
    getToken.mockReturnValue(null);
    renderOrdersRoute();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('renders table headers, title, and the new order control', () => {
    renderOrdersRoute();
    expect(screen.getByRole('heading', { name: 'Zamówienia' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Lista zamówień' });
    expect(
      within(table).getByRole('columnheader', { name: 'Nr zamówienia' }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Klient' })).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Data dostawy' }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Wartość brutto' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nowe zamówienie' })).toBeInTheDocument();
  });

  it('navigates to /orders/new when clicking Nowe zamówienie', async () => {
    const user = userEvent.setup();
    renderOrdersRoute();
    await user.click(screen.getByRole('button', { name: 'Nowe zamówienie' }));
    expect(await screen.findByText('New order form')).toBeInTheDocument();
  });

  it('shows a row with order number, client, delivery date, gross, and status label', () => {
    const o = makeOrder({ status: 'delivered' });
    useOrderListQueryMock.mockReturnValue({
      data: { count: 1, next: null, previous: null, results: [o] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderOrdersRoute();
    const table = screen.getByRole('table', { name: 'Lista zamówień' });
    expect(screen.getAllByText('ZAM/2026/01').length).toBe(2);
    expect(within(table).getByText('Jan Kowalski')).toBeInTheDocument();
    expect(within(table).getByText('Dostarczone')).toBeInTheDocument();
    expect(within(table).getByText(/123,00/)).toBeInTheDocument();
  });

  it('applies status filter to the list query (confirmed)', async () => {
    const user = userEvent.setup();
    renderOrdersRoute();
    const select = screen.getByLabelText('Filtruj zamówienia po statusie');
    await user.selectOptions(select, 'confirmed');
    expect(useOrderListQueryMock).toHaveBeenCalled();
    const last = useOrderListQueryMock.mock.calls.at(-1);
    expect(last?.[0]).toBe(1);
    expect(last?.[1]).toMatchObject({ status: 'confirmed' });
  });

  it('sends date range in list query params', async () => {
    const user = userEvent.setup();
    renderOrdersRoute();
    await user.clear(screen.getByLabelText('Data dostawy od'));
    await user.type(screen.getByLabelText('Data dostawy od'), '2026-04-01');
    await user.clear(screen.getByLabelText('Data dostawy do'));
    await user.type(screen.getByLabelText('Data dostawy do'), '2026-04-10');
    const last = useOrderListQueryMock.mock.calls.at(-1);
    expect(last?.[1]).toMatchObject({
      delivery_date_after: '2026-04-01',
      delivery_date_before: '2026-04-10',
    });
  });

  it('debounces customer search before updating the list query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderOrdersRoute();
    const input = screen.getByLabelText('Filtruj zamówienia po kliencie lub numerze');
    const callsAtStart = useOrderListQueryMock.mock.calls.length;
    await user.type(input, 'acme');
    const callsBeforeDebounce = useOrderListQueryMock.mock.calls
      .slice(callsAtStart)
      .filter((c) => (c[1] as OrderListFilters).search === 'acme');
    expect(callsBeforeDebounce.length).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    const callsWithSearch = useOrderListQueryMock.mock.calls
      .slice(callsAtStart)
      .filter((c) => (c[1] as OrderListFilters).search === 'acme');
    expect(callsWithSearch.length).toBeGreaterThan(0);
    expect(callsWithSearch.at(-1)?.[1]).toMatchObject({ search: 'acme' });
    vi.useRealTimers();
  });

  it('shows pagination and requests the next page', async () => {
    const user = userEvent.setup();
    const o1 = makeOrder({ id: 'a', order_number: '1' });
    const pages = 25;
    useOrderListQueryMock.mockImplementation((page) => ({
      data: {
        count: pages,
        next: null,
        previous: null,
        results: page === 1 ? [o1] : [makeOrder({ id: 'b', order_number: '2' })],
      },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }));
    renderOrdersRoute();
    const paginationNav = screen.getByRole('navigation', { name: 'Stronicowanie listy zamówień' });
    expect(paginationNav).toHaveTextContent('Strona');
    expect(paginationNav).toHaveTextContent('1');
    expect(paginationNav).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'Następna' }));
    expect(useOrderListQueryMock).toHaveBeenCalledWith(2, expect.any(Object));
    await waitFor(() => {
      const links = screen.queryAllByRole('link', { name: '2' });
      expect(links.some((a) => a.getAttribute('href') === '/orders/b')).toBe(true);
    });
  });
});

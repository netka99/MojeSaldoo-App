/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { OrdersPage, todayIso } from './OrdersPage';
import { authStorage } from '@/services/api';
import type { Customer, Order, OrderItem } from '@/types';

const useOrdersByDateQueryMock = vi.hoisted(() => vi.fn());

/** Mutable customers-query shape for `@/query/use-customers` mock (avoids `useAuth`). */
const customersQueryFixture = vi.hoisted(() => ({
  results: [] as Customer[],
  isPending: false,
  isError: false,
  error: null as Error | null,
}));

const generateWzMock = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ id: 'wz-1' }),
  isPending: false,
}));

const useModuleGuardMock = vi.hoisted(() => vi.fn((_m: string) => false));

vi.mock('@/hooks/useModuleGuard', () => ({
  useModuleGuard: (m: string) => useModuleGuardMock(m),
}));

vi.mock('@/query/use-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-orders')>();
  return {
    ...actual,
    useOrdersByDateQuery: (date: string) => useOrdersByDateQueryMock(date),
  };
});

vi.mock('@/query/use-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-delivery')>();
  return {
    ...actual,
    useGenerateDeliveryForOrderMutation: () => generateWzMock,
  };
});

function mockCustomer(id: string, name: string): Customer {
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

vi.mock('@/query/use-customers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-customers')>();
  return {
    ...actual,
    useAllActiveCustomersQuery: (_search: string) => ({
      data: customersQueryFixture.isError
        ? undefined
        : {
            count: customersQueryFixture.results.length,
            next: null,
            previous: null,
            results: customersQueryFixture.results,
          },
      isPending: customersQueryFixture.isPending,
      isError: customersQueryFixture.isError,
      error: customersQueryFixture.error,
      refetch: vi.fn(),
    }),
  };
});

function makeOrder(over: Partial<Order> = {}): Order {
  const id = over.id ?? 'ord-1';
  return {
    id,
    customer_id: over.customer_id ?? id,
    customer_name: 'Jan Kowalski',
    company: 'co-1',
    user: null,
    order_number: over.order_number ?? `ZAM/2026/${id}`,
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

function makeOrderLine(
  over: Partial<OrderItem> & Pick<OrderItem, 'id' | 'product_id' | 'product_name' | 'line_total_gross'>,
): OrderItem {
  return {
    product_unit: 'szt.',
    quantity: '1',
    quantity_delivered: '0',
    quantity_returned: '0',
    unit_price_net: '10',
    unit_price_gross: '12.30',
    vat_rate: '23',
    discount_percent: '0',
    line_total_net: '10',
    ...over,
  };
}

function querySuccess(orders: Order[]) {
  return {
    data: { count: orders.length, next: null, previous: null, results: orders },
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderOrders(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/orders',
        element: (
          <TestQueryProvider>
            <OrdersPage />
          </TestQueryProvider>
        ),
      },
      { path: '/login', element: <div>Logowanie</div> },
      { path: '/orders/new', element: <div>New order</div> },
      { path: '/orders/:id', element: <div>Order detail</div> },
      { path: '/delivery', element: <div>Delivery list</div> },
      { path: '/delivery/van-loading', element: <div>Van loading</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}

describe('OrdersPage', () => {
  const getToken = vi.spyOn(authStorage, 'getAccessToken');

  beforeEach(() => {
    vi.clearAllMocks();
    getToken.mockReturnValue('test-access-token');
    useModuleGuardMock.mockReturnValue(false);
    customersQueryFixture.results = [mockCustomer('ord-1', 'Jan Kowalski')];
    customersQueryFixture.isPending = false;
    customersQueryFixture.isError = false;
    customersQueryFixture.error = null;
    useOrdersByDateQueryMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    generateWzMock.mutateAsync.mockReset();
    generateWzMock.mutateAsync.mockResolvedValue({ id: 'wz-1' });
    generateWzMock.isPending = false;
  });

  afterEach(() => {
    getToken.mockReset();
    vi.useRealTimers();
  });

  it('redirects to /login when no token', () => {
    getToken.mockReturnValue(null);
    renderOrders('/orders');
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('renders OrderDayDateNav with today date by default', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T10:00:00.000Z'));
    renderOrders('/orders');
    expect(useOrdersByDateQueryMock).toHaveBeenCalledWith(todayIso());
    expect(screen.getByRole('navigation', { name: 'Nawigacja dnia dostawy' })).toBeInTheDocument();
  });

  it('reads date from ?date= URL param and passes to useOrdersByDateQuery', () => {
    renderOrders('/orders?date=2026-03-15');
    expect(useOrdersByDateQueryMock).toHaveBeenCalledWith('2026-03-15');
  });

  it('when date changes via nav, updates URL search param', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useOrdersByDateQueryMock.mockImplementation(() => querySuccess([]));
    const { router } = renderOrders('/orders?date=2026-05-10');
    await user.click(screen.getByRole('button', { name: 'Następny dzień' }));
    await waitFor(() => {
      expect(router.state.location.search).toContain('date=2026-05-11');
    });
  });

  it('renders one OrderShopCard per order', () => {
    customersQueryFixture.results = [mockCustomer('a', 'Sklep A'), mockCustomer('b', 'Sklep B')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'a', customer_name: 'Sklep A' }),
        makeOrder({ id: 'b', customer_name: 'Sklep B' }),
      ]),
    );
    renderOrders('/orders');
    expect(screen.getByRole('button', { name: /Sklep A, zamówienie/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sklep B, zamówienie/i })).toBeInTheDocument();
  });

  it('shows empty copy when there are no orders (shops)', () => {
    customersQueryFixture.results = [];
    useOrdersByDateQueryMock.mockReturnValue(querySuccess([]));
    renderOrders('/orders');
    expect(screen.getByText('Brak aktywnych sklepów.')).toBeInTheDocument();
  });

  it('shows loading state while isFetching', () => {
    useOrdersByDateQueryMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderOrders('/orders');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('shows error state and retry button', () => {

    customersQueryFixture.isError = true;
    customersQueryFixture.error = new Error('fail');
    customersQueryFixture.results = [];
    useOrdersByDateQueryMock.mockReturnValue(querySuccess([]));
    renderOrders('/orders');
    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się załadować listy sklepów');
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument();
  });

  it('bottom bar shows distinct product count and total gross', () => {
    customersQueryFixture.results = [mockCustomer('o1', 'A'), mockCustomer('o2', 'B')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({
          id: 'o1',
          customer_name: 'A',
          total_gross: '100.00',
          items: [
            makeOrderLine({
              id: 'i1',
              product_id: 'p1',
              product_name: 'Produkt A',
              line_total_gross: '100',
            }),
          ],
        }),
        makeOrder({
          id: 'o2',
          customer_name: 'B',
          total_gross: '50.5',
          items: [
            makeOrderLine({
              id: 'i2',
              product_id: 'p2',
              product_name: 'Produkt B',
              line_total_gross: '50.50',
            }),
          ],
        }),
      ]),
    );
    renderOrders('/orders');
    expect(screen.getByRole('button', { name: /Podsumowanie, 2 produkty/i })).toBeInTheDocument();
    expect(screen.getByText('Suma pozycji').closest('div')?.textContent).toMatch(/150[,.]50/);
  });

  it('does not render Załaduj Van when delivery module disabled', () => {
    useModuleGuardMock.mockReturnValue(false);
    useOrdersByDateQueryMock.mockReturnValue(querySuccess([makeOrder()]));
    renderOrders('/orders');
    expect(screen.queryByRole('button', { name: 'Załaduj Van' })).not.toBeInTheDocument();
  });

  it('renders Załaduj Van and navigates to van loading when delivery enabled', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    useOrdersByDateQueryMock.mockReturnValue(querySuccess([makeOrder()]));
    const user = userEvent.setup();
    const { router } = renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Załaduj Van' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/delivery/van-loading');
    });
    expect(screen.getByText('Van loading')).toBeInTheDocument();
  });

  it('does not render Generuj WZ when delivery module disabled', () => {
    useModuleGuardMock.mockReturnValue(false);
    useOrdersByDateQueryMock.mockReturnValue(querySuccess([makeOrder()]));
    renderOrders('/orders');
    expect(screen.queryByRole('button', { name: 'Generuj WZ' })).not.toBeInTheDocument();
  });

  it('Nowe zamówienie navigates with current date query param', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-02-20T12:00:00.000Z'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useOrdersByDateQueryMock.mockImplementation(() => querySuccess([]));
    const { router } = renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: /Nowe zamówienie/i }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orders/new');
      expect(router.state.location.search).toContain('date=');
      expect(decodeURIComponent(router.state.location.search)).toContain(todayIso());
    });
  });

  it('initial render: wzMode off, no checkboxes visible', () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('a', 'Sklep A'), mockCustomer('b', 'Sklep B')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'a', customer_name: 'Sklep A' }),
        makeOrder({ id: 'b', customer_name: 'Sklep B', status: 'draft' }),
      ]),
    );
    renderOrders('/orders');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('clicking "Generuj WZ" enters wzMode, pre-selects all confirmed orders', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [
      mockCustomer('c1', 'Confirmed 1'),
      mockCustomer('c2', 'Confirmed 2'),
      mockCustomer('d1', 'Draft 1'),
    ];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'c1', customer_name: 'Confirmed 1' }),
        makeOrder({ id: 'c2', customer_name: 'Confirmed 2' }),
        makeOrder({ id: 'd1', customer_name: 'Draft 1', status: 'draft' }),
      ]),
    );
    const user = userEvent.setup();
    renderOrders('/orders');

    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    const checked = boxes.filter((el) => (el as HTMLInputElement).checked);
    expect(checked).toHaveLength(2);
    expect(
      screen.getByRole('checkbox', {
        name: /Zaznacz zamówienie ZAM\/2026\/c1/i,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: /Zaznacz zamówienie ZAM\/2026\/c2/i,
      }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Utwórz WZ (2)' })).toBeInTheDocument();
  });

  it("only confirmed orders' checkboxes are enabled (draft orders' checkboxes are disabled)", async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('ok', 'OK Shop'), mockCustomer('dr', 'Draft Shop')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'ok', customer_name: 'OK Shop' }),
        makeOrder({ id: 'dr', customer_name: 'Draft Shop', status: 'draft' }),
      ]),
    );
    const user = userEvent.setup();
    renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));

    expect(screen.getByRole('checkbox', { name: /Zaznacz zamówienie ZAM\/2026\/ok/i })).not.toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: /ZAM\/2026\/dr/i })).not.toBeInTheDocument();
  });

  it('deselecting all confirmed orders disables "Utwórz WZ" button', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('x', 'X'), mockCustomer('y', 'Y')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'x', customer_name: 'X' }),
        makeOrder({ id: 'y', customer_name: 'Y' }),
      ]),
    );
    const user = userEvent.setup();
    renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));

    await user.click(screen.getByRole('checkbox', { name: /Zaznacz zamówienie ZAM\/2026\/x/i }));
    await user.click(screen.getByRole('checkbox', { name: /Zaznacz zamówienie ZAM\/2026\/y/i }));

    expect(screen.getByRole('button', { name: 'Utwórz WZ (0)' })).toBeDisabled();
  });

  it('"Anuluj" resets selection mode and clears selections', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('z', 'Zeta')];
    useOrdersByDateQueryMock.mockReturnValue(querySuccess([makeOrder({ id: 'z', customer_name: 'Zeta' })]));
    const user = userEvent.setup();
    renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));
    expect(screen.getByRole('checkbox', { name: /Zaznacz zamówienie ZAM\/2026\/z/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Anuluj' }));

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generuj WZ' })).toBeInTheDocument();
  });

  it('confirming selection calls generate WZ for each selected ID in order', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('ord-first', 'First'), mockCustomer('ord-second', 'Second')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'ord-first', customer_name: 'First' }),
        makeOrder({ id: 'ord-second', customer_name: 'Second' }),
      ]),
    );
    const calls: string[] = [];
    generateWzMock.mutateAsync.mockImplementation(async (id: string) => {
      calls.push(id);
      return { id: `wz-${id}` };
    });

    const user = userEvent.setup();
    renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));
    await user.click(screen.getByRole('checkbox', { name: /Zaznacz zamówienie ZAM\/2026\/ord-second/i }));
    await user.click(screen.getByRole('button', { name: 'Utwórz WZ (1)' }));

    await waitFor(() => {
      expect(calls).toEqual(['ord-first']);
    });
    expect(generateWzMock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('after all WZ generated, navigates to /delivery', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('oa', 'A'), mockCustomer('ob', 'B')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'oa', customer_name: 'A' }),
        makeOrder({ id: 'ob', customer_name: 'B' }),
      ]),
    );
    generateWzMock.mutateAsync.mockResolvedValue({ id: 'wz-1' });
    const user = userEvent.setup();
    const { router } = renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));
    await user.click(screen.getByRole('button', { name: 'Utwórz WZ (2)' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/delivery');
    });
    expect(generateWzMock.mutateAsync).toHaveBeenCalledTimes(2);
    expect(generateWzMock.mutateAsync).toHaveBeenNthCalledWith(1, 'oa');
    expect(generateWzMock.mutateAsync).toHaveBeenNthCalledWith(2, 'ob');
    expect(screen.getByText('Delivery list')).toBeInTheDocument();
  });

  it('if one WZ fails after a success, shows partial error banner and stays on /orders', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('fail-a', 'Shop A'), mockCustomer('fail-b', 'Shop B')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'fail-a', customer_name: 'Shop A' }),
        makeOrder({ id: 'fail-b', customer_name: 'Shop B' }),
      ]),
    );
    generateWzMock.mutateAsync.mockImplementation(async (id: string) => {
      if (id === 'fail-b') throw new Error('boom');
      return { id: 'wz-ok' };
    });

    const user = userEvent.setup();
    const { router } = renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));
    await user.click(screen.getByRole('button', { name: 'Utwórz WZ (2)' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Wygenerowano 1 z 2/);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/boom/);
    expect(router.state.location.pathname).toBe('/orders');
    expect(generateWzMock.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it('if all WZ generation fails, shows error without navigating', async () => {
    useModuleGuardMock.mockImplementation((m: string) => m === 'delivery');
    customersQueryFixture.results = [mockCustomer('fail-a', 'Shop A'), mockCustomer('fail-b', 'Shop B')];
    useOrdersByDateQueryMock.mockReturnValue(
      querySuccess([
        makeOrder({ id: 'fail-a', customer_name: 'Shop A' }),
        makeOrder({ id: 'fail-b', customer_name: 'Shop B' }),
      ]),
    );
    generateWzMock.mutateAsync.mockRejectedValue(new Error('boom'));

    const user = userEvent.setup();
    const { router } = renderOrders('/orders');
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));
    await user.click(screen.getByRole('button', { name: 'Utwórz WZ (2)' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('boom');
    });
    expect(router.state.location.pathname).toBe('/orders');
    expect(generateWzMock.mutateAsync).toHaveBeenCalledTimes(2);
  });
});

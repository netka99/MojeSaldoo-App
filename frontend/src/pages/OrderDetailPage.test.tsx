/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { OrderDetailPage } from './OrderDetailPage';
import { authStorage } from '@/services/api';
import type { Order } from '@/types';

const useOrderQueryMock = vi.hoisted(() => vi.fn());
const confirmAsync = vi.hoisted(() => vi.fn().mockResolvedValue({} as Order));
const cancelAsync = vi.hoisted(() => vi.fn().mockResolvedValue({} as Order));

vi.mock('@/query/use-orders', () => ({
  useOrderQuery: (id: string | undefined, en?: boolean) => useOrderQueryMock(id, en),
  useConfirmOrderMutation: () => ({ mutateAsync: confirmAsync, isPending: false, isError: false }),
  useCancelOrderMutation: () => ({ mutateAsync: cancelAsync, isPending: false, isError: false }),
}));

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-x',
    customer_id: 'c-1',
    customer_name: 'Jan',
    company: 'co-1',
    user: 1,
    order_number: 'ZAM/9',
    order_date: '2026-02-01',
    delivery_date: '2026-02-10',
    status: 'draft',
    subtotal_net: '100.00',
    subtotal_gross: '123.00',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '100.00',
    total_gross: '123.00',
    customer_notes: 'Uwaga',
    internal_notes: 'Int',
    created_at: '2026-02-01T08:00:00.000Z',
    updated_at: '2026-02-01T08:00:00.000Z',
    confirmed_at: null,
    delivered_at: null,
    items: [
      {
        id: 'li-1',
        product_id: 'p-1',
        product_name: 'Mąka',
        product_unit: 'kg',
        quantity: '2',
        quantity_delivered: '0',
        quantity_returned: '0',
        unit_price_net: '10.00',
        unit_price_gross: '12.30',
        vat_rate: '23.00',
        discount_percent: '0.00',
        line_total_net: '20.00',
        line_total_gross: '24.60',
      },
    ],
    ...over,
  };
}

const getToken = vi.spyOn(authStorage, 'getAccessToken');

function renderWithRoute(order: Order) {
  useOrderQueryMock.mockReturnValue({
    data: order,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  });
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/orders/ord-x']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('OrderDetailPage', () => {
  beforeEach(() => {
    getToken.mockReturnValue('t');
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    getToken.mockReset();
  });

  it('redirects to login when unauthenticated', async () => {
    getToken.mockReturnValue(null);
    useOrderQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    render(
      <TestQueryProvider>
        <MemoryRouter initialEntries={['/orders/ord-x']}>
          <Routes>
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/login" element={<div>Logowanie</div>} />
          </Routes>
        </MemoryRouter>
      </TestQueryProvider>,
    );
    expect(await screen.findByText('Logowanie')).toBeInTheDocument();
  });

  it('shows order header, items, and history for draft', () => {
    renderWithRoute(makeOrder());
    expect(screen.getByRole('heading', { name: /Zamówienie ZAM\/9/ })).toBeInTheDocument();
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Mąka')).toBeInTheDocument();
    expect(screen.getByText('Utworzono')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Potwierdź' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
  });

  it('WZ button is disabled (future feature)', () => {
    renderWithRoute(makeOrder());
    const wz = screen.getByRole('button', { name: 'Utwórz WZ' });
    expect(wz).toBeDisabled();
  });

  it('does not show Potwierdź when status is confirmed', () => {
    renderWithRoute(makeOrder({ status: 'confirmed', confirmed_at: '2026-02-01T10:00:00.000Z' }));
    expect(screen.queryByRole('button', { name: 'Potwierdź' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
  });

  it('hides Anuluj when not cancellable', () => {
    renderWithRoute(makeOrder({ status: 'delivered', delivered_at: '2026-02-10T10:00:00.000Z' }));
    expect(screen.queryByRole('button', { name: 'Anuluj' })).toBeNull();
  });

  it('confirm calls API', async () => {
    const user = userEvent.setup();
    renderWithRoute(makeOrder());
    await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => {
      expect(confirmAsync).toHaveBeenCalledWith('ord-x');
    });
  });

  it('cancel calls API when confirmed in dialog', async () => {
    const user = userEvent.setup();
    const c = window.confirm;
    window.confirm = vi.fn(() => true);
    renderWithRoute(makeOrder());
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(cancelAsync).toHaveBeenCalledWith('ord-x');
    });
    window.confirm = c;
  });
});

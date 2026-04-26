/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import {
  DeliveryDocumentsPage,
  buildDeliveryListFilters,
  deliveryStatusBadgeClassName,
} from './DeliveryDocumentsPage';
import { authStorage } from '@/services/api';
import type { DeliveryListFilters } from '@/query/use-delivery';
import type { DeliveryDocument } from '@/types';
import type { Order } from '@/types';

const useDeliveryListQueryMock = vi.hoisted(() =>
  vi.fn(((_page: number, _filters: DeliveryListFilters) => ({
    data: {
      count: 0,
      next: null,
      previous: null,
      results: [] as DeliveryDocument[],
    },
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })) as (page: number, filters: DeliveryListFilters) => {
    data: { count: number; next: null; previous: null; results: DeliveryDocument[] };
    isFetching: boolean;
    isError: boolean;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  }),
);

const useOrderListQueryMock = vi.hoisted(() =>
  vi.fn(((_page: number, _filters: Record<string, unknown>) => ({
    data: {
      count: 0,
      next: null,
      previous: null,
      results: [] as Order[],
    },
    isFetching: false,
  })) as (page: number, filters: Record<string, unknown>) => {
    data: { count: number; next: null; previous: null; results: Order[] };
    isFetching: boolean;
  }),
);

const generateMutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/query/use-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-delivery')>();
  return {
    ...actual,
    useDeliveryListQuery: (page: number, filters: DeliveryListFilters) =>
      useDeliveryListQueryMock(page, filters),
    useGenerateDeliveryForOrderMutation: () => ({
      mutate: generateMutateMock,
      isPending: false,
    }),
  };
});

vi.mock('@/query/use-orders', () => ({
  useOrderListQuery: (page: number, filters: Record<string, unknown>) =>
    useOrderListQueryMock(page, filters),
}));

function makeDeliveryDoc(over: Partial<DeliveryDocument> = {}): DeliveryDocument {
  return {
    id: 'doc-1',
    company: 'co-1',
    order_id: 'ord-1',
    order_number: 'ZAM/2026/0001',
    customer_name: 'Jan Kowalski',
    user: null,
    document_type: 'WZ',
    document_number: 'WZ/2026/0001',
    issue_date: '2026-05-01',
    from_warehouse_id: null,
    to_warehouse_id: null,
    to_customer_id: null,
    status: 'saved',
    has_returns: false,
    returns_notes: '',
    driver_name: 'Adam K.',
    receiver_name: '',
    delivered_at: null,
    notes: '',
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    items: [],
    ...over,
  };
}

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-pick',
    customer_id: 'c-1',
    customer_name: 'Klient SP',
    company: 'co-1',
    user: null,
    order_number: 'ZAM/2026/0099',
    order_date: '2026-05-01',
    delivery_date: '2026-05-10',
    status: 'confirmed',
    subtotal_net: '10',
    subtotal_gross: '12',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '10',
    total_gross: '12',
    customer_notes: '',
    internal_notes: '',
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    confirmed_at: '2026-05-01T10:00:00Z',
    delivered_at: null,
    items: [],
    ...over,
  };
}

function renderDeliveryRoute() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/delivery']}>
        <Routes>
          <Route path="/delivery" element={<DeliveryDocumentsPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
          <Route path="/orders/:id" element={<div>Order</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('buildDeliveryListFilters + deliveryStatusBadgeClassName', () => {
  it('always scopes to WZ and passes optional status / issue date range', () => {
    expect(buildDeliveryListFilters('', '', '')).toEqual({ document_type: 'WZ' });
    expect(buildDeliveryListFilters('saved', '2026-04-01', '2026-04-30')).toEqual({
      document_type: 'WZ',
      status: 'saved',
      issue_date_after: '2026-04-01',
      issue_date_before: '2026-04-30',
    });
  });

  it('uses badge colors for key delivery statuses', () => {
    expect(deliveryStatusBadgeClassName('draft')).toContain('gray');
    expect(deliveryStatusBadgeClassName('saved')).toContain('blue');
    expect(deliveryStatusBadgeClassName('in_transit')).toContain('amber');
    expect(deliveryStatusBadgeClassName('delivered')).toContain('green');
    expect(deliveryStatusBadgeClassName('cancelled')).toContain('red');
  });
});

describe('DeliveryDocumentsPage', () => {
  const getToken = vi.spyOn(authStorage, 'getAccessToken');

  beforeEach(() => {
    getToken.mockReturnValue('test-access-token');
    generateMutateMock.mockReset();
    useDeliveryListQueryMock.mockReset();
    useDeliveryListQueryMock.mockImplementation((_page, _filters) => ({
      data: { count: 0, next: null, previous: null, results: [] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }));
    useOrderListQueryMock.mockReset();
    useOrderListQueryMock.mockImplementation(() => ({
      data: { count: 0, next: null, previous: null, results: [] },
      isFetching: false,
    }));
  });

  afterEach(() => {
    getToken.mockReset();
  });

  it('redirects to login when there is no access token', () => {
    getToken.mockReturnValue(null);
    renderDeliveryRoute();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('renders title, WZ table headers, and Generuj WZ control', () => {
    renderDeliveryRoute();
    expect(screen.getByRole('heading', { name: 'Dokumenty WZ' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Lista dokumentów WZ' });
    expect(within(table).getByRole('columnheader', { name: 'Numer WZ' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Data wyst.' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Klient' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Kierowca' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generuj WZ' })).toBeInTheDocument();
  });

  it('shows a row with document number, client, driver, and status label', () => {
    const d = makeDeliveryDoc();
    useDeliveryListQueryMock.mockReturnValue({
      data: { count: 1, next: null, previous: null, results: [d] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    const table = screen.getByRole('table', { name: 'Lista dokumentów WZ' });
    const wzLink = within(table).getByRole('link', { name: 'WZ/2026/0001' });
    expect(wzLink).toHaveAttribute('href', '/delivery/doc-1');
    expect(within(table).getByText('Jan Kowalski')).toBeInTheDocument();
    expect(within(table).getByText('Adam K.')).toBeInTheDocument();
    expect(within(table).getByText('Zapisano')).toBeInTheDocument();
  });

  it('applies status filter with WZ scope to the delivery list query', async () => {
    const user = userEvent.setup();
    renderDeliveryRoute();
    const select = screen.getByLabelText('Filtruj dokumenty po statusie');
    await user.selectOptions(select, 'delivered');
    const last = useDeliveryListQueryMock.mock.calls.at(-1);
    expect(last?.[0]).toBe(1);
    expect(last?.[1]).toMatchObject({
      document_type: 'WZ',
      status: 'delivered',
    });
  });

  it('sends issue date range in delivery list query params', async () => {
    const user = userEvent.setup();
    renderDeliveryRoute();
    await user.clear(screen.getByLabelText('Data wystawienia od'));
    await user.type(screen.getByLabelText('Data wystawienia od'), '2026-06-01');
    await user.clear(screen.getByLabelText('Data wystawienia do'));
    await user.type(screen.getByLabelText('Data wystawienia do'), '2026-06-15');
    const last = useDeliveryListQueryMock.mock.calls.at(-1);
    expect(last?.[1]).toMatchObject({
      document_type: 'WZ',
      issue_date_after: '2026-06-01',
      issue_date_before: '2026-06-15',
    });
  });

  it('loads confirmed orders for the picker and calls generate mutate with selected id', async () => {
    const user = userEvent.setup();
    const o = makeOrder();
    useOrderListQueryMock.mockImplementation((_page, _filters) => ({
      data: { count: 1, next: null, previous: null, results: [o] },
      isFetching: false,
    }));
    renderDeliveryRoute();
    await waitFor(() => {
      expect(useOrderListQueryMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'confirmed' }),
      );
    });
    const select = screen.getByLabelText('Zamówienie');
    await user.selectOptions(select, o.id);
    await user.click(screen.getByRole('button', { name: 'Generuj WZ' }));
    expect(generateMutateMock).toHaveBeenCalled();
    expect(generateMutateMock.mock.calls[0][0]).toBe(o.id);
  });

  it('debounces order search before updating the orders query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeliveryRoute();
    const input = screen.getByLabelText('Szukaj zamówienia');
    const callsAtStart = useOrderListQueryMock.mock.calls.length;
    await user.type(input, 'acme');
    const withSearchBefore = useOrderListQueryMock.mock.calls
      .slice(callsAtStart)
      .filter((c) => (c[1] as { search?: string }).search === 'acme');
    expect(withSearchBefore.length).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    const withSearchAfter = useOrderListQueryMock.mock.calls
      .slice(callsAtStart)
      .filter((c) => (c[1] as { search?: string }).search === 'acme');
    expect(withSearchAfter.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});

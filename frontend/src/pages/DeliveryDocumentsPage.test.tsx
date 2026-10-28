/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import {
  DeliveryDocumentsPage,
  buildDeliveryListFilters,
  deliveryStatusBadgeClassName,
  deliveryStatusLabel,
} from './DeliveryDocumentsPage';
import { authStorage } from '@/services/api';
import type { DeliveryDocument, DeliveryItem } from '@/types';

const useDeliveryByRangeQueryMock = vi.hoisted(() =>
  vi.fn(((_dateFrom: string, _dateTo: string) => ({
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
  })) as (dateFrom: string, dateTo: string) => {
    data: { count: number; next: null; previous: null; results: DeliveryDocument[] };
    isFetching: boolean;
    isError: boolean;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  }),
);

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      current_company: 'co-1',
      is_company_admin: true,
      permissions: { can_manage_delivery: true },
    },
  }),
}));

vi.mock('@/query/use-companies', () => ({
  useMyCompaniesQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/query/use-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/query/use-delivery')>();
  return {
    ...actual,
    useDeliveryByRangeQuery: (dateFrom: string, dateTo: string) =>
      useDeliveryByRangeQueryMock(dateFrom, dateTo),
  };
});

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


function makeItem(over: Partial<DeliveryItem> = {}): DeliveryItem {
  return {
    id: 'item-1',
    order_item_id: null,
    product_id: 'prod-1',
    product_name: 'Bagietka',
    product_unit: 'szt.',
    quantity_planned: '3',
    quantity_actual: null,
    quantity_returned: '0',
    return_reason: '',
    is_damaged: false,
    notes: '',
    created_at: '2026-05-01T10:00:00Z',
    ...over,
  };
}

function renderDeliveryRoute() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/delivery']}>
        <Routes>
          <Route path="/delivery" element={<DeliveryDocumentsPage />} />
          <Route path="/delivery/:id" element={<div>Delivery detail</div>} />
          <Route path="/login" element={<div>Logowanie</div>} />
          <Route path="/orders/:id" element={<div>Order</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('buildDeliveryListFilters + deliveryStatusBadgeClassName', () => {
  it('builds filters with optional document type, status and date range', () => {
    expect(buildDeliveryListFilters('', '', '')).toEqual({});
    expect(buildDeliveryListFilters('', '', '', 'WZ')).toEqual({ document_type: 'WZ' });
    expect(buildDeliveryListFilters('saved', '2026-04-01', '2026-04-30', 'WZ')).toEqual({
      document_type: 'WZ',
      status: 'saved',
      issue_date_after: '2026-04-01',
      issue_date_before: '2026-04-30',
    });
    expect(buildDeliveryListFilters('', '', '', 'ZW')).toEqual({ document_type: 'ZW' });
  });

  it('uses badge colors for key delivery statuses', () => {
    expect(deliveryStatusBadgeClassName('draft')).toContain('surface-container');
    expect(deliveryStatusBadgeClassName('saved')).toContain('blue');
    expect(deliveryStatusBadgeClassName('in_transit')).toContain('amber');
    expect(deliveryStatusBadgeClassName('delivered')).toContain('green');
    expect(deliveryStatusBadgeClassName('cancelled')).toContain('red');
    expect(deliveryStatusBadgeClassName('corrected')).toContain('purple');
    // WZ-KOR/PZ-KOR with delivered status get purple (Skorygowano) badge
    expect(deliveryStatusBadgeClassName('delivered', 'WZ-KOR')).toContain('purple');
    expect(deliveryStatusBadgeClassName('delivered', 'PZ-KOR')).toContain('purple');
  });

  it('deliveryStatusLabel shows "Zrealizowano" for WZ-KOR/PZ-KOR with delivered status', () => {
    expect(deliveryStatusLabel('delivered', 'WZ-KOR')).toBe('Skorygowano');
    expect(deliveryStatusLabel('delivered', 'PZ-KOR')).toBe('Skorygowano');
    expect(deliveryStatusLabel('delivered', 'WZ')).toBe('Dostarczono');
    expect(deliveryStatusLabel('corrected', 'WZ')).toBe('Skorygowano');
    expect(deliveryStatusLabel('cancelled', 'WZ-KOR')).toBe('Anulowano');
  });
});

describe('DeliveryDocumentsPage', () => {
  const getToken = vi.spyOn(authStorage, 'getAccessToken');

  beforeEach(() => {
    getToken.mockReturnValue('test-access-token');
    useDeliveryByRangeQueryMock.mockReset();
    useDeliveryByRangeQueryMock.mockImplementation((_dateFrom, _dateTo) => ({
      data: { count: 0, next: null, previous: null, results: [] },
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
    renderDeliveryRoute();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('renders title and document list table headers', async () => {
    const user = userEvent.setup();
    renderDeliveryRoute();
    // Default view is "Wg sklepu" — switch to Lista to see the table
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('heading', { name: 'Dokumenty' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    expect(within(table).getByRole('columnheader', { name: 'Numer dokumentu' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Data wyst.' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Klient' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Kierowca' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('shows a row with document number, client, driver, and status label in Lista tab', async () => {
    const user = userEvent.setup();
    const d = makeDeliveryDoc();
    useDeliveryByRangeQueryMock.mockReturnValue({
      data: { count: 1, next: null, previous: null, results: [d] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    const wzLink = within(table).getByRole('link', { name: 'WZ/2026/0001' });
    expect(wzLink).toHaveAttribute('href', '/delivery/doc-1');
    expect(within(table).getByText('Jan Kowalski')).toBeInTheDocument();
    expect(within(table).getByText('Adam K.')).toBeInTheDocument();
    expect(within(table).getByText('Zapisano')).toBeInTheDocument();
  });

  it('filters Lista client-side by status', async () => {
    const user = userEvent.setup();
    const delivered = makeDeliveryDoc({ id: 'doc-delivered', document_number: 'WZ/2026/0001', status: 'delivered' });
    const draft = makeDeliveryDoc({ id: 'doc-draft', document_number: 'WZ/2026/0002', status: 'draft' });
    useDeliveryByRangeQueryMock.mockReturnValue({
      data: { count: 2, next: null, previous: null, results: [delivered, draft] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    await user.click(within(table).getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('checkbox', { name: 'Dostarczono' }));
    expect(within(table).getByRole('link', { name: 'WZ/2026/0001' })).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: 'WZ/2026/0002' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Szkic' }));
    expect(within(table).getByRole('link', { name: 'WZ/2026/0001' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'WZ/2026/0002' })).toBeInTheDocument();
  });

  it('filters Lista by a checked client or by typed text', async () => {
    const user = userEvent.setup();
    const aroma = makeDeliveryDoc({ id: 'doc-aroma', document_number: 'WZ/2026/0014', customer_name: 'Cafe Aroma' });
    const hotel = makeDeliveryDoc({ id: 'doc-hotel', document_number: 'WZ/2026/0013', customer_name: 'Hotel Grand' });
    useDeliveryByRangeQueryMock.mockReturnValue({
      data: { count: 2, next: null, previous: null, results: [aroma, hotel] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    await user.click(within(table).getByRole('button', { name: 'Klient' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cafe Aroma' }));
    expect(within(table).getByRole('link', { name: 'WZ/2026/0014' })).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: 'WZ/2026/0013' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Cafe Aroma' }));
    await user.type(screen.getByRole('searchbox', { name: 'Szukaj w kolumnie Klient' }), 'hotel');
    expect(within(table).queryByRole('link', { name: 'WZ/2026/0014' })).not.toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'WZ/2026/0013' })).toBeInTheDocument();
  });

  it('shows the product name beside its quantity in the expanded row', async () => {
    const user = userEvent.setup();
    const doc = makeDeliveryDoc({
      items: [
        makeItem(),
        makeItem({ id: 'item-2', product_id: 'prod-2', product_name: 'Rogal', quantity_planned: '4' }),
      ],
    });
    useDeliveryByRangeQueryMock.mockReturnValue({
      data: { count: 1, next: null, previous: null, results: [doc] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    await user.click(within(table).getByRole('button', { name: 'Rozwiń pozycje' }));
    const bagietka = within(table).getByText('Bagietka').closest('tr');
    expect(bagietka).toHaveTextContent('3 szt.');
    const rogal = within(table).getByText('Rogal').closest('tr');
    expect(rogal).toHaveTextContent('4 szt.');
    const numberCell = within(table).getByRole('link', { name: 'WZ/2026/0001' }).closest('td');
    const nameCell = within(table).getByText('Bagietka').closest('td');
    expect(nameCell?.cellIndex).toBe(numberCell?.cellIndex);
  });

  it('updates the range query when custom dates are typed', async () => {
    const user = userEvent.setup();
    renderDeliveryRoute();
    await user.clear(screen.getByLabelText('Data wystawienia od'));
    await user.type(screen.getByLabelText('Data wystawienia od'), '2026-06-01');
    await user.clear(screen.getByLabelText('Data wystawienia do'));
    await user.type(screen.getByLabelText('Data wystawienia do'), '2026-06-15');
    const last = useDeliveryByRangeQueryMock.mock.calls.at(-1);
    expect(last?.[0]).toBe('2026-06-01');
    expect(last?.[1]).toBe('2026-06-15');
  });

  it('shows "Koryguje: WZ/..." annotation under WZ-KOR row in Lista tab', async () => {
    const user = userEvent.setup();
    const wzKor = makeDeliveryDoc({
      id: 'kor-1',
      document_type: 'WZ-KOR',
      document_number: 'WZ-KOR/2026/0001',
      status: 'delivered',
      corrects_wz_id: 'wz-orig-1',
      corrects_wz_number: 'WZ/2026/0004',
    });
    useDeliveryByRangeQueryMock.mockReturnValue({
      data: { count: 1, next: null, previous: null, results: [wzKor] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    expect(within(table).getByRole('link', { name: 'WZ/2026/0004' })).toHaveAttribute('href', '/delivery/wz-orig-1');
    expect(within(table).getByText(/Koryguje:/)).toBeInTheDocument();
    // WZ-KOR with "delivered" status should show "Skorygowano", not "Dostarczono"
    expect(within(table).getByText('Skorygowano')).toBeInTheDocument();
    expect(within(table).queryByText('Dostarczono')).not.toBeInTheDocument();
  });

  it('shows "Korekta: WZ-KOR/..." annotation under WZ row that has corrections', async () => {
    const user = userEvent.setup();
    const wz = makeDeliveryDoc({
      id: 'wz-1',
      document_type: 'WZ',
      document_number: 'WZ/2026/0004',
      status: 'corrected',
      corrections: [{ id: 'kor-uuid-1', document_number: 'WZ-KOR/2026/0001', issue_date: '2026-06-01' }],
    });
    useDeliveryByRangeQueryMock.mockReturnValue({
      data: { count: 1, next: null, previous: null, results: [wz] },
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDeliveryRoute();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table', { name: 'Lista dokumentów' });
    expect(within(table).getByRole('link', { name: 'WZ-KOR/2026/0001' })).toHaveAttribute('href', '/delivery/kor-uuid-1');
    expect(within(table).getByText(/Korekta:/)).toBeInTheDocument();
    // Also verify the corrected status badge is shown
    expect(within(table).getByText('Skorygowano')).toBeInTheDocument();
  });

});

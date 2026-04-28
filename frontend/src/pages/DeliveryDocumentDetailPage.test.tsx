/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { DeliveryDocumentDetailPage, productLabelForDeliveryLine } from './DeliveryDocumentDetailPage';
import { authStorage } from '@/services/api';
import type { DeliveryDocument, DeliveryDocumentPreviewPayload } from '@/types';
import type { Order } from '@/types';

describe('productLabelForDeliveryLine', () => {
  it('uses order line product_name when found', () => {
    const order = {
      items: [{ id: 'oi-1', product_name: 'Mleko 1L' }],
    } as Order;
    expect(productLabelForDeliveryLine(order, { order_item_id: 'oi-1', product_id: 'p-1' })).toBe('Mleko 1L');
  });

  it('prefers API product_name when order_item_id is null (MM lines)', () => {
    expect(
      productLabelForDeliveryLine(undefined, {
        order_item_id: null,
        product_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        product_name: 'Woda 0.5L',
      }),
    ).toBe('Woda 0.5L');
  });

  it('falls back to short product_id when order line missing', () => {
    expect(
      productLabelForDeliveryLine(undefined, {
        order_item_id: null,
        product_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    ).toBe('Produkt aaaaaaaa…');
  });

  it('falls back to short order_item_id when no product_id', () => {
    expect(
      productLabelForDeliveryLine(undefined, {
        order_item_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        product_id: 'p-1',
      }),
    ).toBe('aaaaaaaa');
  });
});

const useDeliveryQueryMock = vi.hoisted(() => vi.fn());
const useDeliveryPreviewQueryMock = vi.hoisted(() => vi.fn());
const useOrderQueryMock = vi.hoisted(() => vi.fn());
const saveMutateAsync = vi.hoisted(() => vi.fn());
const startMutateAsync = vi.hoisted(() => vi.fn());
const completeMutateAsync = vi.hoisted(() => vi.fn());
const patchMutateAsync = vi.hoisted(() => vi.fn());
const updateLinesMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/query/use-delivery', () => ({
  useDeliveryQuery: (id: string | undefined, enabled?: boolean) => useDeliveryQueryMock(id, enabled),
  useDeliveryPreviewQuery: (id: string | undefined, enabled?: boolean) =>
    useDeliveryPreviewQueryMock(id, enabled),
  useSaveDeliveryMutation: () => ({ mutateAsync: saveMutateAsync, isPending: false }),
  useStartDeliveryMutation: () => ({ mutateAsync: startMutateAsync, isPending: false }),
  useCompleteDeliveryMutation: () => ({ mutateAsync: completeMutateAsync, isPending: false }),
  usePatchDeliveryMutation: () => ({ mutateAsync: patchMutateAsync, isPending: false }),
  useUpdateDeliveryLinesMutation: () => ({ mutateAsync: updateLinesMutateAsync, isPending: false }),
}));

vi.mock('@/query/use-orders', () => ({
  useOrderQuery: (id: string | undefined, enabled?: boolean) => useOrderQueryMock(id, enabled),
}));

function makeDoc(over: Partial<DeliveryDocument> = {}): DeliveryDocument {
  return {
    id: 'doc-1',
    company: 'c',
    order_id: 'ord-1',
    order_number: 'ZAM/1',
    customer_name: 'Klient',
    user: null,
    document_type: 'WZ',
    document_number: 'WZ/2026/0001',
    issue_date: '2026-06-01',
    from_warehouse_id: null,
    to_warehouse_id: null,
    to_customer_id: null,
    status: 'draft',
    has_returns: false,
    returns_notes: '',
    driver_name: '',
    receiver_name: '',
    delivered_at: null,
    notes: '',
    created_at: '',
    updated_at: '',
    items: [
      {
        id: 'li-1',
        order_item_id: 'oi-1',
        product_id: 'p-1',
        quantity_planned: '2',
        quantity_actual: null,
        quantity_returned: '0',
        return_reason: '',
        is_damaged: false,
        notes: '',
        created_at: '',
      },
    ],
    ...over,
  };
}

function makePreviewPayload(
  over: Partial<DeliveryDocumentPreviewPayload> = {},
): DeliveryDocumentPreviewPayload {
  return {
    document: {
      id: 'doc-1',
      company: 'c',
      order: 'ord-1',
      user: null,
      document_type: 'WZ',
      document_number: 'WZ/2026/0001',
      issue_date: '2026-06-01',
      from_warehouse: null,
      to_warehouse: null,
      to_customer: null,
      status: 'draft',
      has_returns: false,
      returns_notes: '',
      driver_name: '',
      receiver_name: '',
      delivered_at: null,
      notes: '',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    },
    company: { name: 'Spółka', nip: '111', address: 'ul. 1' },
    customer: { name: 'Klient', nip: '222', address: 'ul. 2' },
    from_warehouse: { name: 'M', code: 'MG' },
    items: [],
    ...over,
  };
}

function renderDetail(id = 'doc-1') {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={[`/delivery/${id}`]}>
        <Routes>
          <Route path="/delivery/:id" element={<DeliveryDocumentDetailPage />} />
          <Route path="/login" element={<div>Logowanie</div>} />
          <Route path="/delivery" element={<div>Lista</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('DeliveryDocumentDetailPage', () => {
  const getToken = vi.spyOn(authStorage, 'getAccessToken');

  beforeEach(() => {
    getToken.mockReturnValue('token');
    useOrderQueryMock.mockReturnValue({
      data: { items: [{ id: 'oi-1', product_name: 'Woda' }] } as Order,
    });
    useDeliveryPreviewQueryMock.mockReturnValue({
      data: makePreviewPayload(),
      isLoading: false,
    });
    saveMutateAsync.mockReset();
    startMutateAsync.mockReset();
    completeMutateAsync.mockReset();
    patchMutateAsync.mockReset();
    updateLinesMutateAsync.mockReset();
  });

  afterEach(() => {
    getToken.mockReset();
  });

  it('redirects to login without token', () => {
    getToken.mockReturnValue(null);
    useDeliveryQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    useDeliveryPreviewQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    renderDetail();
    expect(screen.getByText('Logowanie')).toBeInTheDocument();
  });

  it('shows Zapisz WZ for draft and calls save', async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ status: 'draft' });
    useDeliveryQueryMock.mockReturnValue({
      data: doc,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    expect(screen.getByRole('heading', { name: /WZ WZ\/2026\/0001/ })).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Zapisz WZ' });
    await user.click(btn);
    expect(saveMutateAsync).toHaveBeenCalledWith('doc-1');
  });

  it('shows Rozpocznij dostawę when saved', () => {
    useDeliveryQueryMock.mockReturnValue({
      data: makeDoc({ status: 'saved' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    expect(screen.getByRole('button', { name: 'Rozpocznij dostawę' })).toBeInTheDocument();
  });

  it('calls start delivery when Rozpocznij dostawę is clicked', async () => {
    const user = userEvent.setup();
    useDeliveryQueryMock.mockReturnValue({
      data: makeDoc({ status: 'saved' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Rozpocznij dostawę' }));
    expect(startMutateAsync).toHaveBeenCalledWith('doc-1');
  });

  it('submits complete payload with line quantities', async () => {
    const user = userEvent.setup();
    completeMutateAsync.mockResolvedValue(undefined as never);
    useDeliveryQueryMock.mockReturnValue({
      data: makeDoc({ status: 'in_transit' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Zakończ dostawę' }));
    await user.type(screen.getByLabelText('Odbiorca (podpis / osoba)'), 'Jan Nowak');
    await user.click(screen.getByRole('button', { name: 'Potwierdź zakończenie dostawy' }));
    expect(completeMutateAsync).toHaveBeenCalledTimes(1);
    const arg = completeMutateAsync.mock.calls[0][0] as {
      id: string;
      data: { items: { id: string; quantity_actual?: string; receiver_name?: string }[]; receiver_name?: string };
    };
    expect(arg.id).toBe('doc-1');
    expect(arg.data.receiver_name).toBe('Jan Nowak');
    expect(arg.data.items).toEqual([
      expect.objectContaining({
        id: 'li-1',
        quantity_actual: '2',
        quantity_returned: '0',
      }),
    ]);
  });

  it('does not show workflow buttons when delivered', () => {
    useDeliveryQueryMock.mockReturnValue({
      data: makeDoc({ status: 'delivered' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    expect(screen.queryByRole('button', { name: 'Zapisz WZ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rozpocznij dostawę' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zakończ dostawę' })).not.toBeInTheDocument();
  });

  it('shows invoice lock banner and disables editing when linked to invoice', () => {
    useDeliveryQueryMock.mockReturnValue({
      data: makeDoc({
        status: 'draft',
        locked_for_edit: true,
        linked_invoices: [{ id: 'inv-1', invoice_number: 'FV/2026/0001' }],
      }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    expect(screen.getByText(/Dokument powiązany z fakturą/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Faktura FV\/2026\/0001/ });
    expect(link).toHaveAttribute('href', '/invoices/inv-1');
    expect(screen.getByRole('button', { name: 'Zapisz WZ' })).toBeDisabled();
  });

  it('shows complete form toggle when in transit', async () => {
    const user = userEvent.setup();
    useDeliveryQueryMock.mockReturnValue({
      data: makeDoc({ status: 'in_transit' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    renderDetail();
    await user.click(screen.getByRole('button', { name: 'Zakończ dostawę' }));
    expect(screen.getByRole('table', { name: /Linie WZ/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Potwierdź zakończenie dostawy' })).toBeInTheDocument();
  });
});

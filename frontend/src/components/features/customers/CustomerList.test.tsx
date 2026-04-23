/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerList } from './CustomerList';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import type { Customer } from '@/types';

const mocks = vi.hoisted(() => ({
  fetchList: vi.fn(),
}));

vi.mock('@/services/customer.service', () => ({
  customerService: {
    fetchList: mocks.fetchList,
  },
}));

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: '660e8400-e29b-41d4-a716-446655440001',
    user: 1,
    name: 'ACME',
    company_name: 'ACME SA',
    nip: '5260250274',
    email: 'a@acme.test',
    phone: null,
    street: null,
    city: 'Kraków',
    postal_code: null,
    country: 'PL',
    distance_km: null,
    delivery_days: null,
    payment_terms: 14,
    credit_limit: '0',
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

function renderList(ui: ReactElement) {
  return render(<TestQueryProvider>{ui}</TestQueryProvider>);
}

describe('CustomerList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchList.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [customer()],
    });
  });

  it('loads customers and shows heading', async () => {
    renderList(<CustomerList />);

    expect(screen.getByRole('heading', { name: /customers/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenCalledWith({
        page: 1,
        search: undefined,
        ordering: '-created_at',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });
  });

  it('renders customer row in the table', async () => {
    renderList(<CustomerList />);

    const table = await screen.findByRole('table');
    expect(await within(table).findByText('ACME')).toBeInTheDocument();
    expect(within(table).getByText('ACME SA')).toBeInTheDocument();
    expect(within(table).getByText('Kraków')).toBeInTheDocument();
    expect(within(table).getByText('5260250274')).toBeInTheDocument();
  });

  it('shows empty state when there are no results', async () => {
    mocks.fetchList.mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });

    renderList(<CustomerList />);

    expect(await screen.findByText(/no customers match this filter/i)).toBeInTheDocument();
  });

  it('shows error and retries fetch', async () => {
    mocks.fetchList.mockRejectedValueOnce(new Error('Server error')).mockResolvedValueOnce({
      count: 1,
      next: null,
      previous: null,
      results: [customer({ name: 'Recovered' })],
    });

    renderList(<CustomerList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(mocks.fetchList).toHaveBeenCalledTimes(2));

    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Recovered')).toBeInTheDocument();
  });

  it('paginates when count exceeds page size', async () => {
    mocks.fetchList
      .mockResolvedValueOnce({
        count: 40,
        next: 'http://localhost/api/customers/?page=2',
        previous: null,
        results: [customer({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'C1' })],
      })
      .mockResolvedValueOnce({
        count: 40,
        next: null,
        previous: 'http://localhost/api/customers/?page=1',
        results: [customer({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'C2' })],
      });

    renderList(<CustomerList />);

    const table1 = await screen.findByRole('table');
    expect(await within(table1).findByText('C1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenLastCalledWith({
        page: 2,
        search: undefined,
        ordering: '-created_at',
      });
    });

    const table = await screen.findByRole('table');
    expect(await within(table).findByText('C2')).toBeInTheDocument();
  });

  it('debounces search before refetching', async () => {
    const user = userEvent.setup();

    renderList(<CustomerList />);

    await waitFor(() => expect(mocks.fetchList).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/filter customers by name or nip/i), 'nip');

    await waitFor(
      () => {
        expect(mocks.fetchList).toHaveBeenLastCalledWith({
          page: 1,
          search: 'nip',
          ordering: '-created_at',
        });
      },
      { timeout: 4000 },
    );
  });

  it('invokes onDelete when Delete is clicked', async () => {
    const onDelete = vi.fn();
    renderList(<CustomerList onDelete={onDelete} />);

    const table = await screen.findByRole('table');
    await within(table).findByText('ACME');

    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    await userEvent.click(deleteButtons[0]!);

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACME' }));
  });
});

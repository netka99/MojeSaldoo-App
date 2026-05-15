/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerList } from './CustomerList';
import type { Customer } from '@/types';

vi.mock('framer-motion', () => {
  function passthrough(Tag: 'div' | 'li') {
    return function MotionMock({
      children,
      ...rest
    }: React.PropsWithChildren<Record<string, unknown>>) {
      const { variants: _v, initial: _i, animate: _a, transition: _t, ...domProps } = rest;
      return React.createElement(Tag, domProps as Record<string, unknown>, children);
    };
  }
  return {
    motion: {
      div: passthrough('div'),
      li: passthrough('li'),
    },
  };
});

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

type ListProps = React.ComponentProps<typeof CustomerList>;

function defaultProps(over: Partial<ListProps> = {}): ListProps {
  return {
    customers: [customer()],
    totalCount: 1,
    page: 1,
    onPageChange: vi.fn(),
    searchInput: '',
    onSearchInputChange: vi.fn(),
    isFetching: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...over,
  };
}

function renderList(ui: ReactElement) {
  return render(ui);
}

describe('CustomerList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary and customer row', () => {
    renderList(<CustomerList {...defaultProps()} />);

    expect(screen.getByText('Podsumowanie')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('ACME SA')).toBeInTheDocument();
    expect(screen.getByText(/NIP 5260250274/)).toBeInTheDocument();
  });

  it('shows empty state when there are no customers', () => {
    renderList(
      <CustomerList
        {...defaultProps({
          customers: [],
          totalCount: 0,
        })}
      />,
    );

    expect(screen.getByText('Brak kontrahentów.')).toBeInTheDocument();
  });

  it('shows error and retries', async () => {
    const onRetry = vi.fn();
    renderList(
      <CustomerList
        {...defaultProps({
          isError: true,
          error: new Error('Server error'),
          customers: [],
          totalCount: 0,
          onRetry,
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Server error');

    await userEvent.click(screen.getByRole('button', { name: /spróbuj ponownie/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('changes page when pagination is used', async () => {
    const onPageChange = vi.fn();
    renderList(
      <CustomerList
        {...defaultProps({
          customers: [customer({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'C1' })],
          totalCount: 40,
          page: 1,
          onPageChange,
        })}
      />,
    );

    expect(screen.getByText('C1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^następna$/i }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('invokes onRowClick when row is clicked', async () => {
    const onRowClick = vi.fn();
    renderList(<CustomerList {...defaultProps({ onRowClick })} />);

    await userEvent.click(
      screen.getByRole('button', { name: /otwórz edycję kontrahenta: acme/i }),
    );

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACME' }));
  });

  it('invokes onDelete when Usuń is clicked', async () => {
    const onDelete = vi.fn();
    renderList(<CustomerList {...defaultProps({ onDelete })} />);

    await screen.findByText('ACME');

    await userEvent.click(screen.getByRole('button', { name: /^usuń$/i }));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'ACME' }));
  });

  it('filters by pill when no row matches', async () => {
    renderList(
      <CustomerList
        {...defaultProps({
          customers: [customer({ is_active: false, name: 'Zzz inactive' })],
          totalCount: 1,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^aktywni$/i }));

    expect(screen.getByText('Brak kontrahentów dla tego filtra.')).toBeInTheDocument();
  });
});

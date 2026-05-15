/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomerEditPage } from './CustomerEditPage';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { customerService } from '@/services/customer.service';
import { authStorage } from '@/services/api';
import type { Customer } from '@/types';

vi.mock('framer-motion', () => {
  function passthrough(Tag: 'section') {
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
      section: passthrough('section'),
    },
  };
});

vi.mock('@/services/customer.service', () => ({
  customerService: {
    fetchList: vi.fn(),
    fetchById: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    partialUpdateItem: vi.fn(),
  },
}));

const CUSTOMER_ID = '660e8400-e29b-41d4-a716-446655440001';

function baseCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    user: 1,
    name: 'ACME Shop',
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

function renderEdit(initialPath = `/customers/${CUSTOMER_ID}/edit`) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TestQueryProvider>
        <Routes>
          <Route path="/login" element={<h1>Logowanie</h1>} />
          <Route path="/customers" element={<h1>Customer list</h1>} />
          <Route path="/customers/:id/edit" element={<CustomerEditPage />} />
        </Routes>
      </TestQueryProvider>
    </MemoryRouter>,
  );
}

describe('CustomerEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authStorage, 'getAccessToken').mockReturnValue('test-token');
    vi.mocked(customerService.fetchById).mockResolvedValue(baseCustomer());
    vi.mocked(customerService.updateItem).mockImplementation(async (id, body) => ({
      ...baseCustomer(),
      ...body,
      id,
      updated_at: '2025-01-02T00:00:00.000Z',
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to login when there is no access token', async () => {
    vi.spyOn(authStorage, 'getAccessToken').mockReturnValue(null);
    renderEdit();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Logowanie' })).toBeInTheDocument();
    });
  });

  it('loads customer and shows edit heading and save action', async () => {
    renderEdit();

    expect(await screen.findByRole('heading', { name: /edytuj kontrahenta/i })).toBeInTheDocument();
    expect(await screen.findByText('ACME Shop')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /zapisz zmiany/i })).toBeInTheDocument();
    expect(customerService.fetchById).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it('shows error and retries fetchById', async () => {
    vi.mocked(customerService.fetchById)
      .mockRejectedValueOnce(new Error('Server error'))
      .mockResolvedValueOnce(baseCustomer());

    renderEdit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
    await userEvent.click(screen.getByRole('button', { name: /spróbuj ponownie/i }));

    await waitFor(() => {
      expect(customerService.fetchById).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole('button', { name: /zapisz zmiany/i })).toBeInTheDocument();
  });

  it('submits update and navigates to customer list', async () => {
    const user = userEvent.setup();
    renderEdit();

    await screen.findByRole('button', { name: /zapisz zmiany/i });

    await user.clear(screen.getByRole('textbox', { name: /nazwa wyświetlana/i }));
    await user.type(screen.getByRole('textbox', { name: /nazwa wyświetlana/i }), 'ACME Updated');

    await user.click(screen.getByRole('button', { name: /zapisz zmiany/i }));

    await waitFor(() => {
      expect(customerService.updateItem).toHaveBeenCalled();
    });
    const putCall = vi.mocked(customerService.updateItem).mock.calls[0];
    expect(putCall?.[0]).toBe(CUSTOMER_ID);
    expect(putCall?.[1]).toMatchObject({ name: 'ACME Updated' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer list' })).toBeInTheDocument();
    });
  });
});

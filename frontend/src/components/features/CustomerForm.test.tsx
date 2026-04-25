/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomerForm, customerFormSchema, validateNipChecksum } from './CustomerForm';
import type { Customer } from '@/types';

/** Valid Polish NIP (checksum matches backend rules). */
const VALID_NIP = '5260250274';

const baseCustomer: Customer = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  user: 1,
  name: 'ACME',
  company_name: 'ACME Sp. z o.o.',
  nip: VALID_NIP,
  email: 'kontakt@acme.test',
  phone: '48123456789',
  street: 'Ul. Testowa 1',
  city: 'Warszawa',
  postal_code: '00-001',
  country: 'PL',
  distance_km: 10,
  delivery_days: 'Mon–Fri',
  payment_terms: 14,
  credit_limit: '1000.00',
  is_active: true,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-02T00:00:00.000Z',
};

describe('validateNipChecksum', () => {
  it('returns true for a valid NIP', () => {
    expect(validateNipChecksum(VALID_NIP)).toBe(true);
  });

  it('returns false for wrong checksum', () => {
    expect(validateNipChecksum('1234567890')).toBe(false);
  });

  it('returns false for empty or partial', () => {
    expect(validateNipChecksum('')).toBe(false);
    expect(validateNipChecksum('526025027')).toBe(false);
  });
});

describe('customerFormSchema', () => {
  it('accepts minimal valid payload', () => {
    const parsed = customerFormSchema.parse({
      name: 'Client',
      company_name: '',
      nip: '',
      email: '',
      phone: '',
      street: '',
      city: '',
      postal_code: '',
      country: 'PL',
      distance_km: '',
      delivery_days: '',
      payment_terms: '14',
      credit_limit: '0',
      is_active: true,
    });
    expect(parsed.name).toBe('Client');
  });

  it('rejects invalid NIP when provided', () => {
    expect(() =>
      customerFormSchema.parse({
        name: 'Client',
        company_name: '',
        nip: '1234567890',
        email: '',
        phone: '',
        street: '',
        city: '',
        postal_code: '',
        country: 'PL',
        distance_km: '',
        delivery_days: '',
        payment_terms: '14',
        credit_limit: '0',
        is_active: true,
      }),
    ).toThrow(/Invalid NIP/);
  });

  it('treats empty payment_terms as default 14 (cleared number input)', () => {
    const parsed = customerFormSchema.parse({
      name: 'Client',
      company_name: '',
      nip: '',
      email: '',
      phone: '',
      street: '',
      city: '',
      postal_code: '',
      country: 'PL',
      distance_km: '',
      delivery_days: '',
      payment_terms: '',
      credit_limit: '0',
      is_active: true,
    });
    expect(parsed.payment_terms).toBe('14');
  });

  it('normalizes credit limit after partial decimal entry', () => {
    const parsed = customerFormSchema.parse({
      name: 'Client',
      company_name: '',
      nip: '',
      email: '',
      phone: '',
      street: '',
      city: '',
      postal_code: '',
      country: 'PL',
      distance_km: '',
      delivery_days: '',
      payment_terms: '14',
      credit_limit: '0.',
      is_active: true,
    });
    expect(parsed.credit_limit).toBe('0');
  });
});

describe('CustomerForm', () => {
  it('renders create mode title', () => {
    render(<CustomerForm onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /new customer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create customer/i })).toBeInTheDocument();
  });

  it('renders edit mode when customer is provided', () => {
    render(<CustomerForm customer={baseCustomer} onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /edit customer/i })).toBeInTheDocument();
  });

  it('shows NIP validation error for invalid checksum', async () => {
    const user = userEvent.setup();
    const { container } = render(<CustomerForm onSubmit={vi.fn()} />);

    await user.type(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Firma');
    await user.type(container.querySelector<HTMLInputElement>('input[name="nip"]')!, '1234567890');

    await user.click(screen.getByRole('button', { name: /create customer/i }));

    expect(await screen.findByText(/Invalid NIP/i)).toBeInTheDocument();
  });

  it('submits create payload with nullables and uppercase country', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<CustomerForm onSubmit={onSubmit} />);

    await user.type(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Nowy klient');
    const country = container.querySelector<HTMLInputElement>('input[name="country"]')!;
    await user.clear(country);
    await user.type(country, 'pl');

    await user.click(screen.getByRole('button', { name: /create customer/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nowy klient',
        country: 'PL',
        nip: null,
        email: null,
        company_name: null,
      }),
    );
  });

  it('submits update payload including customer id', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<CustomerForm customer={baseCustomer} onSubmit={onSubmit} />);

    const nameInput = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    await user.clear(nameInput);
    await user.type(nameInput, 'ACME 2');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: baseCustomer.id,
        name: 'ACME 2',
        nip: VALID_NIP,
      }),
    );
  });
});

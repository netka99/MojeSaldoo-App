/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { QuickExpenseSheet } from './QuickExpenseSheet';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('framer-motion', () => {
  const MotionDiv = React.forwardRef(
    ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, style: _s, ...domProps } = rest;
      return React.createElement('div', { ...domProps, ref }, children);
    },
  );
  MotionDiv.displayName = 'MotionDiv';
  return {
    motion: { div: MotionDiv },
    AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  };
});

const hoisted = vi.hoisted(() => ({
  useCreateQuickExpenseMutation: vi.fn(),
}));

vi.mock('@/query/use-cashflow', () => ({
  useCreateQuickExpenseMutation: hoisted.useCreateQuickExpenseMutation,
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSheet(open: boolean, onClose = vi.fn()) {
  return render(
    <TestQueryProvider>
      <QuickExpenseSheet open={open} onClose={onClose} />
    </TestQueryProvider>,
  );
}

function setupMutation(mutateAsync = vi.fn().mockResolvedValue({})) {
  hoisted.useCreateQuickExpenseMutation.mockReturnValue({
    mutateAsync,
    isPending: false,
  });
  return mutateAsync;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickExpenseSheet', () => {
  beforeEach(() => {
    setupMutation();
  });

  it('is hidden when open=false', () => {
    renderSheet(false);
    expect(screen.queryByText('Szybki wydatek')).not.toBeInTheDocument();
  });

  it('is visible when open=true', () => {
    renderSheet(true);
    expect(screen.getByText('Szybki wydatek')).toBeInTheDocument();
  });

  it('shows amount input and category chips', () => {
    renderSheet(true);
    expect(screen.getByPlaceholderText('0.00')).toBeInTheDocument();
    expect(screen.getByText('Paliwo')).toBeInTheDocument();
    expect(screen.getByText('Inne')).toBeInTheDocument();
  });

  it('shows validation error when submitting with empty amount', async () => {
    const user = userEvent.setup();
    renderSheet(true);
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));
    expect(screen.getByText(/Wpisz kwotę większą od zera/)).toBeInTheDocument();
  });

  it('shows validation error when amount is zero', async () => {
    const user = userEvent.setup();
    renderSheet(true);
    await user.type(screen.getByPlaceholderText('0.00'), '0');
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));
    expect(screen.getByText(/Wpisz kwotę większą od zera/)).toBeInTheDocument();
  });

  it('calls mutateAsync with correct payload on valid submit', async () => {
    const mutateAsync = setupMutation();
    const user = userEvent.setup();
    renderSheet(true);

    await user.type(screen.getByPlaceholderText('0.00'), '150.50');
    // Select "Paliwo" category
    await user.click(screen.getByRole('button', { name: 'Paliwo' }));
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '150.50',
        category: 'fuel',
        cost_type: 'indirect',
        has_vat: false,
      }),
    );
  });

  it('calls onClose after successful submit', async () => {
    const onClose = vi.fn();
    setupMutation();
    const user = userEvent.setup();
    renderSheet(true, onClose);

    await user.type(screen.getByPlaceholderText('0.00'), '99');
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message on API failure', async () => {
    hoisted.useCreateQuickExpenseMutation.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('Network error')),
      isPending: false,
    });
    const user = userEvent.setup();
    renderSheet(true);

    await user.type(screen.getByPlaceholderText('0.00'), '50');
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));

    expect(screen.getByText(/Wystąpił błąd przy zapisie/)).toBeInTheDocument();
  });

  it('category chip selection highlights the selected chip', async () => {
    const user = userEvent.setup();
    renderSheet(true);

    const transportBtn = screen.getByRole('button', { name: 'Transport' });
    await user.click(transportBtn);

    expect(transportBtn.className).toContain('bg-primary');
  });

  it('"Więcej" toggle reveals vendor and date fields', async () => {
    const user = userEvent.setup();
    renderSheet(true);

    // vendor input should not be visible yet
    expect(screen.queryByPlaceholderText(/Od kogo/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Więcej/ }));

    expect(screen.getByPlaceholderText(/Od kogo/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
  });

  it('calls onClose when Anuluj is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSheet(true, onClose);

    await user.click(screen.getByRole('button', { name: /Anuluj/ }));

    expect(onClose).toHaveBeenCalled();
  });

  it('includes vendor in payload when filled in "Więcej" section', async () => {
    const mutateAsync = setupMutation();
    const user = userEvent.setup();
    renderSheet(true);

    await user.type(screen.getByPlaceholderText('0.00'), '200');
    await user.click(screen.getByRole('button', { name: /Więcej/ }));
    await user.type(screen.getByPlaceholderText(/Od kogo/), 'Orlen');
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: 'Orlen' }),
    );
  });

  it('has_vat toggles correctly via checkbox', async () => {
    const mutateAsync = setupMutation();
    const user = userEvent.setup();
    renderSheet(true);

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    await user.type(screen.getByPlaceholderText('0.00'), '300');
    await user.click(screen.getByRole('button', { name: /Zapisz wydatek/ }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ has_vat: true }),
    );
  });
});

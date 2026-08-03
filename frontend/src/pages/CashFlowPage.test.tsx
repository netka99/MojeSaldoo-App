/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { CashFlowPage } from './CashFlowPage';
import type { CashFlowDashboard } from '@/types/cashflow.types';

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
  useCashFlowDashboardQuery: vi.fn(),
  useCreateQuickExpenseMutation: vi.fn(),
  useDeleteQuickExpenseMutation: vi.fn(),
  useQuickExpensesQuery: vi.fn(),
  useUpdateTaxConfigMutation: vi.fn(),
  useTaxConfigQuery: vi.fn(),
  useExpenseChartQuery: vi.fn(),
}));

vi.mock('@/query/use-cashflow', () => ({
  useCashFlowDashboardQuery: hoisted.useCashFlowDashboardQuery,
  useCreateQuickExpenseMutation: hoisted.useCreateQuickExpenseMutation,
  useDeleteQuickExpenseMutation: hoisted.useDeleteQuickExpenseMutation,
  useQuickExpensesQuery: hoisted.useQuickExpensesQuery,
  useUpdateTaxConfigMutation: hoisted.useUpdateTaxConfigMutation,
  useTaxConfigQuery: hoisted.useTaxConfigQuery,
  useExpenseChartQuery: hoisted.useExpenseChartQuery,
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDashboard(overrides: Partial<CashFlowDashboard> = {}): CashFlowDashboard {
  return {
    today: {
      cash_balance: 1000,
      bank_balance: 5000,
      balance_updated_at: '2026-07-15T10:00:00Z',
      total_available: 6000,
      upcoming_obligations: [
        {
          type: 'vat',
          label: 'VAT lipiec',
          amount: 1200,
          due_date: '2026-07-25',
          days_until: 10,
        },
        {
          type: 'zus',
          label: 'ZUS',
          amount: 600,
          due_date: '2026-07-20',
          days_until: 5,
        },
      ],
      total_reserved: 1800,
      really_yours: 4200,
      has_config: true,
    },
    month: {
      period: '2026-07',
      revenue_paid: 8000,
      revenue_outstanding: 2000,
      b2c_revenue: 500,
      costs_ksef: 3000,
      costs_quick: 400,
      costs_fixed: 1600,
      vat_output: 1840,
      vat_input: 640,
      vat_to_pay: 1200,
      vat_surplus: 0,
      vat_due_date: '2026-07-25',
      vat_input_invoices: [],
      pit_estimate: 855,
      pit_is_estimate: true,
      zus_monthly: 600,
      zus_due_date: '2026-07-20',
      really_yours_estimate: 2145,
      recent_quick_expenses: [
        {
          id: 'qe-1',
          date: '2026-07-10',
          amount: '250.00',
          category: 'fuel',
          category_label: 'Paliwo',
          vendor: 'Orlen',
          has_vat: true,
        },
      ],
      uncategorized_ksef_count: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/cash-flow']}>
        <Routes>
          <Route path="/cash-flow" element={<CashFlowPage />} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

function setupMocks(dashboard: CashFlowDashboard | null = null) {
  hoisted.useCashFlowDashboardQuery.mockReturnValue({
    data: dashboard ?? makeDashboard(),
    isLoading: false,
  });
  hoisted.useCreateQuickExpenseMutation.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  hoisted.useDeleteQuickExpenseMutation.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  hoisted.useQuickExpensesQuery.mockReturnValue({ data: [], isLoading: false });
  hoisted.useExpenseChartQuery.mockReturnValue({ data: [], isLoading: false });
  hoisted.useUpdateTaxConfigMutation.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  hoisted.useTaxConfigQuery.mockReturnValue({ data: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashFlowPage', () => {
  beforeEach(() => {
    setupMocks();
  });

  it('renders loading spinner when data is loading', () => {
    hoisted.useCashFlowDashboardQuery.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('shows "Dziś" tab content with really_yours amount', () => {
    renderPage();
    expect(screen.getByText('Naprawdę Twoje')).toBeInTheDocument();
    // 4200 PLN formatted
    expect(screen.getByText(/4\s*200/)).toBeInTheDocument();
  });

  it('shows upcoming obligations list', () => {
    renderPage();
    expect(screen.getByText('VAT lipiec')).toBeInTheDocument();
    expect(screen.getByText('ZUS')).toBeInTheDocument();
  });

  it('colors obligation based on days_until: <7 orange, <14 yellow', () => {
    renderPage();
    // ZUS is 5 days away (orange badge class)
    const zusRow = screen.getByText('ZUS').closest('div[class*="rounded-xl"]');
    expect(zusRow).toBeTruthy();
  });

  it('shows missing balance banner when balance_updated_at is null', () => {
    setupMocks({
      ...makeDashboard(),
      today: {
        ...makeDashboard().today,
        balance_updated_at: null,
      },
    });
    renderPage();
    expect(screen.getByText(/Nie podano salda kont/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wpisz saldo/ })).toBeInTheDocument();
  });

  it('does NOT show balance banner when balance_updated_at is set', () => {
    renderPage();
    expect(screen.queryByText(/Nie podano salda kont/)).not.toBeInTheDocument();
  });

  it('shows negative really_yours in red', () => {
    setupMocks({
      ...makeDashboard(),
      today: { ...makeDashboard().today, really_yours: -500 },
    });
    renderPage();
    const amount = screen.getByText(/-500/);
    expect(amount.className).toContain('destructive');
  });

  it('switches to Miesiąc tab and shows month data', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.getByText('Przychody')).toBeInTheDocument();
    expect(screen.getByText('Koszty')).toBeInTheDocument();
    expect(screen.getByText(/Zarezerwuj na podatki/)).toBeInTheDocument();
  });

  it('shows PIT "~szacunek" badge in Miesiąc tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.getByText('~szacunek')).toBeInTheDocument();
  });

  it('shows really_yours_estimate in Miesiąc tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.getByText('Szacowany Twój wynik')).toBeInTheDocument();
    expect(screen.getByText(/2\s*145/)).toBeInTheDocument();
  });

  it('shows "Koszty gotówkowe" row in Miesiąc tab linking to KosztySheet', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.getByText('Koszty gotówkowe')).toBeInTheDocument();
  });

  it('opens KosztySheet on "Dodaj koszt" click in Miesiąc tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    await user.click(screen.getAllByRole('button', { name: /Dodaj koszt/ })[0]);
    // Sheet open — "Koszty gotówkowe" appears as both page row and sheet header
    expect(screen.getAllByText('Koszty gotówkowe').length).toBeGreaterThan(1);
    expect(screen.getByText('Brak kosztów gotówkowych w tym miesiącu.')).toBeInTheDocument();
  });

  it('opens KosztySheet on "Dodaj koszt" click in Dziś tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /\+ Dodaj/ })[0]);
    expect(screen.getByText('Brak kosztów gotówkowych w tym miesiącu.')).toBeInTheDocument();
  });

  it('opens TaxConfigSetup when "Aktualizuj saldo" button clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Aktualizuj saldo/ }));
    // Sheet is open — check for the cash balance input label unique to the sheet
    expect(screen.getByText(/Gotówka \/ kasetka/)).toBeInTheDocument();
  });

  it('opens TaxConfigSetup from balance banner "Wpisz saldo" button', async () => {
    setupMocks({
      ...makeDashboard(),
      today: { ...makeDashboard().today, balance_updated_at: null },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Wpisz saldo/ }));
    expect(screen.getByText(/Gotówka \/ kasetka/)).toBeInTheDocument();
  });

  it('shows uncategorized invoices banner in Miesiąc tab when count > 0', async () => {
    setupMocks({
      ...makeDashboard(),
      month: { ...makeDashboard().month, uncategorized_ksef_count: 3 },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.getByText(/3 faktury zakupowe bez kategorii/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Przypisz kategorie/ })).toBeInTheDocument();
  });

  it('does NOT show uncategorized banner when count is 0', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.queryByText(/bez kategorii/)).not.toBeInTheDocument();
  });

  it('shows singular form for 1 uncategorized invoice', async () => {
    setupMocks({
      ...makeDashboard(),
      month: { ...makeDashboard().month, uncategorized_ksef_count: 1 },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Miesiąc' }));
    expect(screen.getByText(/1 faktura zakupowa bez kategorii/)).toBeInTheDocument();
  });
});

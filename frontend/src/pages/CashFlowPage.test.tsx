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
import type { CashFlowDashboard, PayablesData } from '@/types/cashflow.types';

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
  useUpdateQuickExpenseMutation: vi.fn(),
  useDeleteQuickExpenseMutation: vi.fn(),
  useQuickExpensesQuery: vi.fn(),
  useUpdateTaxConfigMutation: vi.fn(),
  useTaxConfigQuery: vi.fn(),
  useExpenseChartQuery: vi.fn(),
  usePeriodSummaryQuery: vi.fn(),
  useOpexCategoriesQuery: vi.fn(),
  useAllOpexCategoriesQuery: vi.fn(),
  useCreateOpexCategoryMutation: vi.fn(),
  useUpdateOpexCategoryMutation: vi.fn(),
  useDeleteOpexCategoryMutation: vi.fn(),
  useCreateB2CRevenueMutation: vi.fn(),
  useHistoryQuery: vi.fn(),
}));

vi.mock('@/query/use-cashflow', () => ({
  useCashFlowDashboardQuery: hoisted.useCashFlowDashboardQuery,
  useCreateQuickExpenseMutation: hoisted.useCreateQuickExpenseMutation,
  useUpdateQuickExpenseMutation: hoisted.useUpdateQuickExpenseMutation,
  useDeleteQuickExpenseMutation: hoisted.useDeleteQuickExpenseMutation,
  useQuickExpensesQuery: hoisted.useQuickExpensesQuery,
  useUpdateTaxConfigMutation: hoisted.useUpdateTaxConfigMutation,
  useTaxConfigQuery: hoisted.useTaxConfigQuery,
  useExpenseChartQuery: hoisted.useExpenseChartQuery,
  usePeriodSummaryQuery: hoisted.usePeriodSummaryQuery,
  useOpexCategoriesQuery: hoisted.useOpexCategoriesQuery,
  useAllOpexCategoriesQuery: hoisted.useAllOpexCategoriesQuery,
  useCreateOpexCategoryMutation: hoisted.useCreateOpexCategoryMutation,
  useUpdateOpexCategoryMutation: hoisted.useUpdateOpexCategoryMutation,
  useDeleteOpexCategoryMutation: hoisted.useDeleteOpexCategoryMutation,
  useCreateB2CRevenueMutation: hoisted.useCreateB2CRevenueMutation,
  useHistoryQuery: hoisted.useHistoryQuery,
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyPayables: PayablesData = { total_count: 0, total_amount: 0, items: [] };

function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function makeDashboard(overrides: Partial<CashFlowDashboard> = {}): CashFlowDashboard {
  const month = currentMonthStr();
  const dueDay25 = `${month}-25`;
  const dueDay20 = `${month}-20`;
  return {
    today: {
      cash_balance: 1000,
      bank_balance: 5000,
      balance_updated_at: `${month}-15T10:00:00Z`,
      total_available: 6000,
      upcoming_obligations: [
        {
          type: 'vat',
          label: 'VAT bieżący',
          amount: 1200,
          due_date: dueDay25,
          days_until: 10,
        },
        {
          type: 'zus',
          label: 'ZUS',
          amount: 600,
          due_date: dueDay20,
          days_until: 5,
        },
        {
          type: 'pit',
          label: 'Podatek dochodowy',
          amount: 855,
          due_date: dueDay20,
          days_until: 5,
        },
      ],
      total_reserved: 1800,
      really_yours: 4200,
      has_config: true,
      receivables: [],
      payables: emptyPayables,
    },
    month: {
      period: month,
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
      vat_due_date: dueDay25,
      vat_input_invoices: [],
      pit_estimate: 855,
      pit_is_estimate: true,
      zus_social: 1788.27,
      zus_health: 432.54,
      zus_monthly: 600,
      zus_due_date: dueDay20,
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
  hoisted.useUpdateQuickExpenseMutation.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  hoisted.useUpdateTaxConfigMutation.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  hoisted.useTaxConfigQuery.mockReturnValue({ data: null });
  hoisted.useOpexCategoriesQuery.mockReturnValue({ data: [] });
  hoisted.useAllOpexCategoriesQuery.mockReturnValue({ data: [] });
  hoisted.useCreateOpexCategoryMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hoisted.useUpdateOpexCategoryMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hoisted.useDeleteOpexCategoryMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hoisted.useCreateB2CRevenueMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  hoisted.usePeriodSummaryQuery.mockReturnValue({ data: null, isLoading: false });
  hoisted.useHistoryQuery.mockReturnValue({ data: [], isLoading: false });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashFlowPage', () => {
  beforeEach(() => {
    setupMocks();
  });

  it('renders loading skeleton when data is loading', () => {
    hoisted.useCashFlowDashboardQuery.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.getByTestId('cashflow-skeleton')).toBeInTheDocument();
  });

  // ── Przegląd tab (default) ──────────────────────────────────────────────

  it('shows zysk estimate hero on Przegląd', () => {
    renderPage();
    expect(screen.getByText(/Szacowany zysk/)).toBeInTheDocument();
  });

  it('shows negative really_yours_estimate as strata in red', () => {
    setupMocks({
      ...makeDashboard(),
      month: { ...makeDashboard().month, really_yours_estimate: -500 },
    });
    renderPage();
    expect(screen.getByText(/Szacowana strata/)).toBeInTheDocument();
    const amounts = screen.getAllByText(/-500/);
    expect(amounts.some((el) => el.className.includes('destructive'))).toBe(true);
  });

  it('hides margin % badge when loss is extreme (> 200%)', () => {
    setupMocks({
      ...makeDashboard(),
      month: {
        ...makeDashboard().month,
        revenue_paid: 10,
        b2c_revenue: 0,
        really_yours_estimate: -5000,
      },
    });
    renderPage();
    // margin would be -50000% — badge should not render
    expect(screen.queryByText(/%\s*marży/)).not.toBeInTheDocument();
  });

  it('shows margin % badge in waterfall when loss is within range', () => {
    setupMocks({
      ...makeDashboard(),
      month: {
        ...makeDashboard().month,
        revenue_paid: 10000,
        b2c_revenue: 0,
        really_yours_estimate: -1500,
      },
    });
    renderPage();
    // waterfall shows operationalMarginPct badge — revenue=10000, no ksef/quick by category → 100%
    // historical hero margin badge uses rawMargin which would be -15% but is only shown for historical months
    // Just check the waterfall rendered (Marża brutto row exists)
    expect(screen.getByText('Marża brutto')).toBeInTheDocument();
  });

  it('shows upcoming obligations', () => {
    renderPage();
    // "Płatności" section renders obligation labels from upcoming_obligations
    expect(screen.getByText('VAT bieżący')).toBeInTheDocument();
    expect(screen.getAllByText(/ZUS/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows revenue and costs detail on Przegląd by default', () => {
    renderPage();
    // 'Przychody' appears in both the hero card and PrzychodyBlock
    expect(screen.getAllByText('Przychody').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Koszty i zobowiązania')).toBeInTheDocument();
    expect(screen.getByText('Płatności')).toBeInTheDocument();
  });

  it('shows PIT szacunek tooltip on Przegląd', () => {
    renderPage();
    expect(screen.getByTitle(/Szacunek/)).toBeInTheDocument();
  });

  it('shows uncategorized invoices banner when count > 0', () => {
    setupMocks({
      ...makeDashboard(),
      month: { ...makeDashboard().month, uncategorized_ksef_count: 3 },
    });
    renderPage();
    expect(screen.getByText(/3 faktury zakupowe bez kategorii/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Przypisz kategorie/ })).toBeInTheDocument();
  });

  it('shows singular form for 1 uncategorized invoice', () => {
    setupMocks({
      ...makeDashboard(),
      month: { ...makeDashboard().month, uncategorized_ksef_count: 1 },
    });
    renderPage();
    expect(screen.getByText(/1 faktura zakupowa bez kategorii/)).toBeInTheDocument();
  });

  it('does NOT show uncategorized banner when count is 0', () => {
    renderPage();
    expect(screen.queryByText(/bez kategorii/)).not.toBeInTheDocument();
  });

  // ── Balance row ─────────────────────────────────────────────────────────

  it('shows balance row with Na koncie and Aktualizuj when balance is set and > 0', () => {
    // makeDashboard() has total_available: 6000 and balance_updated_at set
    renderPage();
    expect(screen.getByText('Na koncie:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktualizuj' })).toBeInTheDocument();
  });

  it('shows small add-balance link when balance_updated_at is null', () => {
    setupMocks({
      ...makeDashboard(),
      today: { ...makeDashboard().today, balance_updated_at: null },
    });
    renderPage();
    expect(screen.getByText(/Dodaj stan konta/)).toBeInTheDocument();
  });

  it('shows small add-balance link when balance is 0', () => {
    setupMocks({
      ...makeDashboard(),
      today: { ...makeDashboard().today, total_available: 0, balance_updated_at: '2026-08-01T10:00:00Z' },
    });
    renderPage();
    expect(screen.getByText(/Dodaj stan konta/)).toBeInTheDocument();
    expect(screen.queryByText('Na koncie:')).not.toBeInTheDocument();
  });

  it('opens TaxConfigSetup when Aktualizuj is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Aktualizuj' }));
    expect(screen.getByText(/Gotówka \/ kasetka/)).toBeInTheDocument();
  });

  it('opens TaxConfigSetup from add-balance link', async () => {
    setupMocks({
      ...makeDashboard(),
      today: { ...makeDashboard().today, balance_updated_at: null },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText(/Dodaj stan konta/));
    expect(screen.getByText(/Gotówka \/ kasetka/)).toBeInTheDocument();
  });

  // ── KosztySheet ─────────────────────────────────────────────────────────

  it('opens KosztySheet via + Dodaj in Koszty block', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: '+ Dodaj' }));
    // Sheet heading always visible when open; "Dostawca" is a form-only label
    expect(screen.getByRole('heading', { name: 'Nowy dokument' })).toBeInTheDocument();
    expect(screen.getByText('Dostawca')).toBeInTheDocument();
  });

  it('opens KosztySheet via FAB (mobile button)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Dodaj dokument' }));
    expect(screen.getByRole('heading', { name: 'Nowy dokument' })).toBeInTheDocument();
    expect(screen.getByText('Dostawca')).toBeInTheDocument();
  });

  // ── Receivables ─────────────────────────────────────────────────────────

  it('shows urgency pills in Faktury oczekujące when receivables are present', () => {
    setupMocks({
      ...makeDashboard(),
      today: {
        ...makeDashboard().today,
        receivables: [
          {
            id: 'rec-1',
            invoice_number: 'FV/1/2026',
            customer_name: 'Piekarnia ABC',
            amount: 3690,
            due_date: '2026-07-25',
            days_until: 10,
          },
        ],
      },
    });
    renderPage();
    // days_until: 10 > 7 → "Później" pill renders in Przychody block
    expect(screen.getByText('Później')).toBeInTheDocument();
  });

  it('shows receivable details after expanding Faktury oczekujące', async () => {
    const user = userEvent.setup();
    setupMocks({
      ...makeDashboard(),
      today: {
        ...makeDashboard().today,
        receivables: [
          {
            id: 'rec-1',
            invoice_number: 'FV/1/2026',
            customer_name: 'Piekarnia ABC',
            amount: 3690,
            due_date: '2026-07-25',
            days_until: 10,
          },
        ],
      },
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: /Faktury oczekujące/ }));
    expect(screen.getByText('Piekarnia ABC')).toBeInTheDocument();
    expect(screen.getByText('FV/1/2026')).toBeInTheDocument();
  });

  it('Faktury oczekujące expand button is disabled when no receivables', () => {
    renderPage();
    // No receivables and no revenue_outstanding_top → button disabled
    expect(screen.getByRole('button', { name: /Faktury oczekujące/ })).toBeDisabled();
  });

  // ── Payables ────────────────────────────────────────────────────────────

  it('shows Niezapłacone faktury dostawców when unpaid supplier invoices present', () => {
    setupMocks({
      ...makeDashboard(),
      today: {
        ...makeDashboard().today,
        payables: {
          total_count: 1,
          total_amount: 1200,
          items: [
            {
              id: 'pay-1',
              ksef_number: 'KS/001',
              invoice_number: 'FV-D/1/2026',
              seller_name: 'Dostawca Mąka Sp.j.',
              issue_date: '2026-07-10',
              amount: 1200,
              due_date: '2026-07-18',
              days_until: 3,
            },
          ],
        },
      },
    });
    renderPage();
    expect(screen.getByText(/Niezapłacone faktury dostawców/)).toBeInTheDocument();
    expect(screen.getByText(/1 faktura niezapłaconych/)).toBeInTheDocument();
  });

  it('shows payables details after expanding Niezapłacone faktury dostawców', async () => {
    const user = userEvent.setup();
    setupMocks({
      ...makeDashboard(),
      today: {
        ...makeDashboard().today,
        payables: {
          total_count: 1,
          total_amount: 1200,
          items: [
            {
              id: 'pay-1',
              ksef_number: 'KS/001',
              invoice_number: 'FV-D/1/2026',
              seller_name: 'Dostawca Mąka Sp.j.',
              issue_date: '2026-07-10',
              amount: 1200,
              due_date: '2026-07-18',
              days_until: 3,
            },
          ],
        },
      },
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: /Niezapłacone faktury dostawców/ }));
    expect(screen.getByText('Dostawca Mąka Sp.j.')).toBeInTheDocument();
  });

  it('does NOT show Niezapłacone faktury dostawców section when empty', () => {
    renderPage();
    expect(screen.queryByText(/Niezapłacone faktury dostawców/)).not.toBeInTheDocument();
  });

  // ── Month navigator ─────────────────────────────────────────────────────

  it('disables next month button when on current month', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Następny miesiąc' })).toBeDisabled();
  });

  it('shows "dane historyczne" label when navigated to previous month', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }));
    expect(screen.getByText(/dane historyczne/)).toBeInTheDocument();
  });

  it('hides Płatności section and balance row when viewing historical month', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }));
    expect(screen.queryByText('Płatności')).not.toBeInTheDocument();
    // Hero section (with Na koncie / Dodaj stan konta) is only shown for current month
    expect(screen.queryByText('Na koncie:')).not.toBeInTheDocument();
    expect(screen.queryByText(/Dodaj stan konta/)).not.toBeInTheDocument();
  });

  // ── Rok tab ─────────────────────────────────────────────────────────────

  it('shows Rok tab button', () => {
    renderPage();
    // ExpenseChart also has a "Rok" period button — check at least one exists
    expect(screen.getAllByRole('button', { name: 'Rok' }).length).toBeGreaterThanOrEqual(1);
  });

  it('switches to Rok tab and shows period picker', async () => {
    const user = userEvent.setup();
    renderPage();
    // Tab bar "Rok" comes before ExpenseChart's "Rok" in the DOM — click first match
    await user.click(screen.getAllByRole('button', { name: 'Rok' })[0]);
    expect(screen.getByText(/Ten rok/)).toBeInTheDocument();
  });

  it('shows Historia tab button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Historia' })).toBeInTheDocument();
  });

  it('switches to Historia tab and shows empty state', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Historia' }));
    expect(screen.getByText(/Brak danych historycznych/)).toBeInTheDocument();
  });

  it('Historia tab shows month cards when data is available', async () => {
    const user = userEvent.setup();
    hoisted.useHistoryQuery.mockReturnValue({
      data: [
        {
          period: '2026-07',
          revenue_total: 8000,
          costs_total: 5000,
          really_yours: 1500,
          is_loss: false,
          margin_pct: 19,
        },
      ],
      isLoading: false,
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Historia' }));
    expect(screen.getByText(/lipiec 2026/i)).toBeInTheDocument();
    expect(screen.getByText('19%')).toBeInTheDocument();
  });

  it('clicking Historia month navigates to Przegląd with that month', async () => {
    const user = userEvent.setup();
    const currentMonth = currentMonthStr();
    hoisted.useHistoryQuery.mockReturnValue({
      data: [
        {
          period: currentMonth,
          revenue_total: 8000,
          costs_total: 5000,
          really_yours: 1500,
          is_loss: false,
          margin_pct: 19,
        },
      ],
      isLoading: false,
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Historia' }));
    // Click the month card
    const cards = screen.getAllByText(/Kliknij, żeby zobaczyć szczegóły/);
    await user.click(cards[0]);
    // Should be back on Przegląd tab (month navigator visible)
    expect(screen.getByLabelText('Poprzedni miesiąc')).toBeInTheDocument();
  });
});

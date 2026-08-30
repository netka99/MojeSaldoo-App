/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { HarmonogramPage } from './HarmonogramPage';
import type { HarmonogramData } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  useHarmonogramQuery: vi.fn(),
}));

vi.mock('@/query/use-cashflow', () => ({
  useHarmonogramQuery: hoisted.useHarmonogramQuery,
}));

// Fix Date so component always initialises to September 2026
const FIXED_DATE = new Date('2026-09-01T10:00:00');
vi.setSystemTime(FIXED_DATE);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeData(overrides: Partial<HarmonogramData> = {}): HarmonogramData {
  return {
    period: '2026-09',
    opening_balance: 10500,
    has_balance: true,
    balance_updated_at: '2026-08-28T09:15:00+02:00',
    total_in: 3000,
    confirmed_in: 1000,
    expected_in: 2000,
    total_out: 8000,
    closing_balance: 5500,
    min_balance: 5500,
    min_balance_date: null,
    events: [
      {
        date: '2026-09-05',
        type: 'fixed_cost',
        label: 'Wynajem lokalu',
        sublabel: 'Czynsz / Najem',
        amount: 4200,
        direction: 'out',
        status: 'expected',
        running_balance: 6300,
      },
      {
        date: '2026-09-10',
        type: 'b2b_incoming',
        label: 'Galeria Smaku',
        sublabel: 'FV/2026/0045',
        amount: 1500,
        direction: 'in',
        status: 'expected',
        running_balance: 7800,
      },
      {
        date: '2026-09-15',
        type: 'b2c_incoming',
        label: 'Sprzedaż gotówkowa B2C',
        sublabel: '',
        amount: 1500,
        direction: 'in',
        status: 'paid',
        running_balance: 9300,
      },
      {
        date: '2026-09-20',
        type: 'zus_social',
        label: 'ZUS społeczny',
        sublabel: 'Termin: 20.09.2026',
        amount: 1788,
        direction: 'out',
        status: 'expected',
        running_balance: 7512,
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cash-flow/harmonogram']}>
      <TestQueryProvider>
        <HarmonogramPage />
      </TestQueryProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarmonogramPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hoisted.useHarmonogramQuery.mockReturnValue({
      data: makeData(),
      isLoading: false,
      isError: false,
    });
  });

  it('renders the page title', () => {
    renderPage();
    expect(screen.getByText('Harmonogram płatności')).toBeInTheDocument();
  });

  it('shows the back link to cash-flow', () => {
    renderPage();
    expect(screen.getByText('Saldo i Podatki')).toBeInTheDocument();
  });

  it('displays opening balance in summary', () => {
    renderPage();
    expect(screen.getByText(/10\s*500/)).toBeInTheDocument();
  });

  it('shows event labels from the events list', () => {
    renderPage();
    expect(screen.getByText('Wynajem lokalu')).toBeInTheDocument();
    expect(screen.getByText('Galeria Smaku')).toBeInTheDocument();
    expect(screen.getByText('Sprzedaż gotówkowa B2C')).toBeInTheDocument();
    // 'ZUS społeczny' appears twice: as event label and as eventTypeLabel
    expect(screen.getAllByText('ZUS społeczny').length).toBeGreaterThanOrEqual(1);
  });

  it('shows loading state', () => {
    hoisted.useHarmonogramQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('shows error state', () => {
    hoisted.useHarmonogramQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderPage();
    expect(screen.getByText(/nie udało się załadować/i)).toBeInTheDocument();
  });

  it('shows negative balance warning when min_balance < 0', () => {
    hoisted.useHarmonogramQuery.mockReturnValue({
      data: makeData({ min_balance: -500, min_balance_date: '2026-09-28', closing_balance: -500 }),
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText(/saldo może być ujemne/i)).toBeInTheDocument();
  });

  it('does NOT show negative balance warning when balance is positive', () => {
    renderPage();
    expect(screen.queryByText(/saldo może być ujemne/i)).not.toBeInTheDocument();
  });

  it('shows no balance info banner when has_balance is false', () => {
    hoisted.useHarmonogramQuery.mockReturnValue({
      data: makeData({ has_balance: false, opening_balance: 0 }),
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText(/Dodaj stan konta/i)).toBeInTheDocument();
  });

  it('shows empty state when no events', () => {
    hoisted.useHarmonogramQuery.mockReturnValue({
      data: makeData({ events: [] }),
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText(/Brak zaplanowanych płatności/i)).toBeInTheDocument();
  });

  it('navigates to previous month on left chevron click', async () => {
    const user = userEvent.setup();
    renderPage();
    // The current month header should show September 2026
    expect(screen.getByText(/wrzesień 2026/i)).toBeInTheDocument();
    // Click prev
    const buttons = screen.getAllByRole('button');
    const prevBtn = buttons.find(b => b.querySelector('svg'));
    if (prevBtn) {
      await user.click(prevBtn);
      // Should now call useHarmonogramQuery with 2026-08
      expect(hoisted.useHarmonogramQuery).toHaveBeenCalledWith('2026-08');
    }
  });

  it('groups events by day — each day appears as a card heading', () => {
    renderPage();
    // Four different dates → four day headings (exact match to avoid "5 wrz" matching "15 wrz")
    expect(screen.getByText(/^5 wrz$/i)).toBeInTheDocument();
    expect(screen.getByText(/^10 wrz$/i)).toBeInTheDocument();
    expect(screen.getByText(/^15 wrz$/i)).toBeInTheDocument();
    expect(screen.getByText(/^20 wrz$/i)).toBeInTheDocument();
  });
});

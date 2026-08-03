/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  useExpenseChartQuery: vi.fn(),
}));

vi.mock('@/query/use-cashflow', () => ({
  useExpenseChartQuery: hoisted.useExpenseChartQuery,
}));

// Recharts uses ResizeObserver — provide a stub
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// SVGElement.getBBox stub (jsdom doesn't implement it)
Object.defineProperty(global.SVGElement.prototype, 'getBBox', {
  configurable: true,
  value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
});

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: vi.fn(() => 'tok') },
  api: {},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ExpenseChart } from './ExpenseChart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChart() {
  return render(<ExpenseChart />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExpenseChart', () => {
  beforeEach(() => {
    hoisted.useExpenseChartQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it('renders the section heading', () => {
    renderChart();
    expect(screen.getByText('Koszty wg kategorii')).toBeInTheDocument();
  });

  it('renders all four view mode buttons', () => {
    renderChart();
    expect(screen.getByRole('button', { name: 'Miesiąc' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6 mies.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rok' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zakres' })).toBeInTheDocument();
  });

  it('shows empty state message when no data', () => {
    renderChart();
    expect(screen.getByText('Brak skategoryzowanych kosztów w tym okresie.')).toBeInTheDocument();
  });

  it('shows loading message while fetching', () => {
    hoisted.useExpenseChartQuery.mockReturnValue({ data: [], isLoading: true });
    renderChart();
    expect(screen.getByText('Ładowanie…')).toBeInTheDocument();
  });

  it('shows date inputs when "Zakres" mode selected', async () => {
    const user = userEvent.setup();
    renderChart();
    await user.click(screen.getByRole('button', { name: 'Zakres' }));
    const inputs = screen.getAllByDisplayValue('');
    const dateInputs = inputs.filter(
      (el) => (el as HTMLInputElement).type === 'date',
    );
    expect(dateInputs).toHaveLength(2);
  });

  it('shows total when single-period data has a total', () => {
    hoisted.useExpenseChartQuery.mockReturnValue({
      data: [{ period: 'lip 26', fuel: 400, other: 100, total: 500 }],
      isLoading: false,
    });
    renderChart();
    expect(screen.getByText(/Łącznie/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('shows multi-period empty state when no data in 6-month mode', async () => {
    const user = userEvent.setup();
    renderChart();
    await user.click(screen.getByRole('button', { name: '6 mies.' }));
    expect(screen.getByText('Brak danych.')).toBeInTheDocument();
  });

  it('"Miesiąc" button is active by default (has bg-primary class)', () => {
    renderChart();
    const btn = screen.getByRole('button', { name: 'Miesiąc' });
    expect(btn.className).toContain('bg-primary');
  });

  it('switches active button highlight when mode changes', async () => {
    const user = userEvent.setup();
    renderChart();
    await user.click(screen.getByRole('button', { name: '6 mies.' }));
    expect(screen.getByRole('button', { name: '6 mies.' }).className).toContain('bg-primary');
    expect(screen.getByRole('button', { name: 'Miesiąc' }).className).not.toContain('bg-primary');
  });
});

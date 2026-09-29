/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { InvoiceNewLandingPage } from './InvoiceNewLandingPage';

// ── mocks ──────────────────────────────────────────────────────────────────────

const useModuleGuardMock = vi.hoisted(() => vi.fn((_m: string) => true));

vi.mock('@/hooks/useModuleGuard', () => ({
  useModuleGuard: (m: string) => useModuleGuardMock(m),
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: () => 'tok' },
  api: {},
}));

// ── render helper ──────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/invoices/new']}>
        <Routes>
          <Route path="/invoices/new" element={<InvoiceNewLandingPage />} />
          <Route path="/invoices/new/orders" element={<div data-testid="orders-wizard">orders</div>} />
          <Route path="/invoices/new/period" element={<div data-testid="period-wizard">period</div>} />
          <Route path="/invoices/new/manual" element={<div data-testid="manual-wizard">manual</div>} />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('InvoiceNewLandingPage', () => {
  beforeEach(() => {
    useModuleGuardMock.mockImplementation(() => true);
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByText('Nowa faktura')).toBeInTheDocument();
    expect(screen.getByText(/Wybierz sposób wystawiania/i)).toBeInTheDocument();
  });

  it('shows Zbiorcza and Ręcznie when orders module is enabled', () => {
    renderPage();
    expect(screen.getAllByText('Zbiorcza').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ręcznie').length).toBeGreaterThan(0);
    expect(screen.queryByText('Z zamówień')).not.toBeInTheDocument();
  });

  it('hides Zbiorcza when orders module is disabled, shows only Ręcznie', () => {
    useModuleGuardMock.mockImplementation((m: string) => m !== 'orders');
    renderPage();
    expect(screen.queryByText('Zbiorcza')).not.toBeInTheDocument();
    expect(screen.getByText('Ręcznie')).toBeInTheDocument();
  });

  it('navigates to /invoices/new/period when "Zbiorcza" is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByText('Zbiorcza')[0]);
    expect(screen.getByTestId('period-wizard')).toBeInTheDocument();
  });

  it('navigates to /invoices/new/manual when "Ręcznie" is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByText('Ręcznie')[0]);
    expect(screen.getByTestId('manual-wizard')).toBeInTheDocument();
  });
});

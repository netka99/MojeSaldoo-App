// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ModuleSummaryStep } from './ModuleSummaryStep';

const MODULES_VAN: Record<string, boolean> = {
  invoicing: true,
  ksef: true,
  customers: true,
  orders: true,
  reporting: true,
  products: true,
  purchasing: true,
  ksef_inbox: true,
  van_routes: true,
  delivery: true,
  warehouses: false,
  production: false,
  cost_allocation: false,
};

describe('ModuleSummaryStep', () => {
  it('renders only enabled modules', () => {
    render(
      <ModuleSummaryStep
        modules={MODULES_VAN}
        onConfirm={() => {}}
        onBack={() => {}}
        loading={false}
      />,
    );
    expect(screen.getByText('Faktury VAT')).toBeInTheDocument();
    expect(screen.getByText('Zakupy (PZ)')).toBeInTheDocument();
    expect(screen.getByText('Trasy vana')).toBeInTheDocument();
    // Disabled modules must not appear.
    expect(screen.queryByText('Produkcja i receptury')).not.toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn();
    render(
      <ModuleSummaryStep
        modules={MODULES_VAN}
        onConfirm={onConfirm}
        onBack={() => {}}
        loading={false}
      />,
    );
    await userEvent.click(screen.getByText('Zacznij korzystać →'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('shows loading text when loading=true', () => {
    render(
      <ModuleSummaryStep
        modules={MODULES_VAN}
        onConfirm={() => {}}
        onBack={() => {}}
        loading={true}
      />,
    );
    expect(screen.getByText('Zapisuję…')).toBeInTheDocument();
  });

  it('disables confirm button when loading', () => {
    render(
      <ModuleSummaryStep
        modules={MODULES_VAN}
        onConfirm={() => {}}
        onBack={() => {}}
        loading={true}
      />,
    );
    expect(screen.getByText('Zapisuję…').closest('button')).toBeDisabled();
  });

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn();
    render(
      <ModuleSummaryStep
        modules={MODULES_VAN}
        onConfirm={() => {}}
        onBack={onBack}
        loading={false}
      />,
    );
    await userEvent.click(screen.getByText('← Wróć'));
    expect(onBack).toHaveBeenCalled();
  });
});

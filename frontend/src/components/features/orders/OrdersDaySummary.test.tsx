/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersDaySummary } from './OrdersDaySummary';
import type { Order } from '@/types';

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    customer_id: 'c-1',
    customer_name: 'Sklep ABC',
    company: 'co-1',
    user: null,
    order_number: 'ZAM/2026/01',
    order_date: '2026-04-01',
    delivery_date: '2026-04-20',
    status: 'confirmed',
    subtotal_net: '100.00',
    subtotal_gross: '123.00',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '100.00',
    total_gross: '100.00',
    customer_notes: '',
    internal_notes: '',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    confirmed_at: '2026-04-01T10:00:00Z',
    delivered_at: null,
    items: [],
    ...over,
  };
}

const noop = () => {};

describe('OrdersDaySummary', () => {
  it('shows collapsed summary with correct shop count and total', () => {
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({ id: 'a', customer_name: 'A', total_gross: '10.50' }),
          makeOrder({ id: 'b', customer_name: 'B', total_gross: '20.00' }),
          makeOrder({ id: 'c', customer_name: 'C', total_gross: '5.00' }),
        ]}
        deliveryEnabled={false}
        wzSelectionMode={false}
        selectedCount={0}
        confirmedCount={3}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
      />,
    );
    const summaryToggle = screen.getByRole('button', { name: /3 sklepy/i });
    expect(summaryToggle).toBeInTheDocument();
    expect(within(summaryToggle).getByText(/35,50|35\.50/)).toBeInTheDocument();
  });

  it('clicking bar toggles expanded state', async () => {
    const user = userEvent.setup();
    render(
      <OrdersDaySummary
        orders={[makeOrder({ customer_name: 'Jeden Sklep' })]}
        deliveryEnabled={false}
        wzSelectionMode={false}
        selectedCount={0}
        confirmedCount={1}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
      />,
    );
    const toggle = screen.getByRole('button', { name: /1 sklep/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('cell', { name: 'Jeden Sklep' })).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expanded state shows per-shop breakdown rows', async () => {
    const user = userEvent.setup();
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({ id: '1', customer_name: 'Alfa', total_gross: '10.00' }),
          makeOrder({ id: '2', customer_name: 'Beta', total_gross: '20.00' }),
        ]}
        deliveryEnabled={false}
        wzSelectionMode={false}
        selectedCount={0}
        confirmedCount={2}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /2 sklepy/i }));

    expect(screen.getByRole('cell', { name: 'Alfa' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Beta' })).toBeInTheDocument();
  });

  it('expanded grand total row matches sum of individual totals', async () => {
    const user = userEvent.setup();
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({ id: '1', customer_name: 'S1', total_gross: '100.00' }),
          makeOrder({ id: '2', customer_name: 'S2', total_gross: '50.50' }),
        ]}
        deliveryEnabled={false}
        wzSelectionMode={false}
        selectedCount={0}
        confirmedCount={2}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /2 sklepy/i }));
    const razemRow = screen.getByText('Razem').closest('div');
    expect(razemRow?.textContent).toMatch(/150[,.]50/);
  });

  it('Generuj WZ button present when deliveryEnabled=true and not in selectionMode', () => {
    render(
      <OrdersDaySummary
        orders={[makeOrder()]}
        deliveryEnabled
        wzSelectionMode={false}
        selectedCount={0}
        confirmedCount={2}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
        onGenerateWz={vi.fn()}
        onLoadVan={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Generuj WZ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Załaduj Van' })).toBeInTheDocument();
  });

  it('in selectionMode: shows Utwórz WZ (N) and Anuluj buttons, hides Generuj WZ', () => {
    render(
      <OrdersDaySummary
        orders={[makeOrder()]}
        deliveryEnabled
        wzSelectionMode
        selectedCount={4}
        confirmedCount={1}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utwórz WZ (4)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generuj WZ' })).not.toBeInTheDocument();
  });

  it('shows WZ progress text while generateWzPending and wzProgress set', () => {
    render(
      <OrdersDaySummary
        orders={[makeOrder()]}
        deliveryEnabled
        wzSelectionMode
        selectedIds={['a', 'b']}
        selectedCount={2}
        confirmedCount={2}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending
        wzProgress={{ current: 2, total: 5 }}
      />,
    );
    expect(screen.getByText('WZ (2/5)…')).toBeInTheDocument();
  });

  it('Utwórz WZ button disabled when selectedCount=0', () => {
    render(
      <OrdersDaySummary
        orders={[makeOrder()]}
        deliveryEnabled
        wzSelectionMode
        selectedCount={0}
        confirmedCount={1}
        onConfirmWzSelection={noop}
        onCancelWzSelection={noop}
        generateWzPending={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Utwórz WZ (0)' })).toBeDisabled();
  });
});

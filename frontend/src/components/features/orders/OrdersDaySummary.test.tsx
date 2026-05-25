/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersDaySummary } from './OrdersDaySummary';
import type { Order, OrderItem } from '@/types';

function makeLine(over: Partial<OrderItem> & Pick<OrderItem, 'id' | 'product_id' | 'product_name'>): OrderItem {
  return {
    product_unit: 'szt.',
    quantity: '1',
    quantity_delivered: '0',
    quantity_returned: '0',
    unit_price_net: '10',
    unit_price_gross: '12.30',
    vat_rate: '23',
    discount_percent: '0',
    line_total_net: '10',
    line_total_gross: '12.30',
    ...over,
  };
}

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

describe('OrdersDaySummary', () => {
  it('shows compact strip: Suma pozycji, Suma (day total), and Podsumowanie toggle', () => {
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({ id: 'a', customer_name: 'A', total_gross: '10.50', items: [] }),
          makeOrder({ id: 'b', customer_name: 'B', total_gross: '20.00', items: [] }),
          makeOrder({ id: 'c', customer_name: 'C', total_gross: '5.00', items: [] }),
        ]}
      />,
    );
    expect(screen.getByText('Suma pozycji')).toBeInTheDocument();
    expect(screen.getByText('Podsumowanie')).toBeInTheDocument();
    expect(screen.getByText('Suma pozycji').closest('div')?.textContent).toMatch(/0[,.]00/);
    const compactStrip = screen.getByText('Suma pozycji').closest('.space-y-1');
    expect(compactStrip?.textContent).toMatch(/35[,.]50/);
    expect(screen.getByRole('button', { name: /Podsumowanie, Brak produktów/i })).toBeInTheDocument();
  });

  it('shows Zwrot row when quantity_returned > 0', () => {
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({
            total_gross: '100.00',
            items: [
              makeLine({
                id: 'l1',
                product_id: 'p1',
                product_name: 'Kartacze',
                quantity: '10',
                quantity_returned: '2',
                line_total_gross: '100',
              }),
            ],
          }),
        ]}
      />,
    );
    const compact = screen.getByText('Suma pozycji').closest('.space-y-1');
    expect(compact).toBeTruthy();
    expect(within(compact as HTMLElement).getByText('Zwrot')).toBeInTheDocument();
  });

  it('clicking Podsumowanie toggles expanded state', async () => {
    const user = userEvent.setup();
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({
            customer_name: 'Jeden Sklep',
            total_gross: '12.30',
            items: [
              makeLine({
                id: 'l1',
                product_id: 'p-1',
                product_name: 'Mąka',
                quantity: '2',
                line_total_gross: '12.30',
              }),
            ],
          }),
        ]}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Podsumowanie, 1 produkt/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('cell', { name: 'Mąka' })).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expanded state merges lines by product_id', async () => {
    const user = userEvent.setup();
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({
            id: '1',
            customer_name: 'Alfa',
            total_gross: '30.00',
            items: [
              makeLine({
                id: 'a1',
                product_id: 'milk',
                product_name: 'Mleko',
                quantity: '2',
                line_total_gross: '20.00',
              }),
            ],
          }),
          makeOrder({
            id: '2',
            customer_name: 'Beta',
            total_gross: '10.00',
            items: [
              makeLine({
                id: 'b1',
                product_id: 'milk',
                product_name: 'Mleko',
                quantity: '1',
                line_total_gross: '10.00',
              }),
            ],
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Podsumowanie, 1 produkt/i }));

    expect(screen.getAllByRole('cell', { name: 'Mleko' })).toHaveLength(1);
  });

  it('expanded panel Razem matches lines subtotal', async () => {
    const user = userEvent.setup();
    render(
      <OrdersDaySummary
        orders={[
          makeOrder({
            id: '1',
            customer_name: 'S1',
            total_gross: '100.00',
            items: [
              makeLine({
                id: 'l1',
                product_id: 'p1',
                product_name: 'A',
                line_total_gross: '60',
              }),
              makeLine({
                id: 'l2',
                product_id: 'p2',
                product_name: 'B',
                line_total_gross: '40',
              }),
            ],
          }),
          makeOrder({
            id: '2',
            customer_name: 'S2',
            total_gross: '50.50',
            items: [
              makeLine({
                id: 'l3',
                product_id: 'p3',
                product_name: 'C',
                line_total_gross: '50.50',
              }),
            ],
          }),
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Podsumowanie, 3 produkty/i }));
    const panel = document.getElementById('orders-day-summary-panel');
    expect(panel?.textContent).toMatch(/150[,.]50/);
  });
});

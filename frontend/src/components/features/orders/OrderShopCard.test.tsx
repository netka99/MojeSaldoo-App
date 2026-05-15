/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderShopCard } from './OrderShopCard';
import type { Order, OrderItem, OrderStatus } from '@/types';

function makeLine(over: Partial<OrderItem> & Pick<OrderItem, 'id' | 'product_name'>): OrderItem {
  return {
    product_id: 'p-1',
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
    status: 'delivered',
    subtotal_net: '100.00',
    subtotal_gross: '123.00',
    discount_percent: '0',
    discount_amount: '0',
    total_net: '100.00',
    total_gross: '219.00',
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

describe('OrderShopCard', () => {
  it('renders customer name', () => {
    render(<OrderShopCard order={makeOrder({ customer_name: 'Sklep Testowy' })} onClick={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Sklep Testowy' })).toBeInTheDocument();
  });

  it('renders total gross formatted in PLN', () => {
    render(<OrderShopCard order={makeOrder({ total_gross: '219.00' })} onClick={() => {}} />);
    expect(screen.getByText(/219/)).toBeInTheDocument();
    expect(screen.getByText(/zł|PLN/i)).toBeInTheDocument();
  });

  it('renders all line items (not capped at 3)', () => {
    const items = [1, 2, 3, 4, 5].map((n) =>
      makeLine({
        id: `line-${n}`,
        product_id: `p-${n}`,
        product_name: `Produkt ${n}`,
        quantity: String(n),
        line_total_gross: `${n * 10}.00`,
      }),
    );
    render(<OrderShopCard order={makeOrder({ items })} onClick={() => {}} />);
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByText(new RegExp(`Produkt ${n}`))).toBeInTheDocument();
    }
    expect(screen.queryByText(/więcej/i)).not.toBeInTheDocument();
  });

  it('does not render checkbox when isSelectable=false', () => {
    render(<OrderShopCard order={makeOrder()} onClick={() => {}} isSelectable={false} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('does not render checkbox when isSelectable is omitted', () => {
    render(<OrderShopCard order={makeOrder()} onClick={() => {}} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('checkbox uses order number in aria-label when selectable', () => {
    render(
      <OrderShopCard
        order={makeOrder({ order_number: 'ZAM/2026/999', status: 'confirmed' })}
        onClick={() => {}}
        isSelectable
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-label', 'Zaznacz zamówienie ZAM/2026/999');
  });

  it('renders checkbox when isSelectable=true, reflects isSelected', () => {
    const { rerender } = render(
      <OrderShopCard
        order={makeOrder()}
        onClick={() => {}}
        isSelectable
        isSelected
        onSelect={() => {}}
      />,
    );
    const cb = screen.getByRole('checkbox');
    expect(cb).toBeChecked();
    expect(cb).toHaveAttribute('aria-checked', 'true');

    rerender(
      <OrderShopCard
        order={makeOrder()}
        onClick={() => {}}
        isSelectable
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking checkbox calls onSelect with order id, does NOT call onClick', async () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <OrderShopCard
        order={makeOrder({ id: 'order-xyz' })}
        onClick={onClick}
        isSelectable
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole('checkbox'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('order-xyz');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not call onSelect when selectionDisabled', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <OrderShopCard
        order={makeOrder()}
        onClick={() => {}}
        isSelectable
        selectionDisabled
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    const cb = screen.getByRole('checkbox');
    expect(cb).toBeDisabled();
    await user.click(cb);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keyboard Enter on card calls onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<OrderShopCard order={makeOrder()} onClick={onClick} />);
    const card = screen.getByRole('button', { name: /Sklep ABC/i });
    card.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('status badge text matches order status', () => {
    const cases: [OrderStatus, string][] = [
      ['draft', 'Szkic'],
      ['confirmed', 'Potwierdzone'],
      ['delivered', 'Dostarczone'],
      ['cancelled', 'Anulowane'],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<OrderShopCard order={makeOrder({ status })} onClick={() => {}} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('calls onClick when card is pressed', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<OrderShopCard order={makeOrder()} onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: /Sklep ABC/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses accessible name containing customer name', () => {
    render(<OrderShopCard order={makeOrder({ customer_name: 'Punkt Partner' })} onClick={() => {}} />);
    const card = screen.getByRole('button', { name: /Punkt Partner/ });
    expect(card).toHaveAccessibleName(/Zamówienie Punkt Partner/);
  });

  it('keyboard Space triggers onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<OrderShopCard order={makeOrder()} onClick={onClick} />);
    const card = screen.getByRole('button', { name: /Sklep ABC/i });
    card.focus();
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

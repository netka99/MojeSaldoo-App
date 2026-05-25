/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderDayDateNav } from './OrderDayDateNav';

describe('OrderDayDateNav', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders formatted Polish date for given ISO date', () => {
    render(<OrderDayDateNav date="2026-05-12" onChange={() => {}} />);
    const live = screen.getByText(/maja/i).closest('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
    expect(live?.textContent?.toLowerCase()).toContain('wtorek');
    expect(live?.textContent?.toLowerCase()).toContain('12');
    expect(live?.textContent?.toLowerCase()).toContain('maja');
  });

  it('clicking ‹ calls onChange with date minus 1 day', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrderDayDateNav date="2026-05-13" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Poprzedni dzień' }));
    expect(onChange).toHaveBeenCalledWith('2026-05-12');
  });

  it('clicking › calls onChange with date plus 1 day', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrderDayDateNav date="2026-05-13" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Następny dzień' }));
    expect(onChange).toHaveBeenCalledWith('2026-05-14');
  });

  it('keyboard left arrow triggers previous day', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrderDayDateNav date="2026-05-13" onChange={onChange} />);
    const nav = screen.getByRole('navigation', { name: 'Nawigacja dnia dostawy' });
    nav.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('2026-05-12');
  });

  it('keyboard right arrow triggers next day', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OrderDayDateNav date="2026-05-13" onChange={onChange} />);
    const nav = screen.getByRole('navigation', { name: 'Nawigacja dnia dostawy' });
    nav.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('2026-05-14');
  });

  it('changing the native date input calls onChange with ISO date', () => {
    const onChange = vi.fn();
    render(<OrderDayDateNav date="2026-05-13" onChange={onChange} />);
    const input = screen.getByDisplayValue('2026-05-13');
    fireEvent.change(input, { target: { value: '2026-07-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-07-01');
  });

  it('aria-live region updates when date prop changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OrderDayDateNav date="2026-05-12" onChange={onChange} />);
    const polite = screen.getByRole('button', { name: /maja/i }).querySelector('[aria-live="polite"]');
    expect(polite?.textContent?.toLowerCase()).toMatch(/12/);

    rerender(<OrderDayDateNav date="2026-05-20" onChange={onChange} />);
    const politeUpdated = screen.getByRole('button', { name: /maja/i }).querySelector('[aria-live="polite"]');
    expect(politeUpdated?.textContent?.toLowerCase()).toMatch(/20/);
  });
});

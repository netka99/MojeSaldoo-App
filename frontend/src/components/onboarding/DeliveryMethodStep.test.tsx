// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DeliveryMethodStep } from './DeliveryMethodStep';

describe('DeliveryMethodStep', () => {
  it('renders all 3 delivery method options', () => {
    render(<DeliveryMethodStep onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getByText('Jeżdżę w trasie')).toBeInTheDocument();
    expect(screen.getByText('Wysyłam lub klient odbiera')).toBeInTheDocument();
    expect(screen.getByText('Tylko dokumenty')).toBeInTheDocument();
  });

  it('calls onSelect with van_routes when first option is clicked', async () => {
    const onSelect = vi.fn();
    render(<DeliveryMethodStep onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(screen.getByText('Jeżdżę w trasie'));
    expect(onSelect).toHaveBeenCalledWith('van_routes');
  });

  it('calls onSelect with delivery when second option is clicked', async () => {
    const onSelect = vi.fn();
    render(<DeliveryMethodStep onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(screen.getByText('Wysyłam lub klient odbiera'));
    expect(onSelect).toHaveBeenCalledWith('delivery');
  });

  it('calls onSelect with docs_only when third option is clicked', async () => {
    const onSelect = vi.fn();
    render(<DeliveryMethodStep onSelect={onSelect} onBack={() => {}} />);
    await userEvent.click(screen.getByText('Tylko dokumenty'));
    expect(onSelect).toHaveBeenCalledWith('docs_only');
  });

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn();
    render(<DeliveryMethodStep onSelect={() => {}} onBack={onBack} />);
    await userEvent.click(screen.getByText('← Wróć'));
    expect(onBack).toHaveBeenCalled();
  });
});

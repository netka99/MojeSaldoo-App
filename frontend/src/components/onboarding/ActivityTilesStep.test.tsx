// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ActivityTilesStep } from './ActivityTilesStep';

describe('ActivityTilesStep', () => {
  it('renders all 4 activity tiles', () => {
    render(<ActivityTilesStep selected={[]} onChange={() => {}} onNext={() => {}} />);
    expect(screen.getByText('Kupuję towar')).toBeInTheDocument();
    expect(screen.getByText('Produkuję z surowców')).toBeInTheDocument();
    expect(screen.getByText('Prowadzę magazyn')).toBeInTheDocument();
    expect(screen.getByText('Opisuję koszty dla księgowego')).toBeInTheDocument();
  });

  it('renders the always-active invoicing tile as locked', () => {
    render(<ActivityTilesStep selected={[]} onChange={() => {}} onNext={() => {}} />);
    expect(screen.getByText('Wystawiam faktury')).toBeInTheDocument();
    // The locked-badge text reads "zawsze ✓"
    expect(screen.getAllByText(/zawsze/).length).toBeGreaterThan(0);
  });

  it('calls onChange when a tile is clicked', async () => {
    const onChange = vi.fn();
    render(<ActivityTilesStep selected={[]} onChange={onChange} onNext={() => {}} />);
    await userEvent.click(screen.getByText('Kupuję towar'));
    expect(onChange).toHaveBeenCalledWith(['purchasing']);
  });

  it('removes a tile from selection when clicked again', async () => {
    const onChange = vi.fn();
    render(<ActivityTilesStep selected={['purchasing']} onChange={onChange} onNext={() => {}} />);
    await userEvent.click(screen.getByText('Kupuję towar'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('marks selected tiles with aria-pressed=true', () => {
    render(<ActivityTilesStep selected={['production']} onChange={() => {}} onNext={() => {}} />);
    const productionBtn = screen.getByRole('button', { name: /Produkuję z surowców/i });
    expect(productionBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onNext when the Dalej button is clicked', async () => {
    const onNext = vi.fn();
    render(<ActivityTilesStep selected={[]} onChange={() => {}} onNext={onNext} />);
    await userEvent.click(screen.getByText('Dalej →'));
    expect(onNext).toHaveBeenCalled();
  });
});

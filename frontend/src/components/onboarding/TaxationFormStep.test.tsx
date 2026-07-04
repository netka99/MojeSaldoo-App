/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaxationFormStep } from './TaxationFormStep';

function renderStep(overrides?: Partial<Parameters<typeof TaxationFormStep>[0]>) {
  const onChange = vi.fn();
  const onNext = vi.fn();
  const onBack = vi.fn();
  render(
    <TaxationFormStep
      taxationForm="kpir"
      ryczaltCategory={null}
      onChange={onChange}
      onNext={onNext}
      onBack={onBack}
      {...overrides}
    />,
  );
  return { onChange, onNext, onBack };
}

describe('TaxationFormStep', () => {
  it('renders both KPiR and Ryczałt options', () => {
    renderStep();
    expect(screen.getByRole('button', { name: /KPiR/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ryczałt/i })).toBeInTheDocument();
  });

  it('does not show ryczałt rate options when KPiR is selected', () => {
    renderStep({ taxationForm: 'kpir' });
    expect(screen.queryByText(/Wybierz stawkę ryczałtu/i)).not.toBeInTheDocument();
  });

  it('shows ryczałt rate options when Ryczałt is selected', () => {
    renderStep({ taxationForm: 'ryczalt' });
    expect(screen.getByText(/Wybierz stawkę ryczałtu/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Usługi/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Handel/i })).toBeInTheDocument();
  });

  it('calls onChange with ryczalt when ryczałt button clicked', async () => {
    const { onChange } = renderStep({ taxationForm: 'kpir' });
    await userEvent.click(screen.getByRole('button', { name: /Ryczałt/i }));
    expect(onChange).toHaveBeenCalledWith('ryczalt', null);
  });

  it('calls onChange with kpir and null category when KPiR clicked', async () => {
    const { onChange } = renderStep({ taxationForm: 'ryczalt', ryczaltCategory: 'uslugi' });
    await userEvent.click(screen.getByRole('button', { name: /KPiR/i }));
    expect(onChange).toHaveBeenCalledWith('kpir', null);
  });

  it('calls onChange with selected category when rate clicked', async () => {
    const { onChange } = renderStep({ taxationForm: 'ryczalt', ryczaltCategory: null });
    const handlerBtn = screen.getByRole('button', { name: /Handel/i });
    await userEvent.click(handlerBtn);
    expect(onChange).toHaveBeenCalledWith('ryczalt', 'handel');
  });

  it('Dalej button is disabled when KPiR not confirmed (should not happen) but works for kpir', async () => {
    const { onNext } = renderStep({ taxationForm: 'kpir' });
    const dalej = screen.getByRole('button', { name: /Dalej/i });
    expect(dalej).not.toBeDisabled();
    await userEvent.click(dalej);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('Dalej button is disabled for ryczałt with no category selected', () => {
    renderStep({ taxationForm: 'ryczalt', ryczaltCategory: null });
    expect(screen.getByRole('button', { name: /Dalej/i })).toBeDisabled();
  });

  it('Dalej button is enabled for ryczałt with category selected', () => {
    renderStep({ taxationForm: 'ryczalt', ryczaltCategory: 'uslugi' });
    expect(screen.getByRole('button', { name: /Dalej/i })).not.toBeDisabled();
  });

  it('calls onBack when back button clicked', async () => {
    const { onBack } = renderStep();
    await userEvent.click(screen.getByRole('button', { name: /Wróć/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

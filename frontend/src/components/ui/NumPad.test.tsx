/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { NumPad } from './NumPad';

function ControlledNumPad({
  initial = '0',
  maxDecimals,
  label,
}: {
  initial?: string;
  maxDecimals?: number;
  label?: string;
} = {}) {
  const [value, setValue] = useState(initial);
  return (
    <NumPad
      value={value}
      onChange={setValue}
      onConfirm={() => {}}
      maxDecimals={maxDecimals}
      label={label}
    />
  );
}

describe('NumPad', () => {
  it('renders all digit buttons', () => {
    render(<ControlledNumPad />);
    for (let d = 0; d <= 9; d += 1) {
      expect(screen.getByRole('button', { name: String(d) })).toBeInTheDocument();
    }
  });

  it('tapping digits appends to value', async () => {
    const user = userEvent.setup();
    render(<ControlledNumPad initial="0" />);
    const display = screen.getByRole('status');
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(within(display).getByText('1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(within(display).getByText('12')).toBeInTheDocument();
  });

  it('tapping "." inserts decimal, can\'t insert twice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Wrap() {
      const [v, setV] = useState('0');
      return (
        <NumPad
          value={v}
          onChange={(nv) => {
            onChange(nv);
            setV(nv);
          }}
          onConfirm={() => {}}
        />
      );
    }
    render(<Wrap />);
    await user.click(screen.getByRole('button', { name: '.' }));
    expect(onChange).toHaveBeenLastCalledWith('0.');
    await user.click(screen.getByRole('button', { name: '.' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('leading dot becomes "0."', async () => {
    const user = userEvent.setup();
    render(<ControlledNumPad initial="" />);
    await user.click(screen.getByRole('button', { name: '.' }));
    expect(within(screen.getByRole('status')).getByText('0.')).toBeInTheDocument();
  });

  it('backspace removes last character', async () => {
    const user = userEvent.setup();
    render(<ControlledNumPad initial="123" />);
    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(within(screen.getByRole('status')).getByText('12')).toBeInTheDocument();
  });

  it('backspace on single digit resets to "0"', async () => {
    const user = userEvent.setup();
    render(<ControlledNumPad initial="5" />);
    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(within(screen.getByRole('status')).getByText('0')).toBeInTheDocument();
  });

  it('tapping OK calls onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <NumPad value="0" onChange={() => {}} onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('label is rendered when provided', () => {
    render(<ControlledNumPad label="Ilość: Chleb tostowy" />);
    expect(screen.getByText('Ilość: Chleb tostowy')).toBeInTheDocument();
  });

  it('value exceeding maxDecimals ignores extra digits after decimal', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Wrap() {
      const [v, setV] = useState('1.234');
      return (
        <NumPad
          value={v}
          maxDecimals={3}
          onChange={(nv) => {
            onChange(nv);
            setV(nv);
          }}
          onConfirm={() => {}}
        />
      );
    }
    render(<Wrap />);
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(screen.getByRole('status')).getByText('1.234')).toBeInTheDocument();
  });
});

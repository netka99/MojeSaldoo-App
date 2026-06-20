import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface NumPadProps {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  /** Maximum digits after the decimal separator (default 3). */
  maxDecimals?: number;
  /** Optional heading above the value display, e.g. product line context. */
  label?: string;
}

function tryAppendDigit(current: string, digit: string, maxDecimals: number): string | null {
  if (!/^\d$/.test(digit)) return null;
  const dot = current.indexOf('.');
  if (dot >= 0) {
    const decimals = current.length - dot - 1;
    if (decimals >= maxDecimals) return null;
    return `${current}${digit}`;
  }
  if (current === '0') return digit;
  if (current === '') return digit;
  return `${current}${digit}`;
}

function tryAppendDot(current: string): string | null {
  if (current.includes('.')) return null;
  if (current === '' || current === '0') return '0.';
  return `${current}.`;
}

function applyBackspace(current: string): string {
  if (current.length <= 1) return '0';
  const next = current.slice(0, -1);
  return next === '' ? '0' : next;
}

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'delete'],
] as const;

function DeleteIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NumPad({ value, onChange, onConfirm, maxDecimals = 3, label }: NumPadProps) {
  const onDigit = (d: string) => {
    const next = tryAppendDigit(value, d, maxDecimals);
    if (next !== null && next !== value) onChange(next);
  };

  const onDot = () => {
    const next = tryAppendDot(value);
    if (next !== null && next !== value) onChange(next);
  };

  const onBackspace = () => {
    onChange(applyBackspace(value));
  };

  const handleKeyPress = (key: string) => {
    if (key === 'delete') {
      onBackspace();
    } else if (key === '.') {
      onDot();
    } else {
      onDigit(key);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {label ? <p className="text-sm font-medium text-muted-foreground">{label}</p> : null}
      <div
        role="status"
        className="sr-only"
        aria-live="polite"
      >
        {value === '' ? '0' : value}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEY_ROWS.flat().map((key) => (
          <motion.button
            key={key}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => handleKeyPress(key)}
            className="numpad-btn h-14"
            aria-label={key === 'delete' ? 'Cofnij' : key}
          >
            {key === 'delete' ? <DeleteIcon /> : key}
          </motion.button>
        ))}
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        onClick={onConfirm}
        className={cn('numpad-btn-action col-span-3 mt-0.5 h-14 w-full')}
      >
        OK
      </motion.button>
    </div>
  );
}

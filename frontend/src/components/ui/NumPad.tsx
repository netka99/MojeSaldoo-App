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

const digitKey = cn(
  'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-surface-card text-lg font-semibold text-foreground',
  'shadow-sm ring-1 ring-black/[0.06] transition-colors hover:bg-muted/50 active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

const okKey = cn(
  'col-start-4 row-start-3 row-span-2 flex min-h-[calc(44px*2+0.5rem)] min-w-[44px] items-center justify-center rounded-xl',
  'bg-primary text-base font-bold text-primary-foreground shadow-sm transition-colors',
  'hover:bg-primary/90 active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

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

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      {label ? <p className="text-sm font-medium text-muted-foreground">{label}</p> : null}
      <div
        role="status"
        className="rounded-2xl border border-border/60 bg-surface-low/50 px-3 py-3 text-right font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground"
        aria-live="polite"
      >
        {value === '' ? '\u00a0' : value}
      </div>

      <div className="grid grid-cols-4 grid-rows-4 gap-2">
        <button type="button" className={cn(digitKey, 'col-start-1 row-start-1')} onClick={() => onDigit('7')}>
          7
        </button>
        <button type="button" className={cn(digitKey, 'col-start-2 row-start-1')} onClick={() => onDigit('8')}>
          8
        </button>
        <button type="button" className={cn(digitKey, 'col-start-3 row-start-1')} onClick={() => onDigit('9')}>
          9
        </button>
        <button
          type="button"
          className={cn(
            digitKey,
            'col-start-4 row-start-1 row-span-2 min-h-[calc(44px*2+0.5rem)] text-xl',
          )}
          aria-label="Cofnij"
          onClick={onBackspace}
        >
          ←
        </button>

        <button type="button" className={cn(digitKey, 'col-start-1 row-start-2')} onClick={() => onDigit('4')}>
          4
        </button>
        <button type="button" className={cn(digitKey, 'col-start-2 row-start-2')} onClick={() => onDigit('5')}>
          5
        </button>
        <button type="button" className={cn(digitKey, 'col-start-3 row-start-2')} onClick={() => onDigit('6')}>
          6
        </button>

        <button type="button" className={cn(digitKey, 'col-start-1 row-start-3')} onClick={() => onDigit('1')}>
          1
        </button>
        <button type="button" className={cn(digitKey, 'col-start-2 row-start-3')} onClick={() => onDigit('2')}>
          2
        </button>
        <button type="button" className={cn(digitKey, 'col-start-3 row-start-3')} onClick={() => onDigit('3')}>
          3
        </button>
        <button type="button" className={okKey} onClick={onConfirm}>
          OK
        </button>

        <button type="button" className={cn(digitKey, 'col-start-1 row-start-4')} onClick={onDot}>
          .
        </button>
        <button type="button" className={cn(digitKey, 'col-start-2 row-start-4')} onClick={() => onDigit('0')}>
          0
        </button>
        <div className="col-start-3 row-start-4 min-h-[44px] min-w-[44px] rounded-xl bg-transparent" aria-hidden />
      </div>
    </div>
  );
}

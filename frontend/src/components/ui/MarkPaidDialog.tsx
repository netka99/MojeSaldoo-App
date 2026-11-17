import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';

interface MarkPaidDialogProps {
  open: boolean;
  defaultDate: string; // ISO date string YYYY-MM-DD
  onConfirm: (paidAt: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function MarkPaidDialog({
  open,
  defaultDate,
  onConfirm,
  onCancel,
  isPending = false,
}: MarkPaidDialogProps) {
  const [date, setDate] = useState(defaultDate);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDate(defaultDate);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      aria-modal="true"
      role="dialog"
      aria-labelledby="mark-paid-dialog-title"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative z-10 w-full max-w-sm rounded-3xl bg-white p-6 shadow-apple-float sm:mx-4">
        <h2 id="mark-paid-dialog-title" className="text-base font-semibold text-slate-900">
          Data płatności
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Kiedy wpłynęła płatność? Data jest używana do raportów miesięcznych.
        </p>

        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-800">
            Data płatności
          </label>
          <input
            ref={inputRef}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="date-pill w-full"
          />
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Anuluj
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(date)}
            disabled={!date || isPending}
            loading={isPending}
          >
            Oznacz jako opłaconą
          </Button>
        </div>
      </div>
    </div>
  );
}

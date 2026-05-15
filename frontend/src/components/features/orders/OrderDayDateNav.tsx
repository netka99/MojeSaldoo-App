import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export type OrderDayDateNavProps = {
  date: string;
  onChange: (date: string) => void;
};

function parseLocalDate(iso: string): Date | null {
  const trimmed = iso.trim();
  const cal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (cal) {
    const y = Number(cal[1]);
    const m = Number(cal[2]) - 1;
    const day = Number(cal[3]);
    const d = new Date(y, m, day);
    if (d.getFullYear() !== y || d.getMonth() !== m || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayIsoLocal(): string {
  return toIsoLocal(new Date());
}

function shiftIsoDate(iso: string, deltaDays: number): string | null {
  const d = parseLocalDate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + deltaDays);
  return toIsoLocal(d);
}

function formatDayNavLabel(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return '—';
  const raw = new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const ctrlBtn = cn(
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-input bg-background',
  'text-base font-medium text-foreground shadow-sm',
  'ring-offset-background transition-colors hover:bg-muted/60',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

export function OrderDayDateNav({ date, onChange }: OrderDayDateNavProps) {
  const goPrev = () => {
    const next = shiftIsoDate(date, -1);
    if (next) onChange(next);
  };

  const goNext = () => {
    const next = shiftIsoDate(date, 1);
    if (next) onChange(next);
  };

  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    }
  };

  return (
    <nav
      className="flex items-center justify-center gap-2 sm:gap-3"
      tabIndex={0}
      onKeyDownCapture={onKeyDownCapture}
      aria-label="Nawigacja dnia dostawy"
    >
      <button type="button" className={ctrlBtn} aria-label="Poprzedni dzień" onClick={goPrev}>
        ‹
      </button>
      <button
        type="button"
        className={cn(
          'min-w-0 rounded-2xl border border-transparent px-4 py-2 text-center text-base font-semibold text-foreground',
          'ring-offset-background hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        onClick={() => onChange(todayIsoLocal())}
      >
        <span aria-live="polite">{formatDayNavLabel(date)}</span>
      </button>
      <button type="button" className={ctrlBtn} aria-label="Następny dzień" onClick={goNext}>
        ›
      </button>
    </nav>
  );
}

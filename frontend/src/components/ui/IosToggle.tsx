import { cn } from '@/lib/utils';

export interface IosToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
  /** Row inside an existing card, without its own surface. */
  embedded?: boolean;
}

export function IosToggle({ checked, onChange, label, description, disabled, embedded = false }: IosToggleProps) {
  return (
    <div className={cn(
      'flex items-center justify-between gap-3',
      !embedded && 'shadow-soft rounded-2xl bg-surface-card p-4',
    )}>
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', embedded ? 'text-slate-800' : 'text-foreground')}>{label}</p>
        <p className={cn('mt-0.5 text-xs', embedded ? 'text-slate-500' : 'text-muted-foreground')}>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ease-out',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}

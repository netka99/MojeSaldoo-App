import { cn } from '@/lib/utils';
import { ALWAYS_ON_MODULES, MODULE_LABELS } from '@/types/onboarding.types';

interface ModuleSummaryStepProps {
  modules: Record<string, boolean>;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
}

export function ModuleSummaryStep({ modules, onConfirm, onBack, loading }: ModuleSummaryStepProps) {
  const enabled = Object.entries(modules)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort((a, b) => {
      // Always-on modules first, then alphabetical.
      const aCore = ALWAYS_ON_MODULES.includes(a);
      const bCore = ALWAYS_ON_MODULES.includes(b);
      if (aCore !== bCore) return aCore ? -1 : 1;
      return a.localeCompare(b);
    });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Twój zestaw gotowy ✓
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Na podstawie Twoich odpowiedzi aktywowaliśmy te moduły. Możesz zmienić to później w{' '}
          <span className="font-medium">Ustawienia → Moduły</span>.
        </p>
      </div>

      <ul className="space-y-2">
        {enabled.map((key) => (
          <li
            key={key}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
              ALWAYS_ON_MODULES.includes(key)
                ? 'border-border bg-muted/30 text-muted-foreground'
                : 'border-primary/20 bg-primary/5 text-foreground',
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                ALWAYS_ON_MODULES.includes(key)
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              ✓
            </span>
            <span className="font-medium">
              {MODULE_LABELS[key] ?? key}
            </span>
            {ALWAYS_ON_MODULES.includes(key) && (
              <span className="ml-auto text-xs text-muted-foreground">zawsze</span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {loading ? 'Zapisuję…' : 'Zacznij korzystać →'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none"
        >
          ← Wróć
        </button>
      </div>
    </div>
  );
}

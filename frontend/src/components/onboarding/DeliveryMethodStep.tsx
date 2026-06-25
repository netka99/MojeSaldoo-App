import { cn } from '@/lib/utils';
import type { DeliveryMethod } from '@/types/onboarding.types';

interface MethodConfig {
  key: DeliveryMethod;
  icon: string;
  title: string;
  description: string;
}

const METHODS: MethodConfig[] = [
  {
    key: 'van_routes',
    icon: '🚐',
    title: 'Jeżdżę w trasie',
    description: 'Ładuję auto z magazynu, wystawiam WZ u klienta na miejscu, rozliczam trasę wieczorem.',
  },
  {
    key: 'delivery',
    icon: '📦',
    title: 'Wysyłam lub klient odbiera',
    description: 'Klienci zamawiają telefonicznie lub mailowo — wysyłam kurierem albo odbierają osobiście.',
  },
  {
    key: 'docs_only',
    icon: '🚗',
    title: 'Dostarczam sam / bez stałej trasy',
    description: 'Wożę towary do klientów osobiście lub sporadycznie — bez ładowania z magazynu na auto i rozliczania trasy.',
  },
];

interface DeliveryMethodStepProps {
  onSelect: (method: DeliveryMethod) => void;
  onBack: () => void;
}

export function DeliveryMethodStep({ onSelect, onBack }: DeliveryMethodStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Jak docierasz do klientów?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wybierz jeden — decyduje czy potrzebujesz rozliczania tras i ładowania vana.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {METHODS.map((method) => (
          <button
            key={method.key}
            type="button"
            onClick={() => onSelect(method.key)}
            className={cn(
              'flex items-start gap-4 rounded-xl border-2 border-border bg-background p-4 text-left',
              'transition-all hover:border-primary/50 hover:bg-muted/30',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <span className="mt-0.5 text-2xl leading-none shrink-0">{method.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{method.title}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{method.description}</p>
            </div>
            <span className="ml-auto shrink-0 self-center text-muted-foreground/40">›</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none"
      >
        ← Wróć
      </button>
    </div>
  );
}

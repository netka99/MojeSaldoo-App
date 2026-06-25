import { cn } from '@/lib/utils';
import type { ActivityTile } from '@/types/onboarding.types';

interface TileConfig {
  key: ActivityTile;
  icon: string;
  title: string;
  description: string;
}

const TILES: TileConfig[] = [
  {
    key: 'purchasing',
    icon: '🛒',
    title: 'Kupuję towar',
    description: 'Przyjmuję faktury od dostawców, tworzę PZ, prowadzę stany zakupowe.',
  },
  {
    key: 'production',
    icon: '🛠️',
    title: 'Produkuję z surowców',
    description: 'Mam receptury, tworzę zlecenia produkcji, system liczy koszt/szt.',
  },
  {
    key: 'warehouses',
    icon: '🏪',
    title: 'Prowadzę magazyn',
    description: 'Śledzę stany, przeprowadzam inwentaryzacje, zarządzam kilkoma magazynami.',
  },
  {
    key: 'cost_allocation',
    icon: '💼',
    title: 'Opisuję koszty dla księgowego',
    description: 'Opisuję faktury zakupowe, eksportuję adnotacje kosztowe do biura rachunkowego.',
  },
];

interface ActivityTilesStepProps {
  selected: ActivityTile[];
  onChange: (tiles: ActivityTile[]) => void;
  onNext: () => void;
}

export function ActivityTilesStep({ selected, onChange, onNext }: ActivityTilesStepProps) {
  function toggle(key: ActivityTile) {
    onChange(
      selected.includes(key) ? selected.filter((t) => t !== key) : [...selected, key],
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Co robi Twoja firma?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Zaznacz wszystko co pasuje — możesz wybrać kilka.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TILES.map((tile) => {
          const isSelected = selected.includes(tile.key);
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => toggle(tile.key)}
              aria-pressed={isSelected}
              className={cn(
                'flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-background hover:border-primary/40 hover:bg-muted/40',
              )}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span className="text-2xl leading-none">{tile.icon}</span>
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40',
                  )}
                >
                  {isSelected ? '✓' : ''}
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground">{tile.title}</p>
              <p className="text-xs leading-snug text-muted-foreground">{tile.description}</p>
            </button>
          );
        })}
      </div>

      {/* Always-active invoicing tile — locked */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <span className="text-xl">📋</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Wystawiam faktury</p>
          <p className="text-xs text-muted-foreground">Fakturowanie i KSeF — zawsze aktywne dla każdej firmy</p>
        </div>
        <span className="text-xs font-medium text-muted-foreground">zawsze ✓</span>
      </div>

      <button
        type="button"
        onClick={onNext}
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Dalej →
      </button>
    </div>
  );
}

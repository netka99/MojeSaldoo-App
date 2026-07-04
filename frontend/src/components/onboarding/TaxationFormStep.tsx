import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { RyczaltCategory, TaxationForm } from '@/types/onboarding.types';

interface RyczaltOption {
  key: RyczaltCategory;
  rate: string;
  label: string;
  description: string;
}

const RYCZALT_OPTIONS: RyczaltOption[] = [
  { key: 'rolnicze',     rate: '2%',   label: 'Sprzedaż produktów rolnych',                  description: 'Własne produkty rolne w oryginalnej postaci' },
  { key: 'handel',       rate: '3%',   label: 'Handel — zakup i odsprzedaż',                 description: 'Kupuję gotowy towar i odsprzedaję bez przetwarzania' },
  { key: 'budownictwo',  rate: '5,5%', label: 'Budownictwo',                                 description: 'Roboty budowlane, montaż, instalacje' },
  { key: 'uslugi',       rate: '8,5%', label: 'Usługi',                                      description: 'Większość usług, wynajem nieruchomości' },
  { key: 'it',           rate: '12%',  label: 'Usługi IT i pośrednictwo finansowe',           description: 'Programowanie, konsulting IT, fintech' },
  { key: 'medyczne',     rate: '14%',  label: 'Usługi medyczne, architektoniczne, inżynieryjne', description: 'Lekarze, architekci, inżynierowie' },
  { key: 'finansowe',    rate: '15%',  label: 'Doradztwo finansowe i rachunkowość',           description: 'Doradcy finansowi, biura rachunkowe' },
  { key: 'wolne_zawody', rate: '17%',  label: 'Wolne zawody',                                description: 'Prawnicy, notariusze, tłumacze przysięgli' },
];

interface TaxationFormStepProps {
  taxationForm: TaxationForm;
  ryczaltCategory: RyczaltCategory | null;
  onChange: (form: TaxationForm, category: RyczaltCategory | null) => void;
  onNext: () => void;
  onBack: () => void;
}

export function TaxationFormStep({
  taxationForm,
  ryczaltCategory,
  onChange,
  onNext,
  onBack,
}: TaxationFormStepProps) {
  const [showRyczalt, setShowRyczalt] = useState(taxationForm === 'ryczalt');

  function selectKpir() {
    setShowRyczalt(false);
    onChange('kpir', null);
  }

  function selectRyczalt() {
    setShowRyczalt(true);
    onChange('ryczalt', ryczaltCategory);
  }

  function selectCategory(cat: RyczaltCategory) {
    onChange('ryczalt', cat);
  }

  const canContinue = taxationForm === 'kpir' || (taxationForm === 'ryczalt' && ryczaltCategory !== null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Forma opodatkowania
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wpływa na to, jakie raporty i moduły będą dostępne.
        </p>
      </div>

      {/* KPiR / Ryczałt toggle */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={selectKpir}
          aria-pressed={taxationForm === 'kpir'}
          className={cn(
            'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            taxationForm === 'kpir'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border bg-background hover:border-primary/40 hover:bg-muted/40',
          )}
        >
          <span className="text-2xl leading-none">📒</span>
          <p className="text-sm font-semibold text-foreground">KPiR</p>
          <p className="text-xs leading-snug text-muted-foreground">
            Podatkowa Księga Przychodów i Rozchodów
          </p>
        </button>

        <button
          type="button"
          onClick={selectRyczalt}
          aria-pressed={taxationForm === 'ryczalt'}
          className={cn(
            'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            taxationForm === 'ryczalt'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border bg-background hover:border-primary/40 hover:bg-muted/40',
          )}
        >
          <span className="text-2xl leading-none">🧾</span>
          <p className="text-sm font-semibold text-foreground">Ryczałt</p>
          <p className="text-xs leading-snug text-muted-foreground">
            Ryczałt ewidencjonowany
          </p>
        </button>
      </div>

      {/* Ryczałt rate selection */}
      {showRyczalt && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Wybierz stawkę ryczałtu</p>
          <div className="space-y-2">
            {RYCZALT_OPTIONS.map((opt) => {
              const isSelected = ryczaltCategory === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => selectCategory(opt.key)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-background hover:border-primary/40 hover:bg-muted/40',
                  )}
                >
                  <span className="w-10 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-center text-xs font-bold text-muted-foreground">
                    {opt.rate}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{opt.description}</p>
                  </div>
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
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ← Wróć
        </button>
        <button
          type="button"
          disabled={!canContinue}
          onClick={onNext}
          className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Dalej →
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  useCreateCompanyMutation,
  useMyCompaniesQuery,
  useSwitchCompanyMutation,
} from '@/query/use-companies';
import { useCompleteOnboardingMutation } from '@/query/use-onboarding';
import { authStorage } from '@/services/api';
import { ActivityTilesStep } from '@/components/onboarding/ActivityTilesStep';
import { DeliveryMethodStep } from '@/components/onboarding/DeliveryMethodStep';
import { ModuleSummaryStep } from '@/components/onboarding/ModuleSummaryStep';
import { TaxationFormStep } from '@/components/onboarding/TaxationFormStep';
import type { ActivityTile, DeliveryMethod, RyczaltCategory, TaxationForm } from '@/types/onboarding.types';
import { RYCZALT_SERVICE_CATEGORIES } from '@/types/onboarding.types';

// ── Client-side module preview (mirrors backend logic) ──────────────────────

const CORE_MODULES: string[] = [
  'invoicing', 'ksef', 'customers', 'orders', 'reporting', 'products',
];

const TILE_MODULE_MAP: Record<ActivityTile, string[]> = {
  purchasing:      ['purchasing', 'ksef_inbox'],
  production:      ['production', 'warehouses', 'products'],
  warehouses:      ['warehouses', 'products'],
  cost_allocation: ['cost_allocation', 'ksef_inbox'],
};

const DELIVERY_MODULE_MAP: Record<DeliveryMethod, string[]> = {
  van_routes: ['delivery', 'van_routes'],
  delivery:   ['delivery'],
  docs_only:  ['delivery'],
};

const ALL_MODULES = [
  'invoicing', 'ksef', 'ksef_inbox', 'customers', 'orders', 'reporting', 'products',
  'warehouses', 'purchasing', 'production', 'cost_allocation', 'delivery', 'van_routes',
];

function computeModulePreview(
  tiles: ActivityTile[],
  deliveryMethod: DeliveryMethod | null,
  taxationForm: TaxationForm,
  ryczaltCategory: RyczaltCategory | null,
): Record<string, boolean> {
  const enabled = new Set<string>(CORE_MODULES);
  tiles.forEach((t) => TILE_MODULE_MAP[t]?.forEach((m) => enabled.add(m)));
  if (deliveryMethod) {
    DELIVERY_MODULE_MAP[deliveryMethod]?.forEach((m) => enabled.add(m));
  }
  // Pure-service ryczałt companies don't need warehouse/van/production modules.
  if (taxationForm === 'ryczalt' && ryczaltCategory && RYCZALT_SERVICE_CATEGORIES.includes(ryczaltCategory)) {
    ['warehouses', 'van_routes', 'production', 'delivery', 'purchasing'].forEach((m) => enabled.delete(m));
  }
  return Object.fromEntries(ALL_MODULES.map((m) => [m, enabled.has(m)]));
}

// ── Progress dots ────────────────────────────────────────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-label={`Krok ${current + 1} z ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            i === current
              ? 'h-2 w-6 rounded-full bg-primary'
              : i < current
              ? 'h-2 w-2 rounded-full bg-primary/40'
              : 'h-2 w-2 rounded-full bg-muted-foreground/20'
          }
        />
      ))}
    </div>
  );
}

// ── Minimal company-name step ────────────────────────────────────────────────

interface CompanyNameStepProps {
  onNext: (name: string) => void;
  loading: boolean;
  error: string | null;
}

function CompanyNameStep({ onNext, loading, error }: CompanyNameStepProps) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Jak się nazywa Twoja firma?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Możesz podać pełną nazwę lub skróconą — zmienisz to później w ustawieniach.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="company-name" className="block text-sm font-medium text-foreground">
          Nazwa firmy
        </label>
        <input
          id="company-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && trimmed) onNext(trimmed); }}
          placeholder="np. Piekarnia Kowalski, Jan Nowak JDG"
          autoComplete="organization"
          autoFocus
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none ring-offset-background transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />
      </div>

      <button
        type="button"
        disabled={!trimmed || loading}
        onClick={() => { if (trimmed) onNext(trimmed); }}
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {loading ? 'Tworzę firmę…' : 'Dalej →'}
      </button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type OnboardingStep = 'company_name' | 'taxation' | 'activity' | 'delivery' | 'summary';

const NEEDS_DELIVERY: ActivityTile[] = ['purchasing', 'production', 'warehouses'];

export function OnboardingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const { data: myCompanies, isPending: companiesQueryPending, isSuccess, isError } = useMyCompaniesQuery();
  const [entryChecked, setEntryChecked] = useState(false);
  const [hasExistingCompany, setHasExistingCompany] = useState(false);

  // Check on first load whether the user already has a company.
  if (!entryChecked && (isSuccess || isError)) {
    if (isSuccess && (myCompanies?.length ?? 0) > 0) setHasExistingCompany(true);
    setEntryChecked(true);
  }

  const [step, setStep] = useState<OnboardingStep>('company_name');
  const [companyCreateError, setCompanyCreateError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<ActivityTile[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | null>(null);
  const [taxationForm, setTaxationForm] = useState<TaxationForm>('kpir');
  const [ryczaltCategory, setRyczaltCategory] = useState<RyczaltCategory | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isServiceRyczalt =
    taxationForm === 'ryczalt' &&
    ryczaltCategory !== null &&
    RYCZALT_SERVICE_CATEGORIES.includes(ryczaltCategory);

  const createCompany = useCreateCompanyMutation();
  const switchCompany = useSwitchCompanyMutation();
  const completeOnboarding = useCompleteOnboardingMutation();

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (companiesQueryPending || !entryChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  if (hasExistingCompany) {
    return <Navigate to="/" replace />;
  }

  // Service ryczałt skips activity + delivery steps.
  const TOTAL_STEPS = isServiceRyczalt ? 3 : 5;
  const STEP_INDEX: Record<OnboardingStep, number> = isServiceRyczalt
    ? { company_name: 0, taxation: 1, activity: 1, delivery: 1, summary: 2 }
    : { company_name: 0, taxation: 1, activity: 2, delivery: 3, summary: 4 };

  async function handleCompanyCreated(name: string) {
    setCompanyCreateError(null);
    try {
      const company = await createCompany.mutateAsync({ name });
      await switchCompany.mutateAsync(company.id);
      await refreshUser();
      setStep('taxation');
    } catch (e) {
      setCompanyCreateError(e instanceof Error ? e.message : 'Nie udało się utworzyć firmy');
    }
  }

  function handleTaxationNext() {
    if (isServiceRyczalt) {
      setTiles([]);
      setDeliveryMethod(null);
      setStep('summary');
    } else {
      setStep('activity');
    }
  }

  function handleTilesNext() {
    const needsDelivery = tiles.some((t) => NEEDS_DELIVERY.includes(t));
    if (needsDelivery) {
      setStep('delivery');
    } else {
      setDeliveryMethod(null);
      setStep('summary');
    }
  }

  function handleDeliverySelected(method: DeliveryMethod) {
    setDeliveryMethod(method);
    setStep('summary');
  }

  async function handleConfirm() {
    setSubmitError(null);
    try {
      await completeOnboarding.mutateAsync({
        activity_tiles: tiles,
        delivery_method: deliveryMethod,
        taxation_form: taxationForm,
        ryczalt_category: ryczaltCategory,
      });
      await refreshUser();
      navigate('/', { replace: true });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się zapisać ustawień');
    }
  }

  const modulePreview = computeModulePreview(tiles, deliveryMethod, taxationForm, ryczaltCategory);
  const currentStepIndex = STEP_INDEX[step];

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-8">

        {/* Header */}
        <div className="space-y-1 text-center">
          <div className="text-2xl font-bold tracking-tight text-foreground">MojeSaldoo</div>
          <p className="text-sm text-muted-foreground">Konfiguracja zajmuje mniej niż 1 minutę</p>
        </div>

        <ProgressDots current={currentStepIndex} total={TOTAL_STEPS} />

        {/* Step card */}
        <div className="rounded-2xl border border-border bg-background p-6 shadow-sm">
          {step === 'company_name' && (
            <CompanyNameStep
              onNext={(name) => void handleCompanyCreated(name)}
              loading={createCompany.isPending || switchCompany.isPending}
              error={companyCreateError}
            />
          )}

          {step === 'taxation' && (
            <TaxationFormStep
              taxationForm={taxationForm}
              ryczaltCategory={ryczaltCategory}
              onChange={(form, cat) => { setTaxationForm(form); setRyczaltCategory(cat); }}
              onNext={handleTaxationNext}
              onBack={() => setStep('company_name')}
            />
          )}

          {step === 'activity' && (
            <ActivityTilesStep
              selected={tiles}
              onChange={setTiles}
              onNext={handleTilesNext}
            />
          )}

          {step === 'delivery' && (
            <DeliveryMethodStep
              onSelect={handleDeliverySelected}
              onBack={() => setStep('activity')}
            />
          )}

          {step === 'summary' && (
            <>
              {submitError && (
                <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                  {submitError}
                </p>
              )}
              <ModuleSummaryStep
                modules={modulePreview}
                onConfirm={() => void handleConfirm()}
                onBack={() => setStep(
                  isServiceRyczalt ? 'taxation' :
                  deliveryMethod !== null ? 'delivery' : 'activity'
                )}
                loading={completeOnboarding.isPending}
              />
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Wszystkie ustawienia możesz zmienić w dowolnym momencie w{' '}
          <span className="font-medium">Ustawienia → Moduły</span>
        </p>
      </div>
    </div>
  );
}

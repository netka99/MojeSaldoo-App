import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { companyCreateFormSchema, type CompanyCreateFormValues } from '@/lib/companyCreateFormSchema';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import {
  useCreateCompanyMutation,
  useMyCompaniesQuery,
  useSwitchCompanyMutation,
  useToggleModuleMutation,
} from '@/query/use-companies';
import { authStorage } from '@/services/api';
import type { CompanyWrite, ModuleName } from '@/types';
import { cn } from '@/lib/utils';

type Step1FormValues = CompanyCreateFormValues;

const OPTIONAL_MODULE_ROWS: {
  key: 'orders' | 'delivery' | 'invoicing' | 'ksef' | 'reporting';
  label: string;
  description: string;
}[] = [
  { key: 'orders', label: 'Zamówienia', description: 'Obsługa zamówień (opcjonalne)' },
  { key: 'delivery', label: 'Dostawa & Dokumenty WZ', description: 'Wymaga włączonych Zamówień' },
  { key: 'invoicing', label: 'Fakturowanie', description: 'Wymaga włączonych Zamówień' },
  { key: 'ksef', label: 'Integracja KSeF', description: 'Wymaga włączonego Fakturowania' },
  { key: 'reporting', label: 'Raporty', description: 'Analityka (opcjonalne)' },
];

type OptionalState = {
  orders: boolean;
  delivery: boolean;
  invoicing: boolean;
  ksef: boolean;
  reporting: boolean;
};

const defaultOptional: OptionalState = {
  orders: false,
  delivery: false,
  invoicing: false,
  ksef: false,
  reporting: false,
};

const STEPS = 3;

/** Exported for tests; drives step 2 module PATCH sequence. */
export function buildEnabledModules(optional: OptionalState): ModuleName[] {
  const list: ModuleName[] = ['products', 'warehouses', 'customers'];
  if (optional.orders) {
    list.push('orders');
    if (optional.delivery) list.push('delivery');
    if (optional.invoicing) {
      list.push('invoicing');
      if (optional.ksef) list.push('ksef');
    }
  }
  if (optional.reporting) list.push('reporting');
  return list;
}

type OnboardingStep2Props = {
  companyId: string;
  onBack: () => void;
  onComplete: () => void;
};

function OnboardingStep2({ companyId, onBack, onComplete }: OnboardingStep2Props) {
  const [optional, setOptional] = useState<OptionalState>(defaultOptional);
  const [error, setError] = useState<string | null>(null);
  const toggleModule = useToggleModuleMutation(companyId);

  const setOpt = (patch: Partial<OptionalState>) => {
    setOptional((prev) => {
      const next = { ...prev, ...patch };
      if (patch.orders === false) {
        next.delivery = false;
        next.invoicing = false;
        next.ksef = false;
      }
      if (patch.invoicing === false) {
        next.ksef = false;
      }
      return next;
    });
  };

  const canUseOrders = optional.orders;
  const canUseKsef = optional.orders && optional.invoicing;

  const onSubmit = async () => {
    setError(null);
    const toEnable = buildEnabledModules(optional);
    try {
      for (const mod of toEnable) {
        await toggleModule.mutateAsync({ module: mod, enabled: true });
      }
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać modułów');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Włącz moduły</CardTitle>
        <CardDescription>Wybierz, z czego będziesz korzystać. Część modułów zależy od innych.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="space-y-6">
          <section className="space-y-3" aria-labelledby="required-modules">
            <h3 id="required-modules" className="text-sm font-medium text-foreground">
              Zawsze włączone
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3 rounded-md border border-input bg-muted/30 p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked
                  disabled
                  onChange={() => {}}
                  aria-label="Produkty i Magazyn, zawsze włączone"
                  id="m-products-ware"
                />
                <div>
                  <p className="text-sm font-medium" id="label-m-products-ware">
                    Produkty &amp; Magazyn
                  </p>
                  <p className="text-xs text-muted-foreground" aria-hidden="true">
                    Katalog, stany i magazyny (wymagane)
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-md border border-input bg-muted/30 p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked
                  disabled
                  onChange={() => {}}
                  aria-label="Klienci, zawsze włączone"
                  id="m-customers"
                />
                <div>
                  <p className="text-sm font-medium" id="label-m-customers">
                    Klienci
                  </p>
                  <p className="text-xs text-muted-foreground" aria-hidden="true">
                    Baza kontrahentów (wymagane)
                  </p>
                </div>
              </li>
            </ul>
          </section>

          <section className="space-y-3" aria-labelledby="optional-modules">
            <h3 id="optional-modules" className="text-sm font-medium text-foreground">
              Opcjonalne
            </h3>
            <ul className="space-y-3">
              {OPTIONAL_MODULE_ROWS.map((row) => {
                const checked = optional[row.key];
                let disabled = false;
                let hint = row.description;
                if (row.key === 'delivery' || row.key === 'invoicing') {
                  disabled = !canUseOrders;
                  if (disabled) hint = 'Najpierw włącz Zamówienia';
                }
                if (row.key === 'ksef') {
                  disabled = !canUseKsef;
                  if (disabled) hint = 'Najpierw włącz Fakturowanie (i Zamówienia)';
                }

                return (
                  <li
                    key={row.key}
                    className={cn(
                      'flex items-start gap-3 rounded-md border p-3',
                      disabled && 'bg-muted/20 opacity-80',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      id={`m-${row.key}`}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => {
                        if (row.key === 'orders') setOpt({ orders: !optional.orders });
                        if (row.key === 'delivery' && canUseOrders) setOpt({ delivery: !optional.delivery });
                        if (row.key === 'invoicing' && canUseOrders) setOpt({ invoicing: !optional.invoicing });
                        if (row.key === 'ksef' && canUseKsef) setOpt({ ksef: !optional.ksef });
                        if (row.key === 'reporting') setOpt({ reporting: !optional.reporting });
                      }}
                      aria-describedby={`help-${row.key}`}
                    />
                    <div>
                      <label
                        htmlFor={`m-${row.key}`}
                        className={cn('text-sm font-medium', disabled && 'text-muted-foreground')}
                      >
                        {row.label}
                      </label>
                      <p className="text-xs text-muted-foreground" id={`help-${row.key}`}>
                        {hint}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            Wstecz
          </Button>
          <Button type="button" onClick={() => void onSubmit()} loading={toggleModule.isPending} disabled={toggleModule.isPending}>
            Dalej
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function OnboardingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { data: myCompanies, isPending: companiesQueryPending, isSuccess, isError } = useMyCompaniesQuery();
  const [onboardingEntryDecided, setOnboardingEntryDecided] = useState(false);
  const [hasExistingCompanyAtEntry, setHasExistingCompanyAtEntry] = useState(false);
  useEffect(() => {
    if (onboardingEntryDecided) return;
    if (isError) {
      setOnboardingEntryDecided(true);
      return;
    }
    if (!isSuccess) return;
    if ((myCompanies?.length ?? 0) > 0) {
      setHasExistingCompanyAtEntry(true);
    }
    setOnboardingEntryDecided(true);
  }, [isError, isSuccess, myCompanies, onboardingEntryDecided]);
  const [step, setStep] = useState(1);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const createCompany = useCreateCompanyMutation();
  const switchCompany = useSwitchCompanyMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Step1FormValues>({
    resolver: zodResolver(companyCreateFormSchema),
    defaultValues: {
      name: '',
      nip: '',
      city: '',
      address: '',
      phone: '',
      email: '',
    },
  });

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (companiesQueryPending || !onboardingEntryDecided) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (hasExistingCompanyAtEntry) {
    return <Navigate to="/" replace />;
  }

  const onStep1 = async (values: Step1FormValues) => {
    setStep1Error(null);
    const body: CompanyWrite = {
      name: values.name,
      nip: values.nip,
      city: values.city,
      address: values.address,
      phone: values.phone,
      email: values.email,
    };
    try {
      const company = await createCompany.mutateAsync(body);
      setCompanyId(company.id);
      await switchCompany.mutateAsync(company.id);
      await refreshUser();
      setStep(2);
    } catch (e) {
      setStep1Error(e instanceof Error ? e.message : 'Nie udało się utworzyć firmy');
    }
  };

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <p className="text-center text-sm text-muted-foreground" aria-live="polite">
          Krok {step} z {STEPS}
        </p>

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Utwórz firmę</CardTitle>
              <CardDescription>Podstawowe dane twojej organizacji (PL).</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit(onStep1)} noValidate>
                {step1Error && (
                  <p
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    role="alert"
                  >
                    {step1Error}
                  </p>
                )}
                <Input
                  label="Nazwa firmy"
                  required
                  autoComplete="organization"
                  error={errors.name?.message}
                  {...register('name')}
                />
                <Input
                  label="NIP"
                  inputMode="numeric"
                  required
                  autoComplete="on"
                  error={errors.nip?.message}
                  {...register('nip')}
                />
                <Input
                  label="Miasto"
                  required
                  autoComplete="address-level2"
                  error={errors.city?.message}
                  {...register('city')}
                />
                <Input
                  label="Adres"
                  autoComplete="street-address"
                  error={errors.address?.message}
                  {...register('address')}
                />
                <Input
                  label="Telefon"
                  type="tel"
                  autoComplete="tel"
                  error={errors.phone?.message}
                  {...register('phone')}
                />
                <Input
                  label="E-mail"
                  type="email"
                  autoComplete="email"
                  error={errors.email?.message}
                  {...register('email')}
                />
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    loading={createCompany.isPending || switchCompany.isPending}
                    disabled={createCompany.isPending || switchCompany.isPending}
                  >
                    Dalej
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 2 && companyId && (
          <OnboardingStep2
            companyId={companyId}
            onBack={() => setStep(1)}
            onComplete={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Gotowe!</CardTitle>
              <CardDescription>Twoja firma i moduły zostały zapisane.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" onClick={() => navigate('/', { replace: true })}>
                Przejdź do aplikacji
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

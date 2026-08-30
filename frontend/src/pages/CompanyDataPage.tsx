import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { validateNipChecksum } from '@/components/features/CustomerForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { useUpdateCompanyMutation } from '@/query/use-companies';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import type { CompanyWrite } from '@/types';
import { cn } from '@/lib/utils';

type CompanyRow = {
  id: string;
  name: string;
  nip?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  // KSeF / invoice defaults
  bank_account_iban?: string | null;
  bank_swift?: string | null;
  bank_name?: string | null;
  regon?: string | null;
  krs?: string | null;
  bdo?: string | null;
  is_vat_payer?: boolean;
};

function pickStr(c: CompanyRow | undefined, camel: string, snake: string): string {
  if (!c) return '';
  const o = c as unknown as Record<string, unknown>;
  const v = o[camel] ?? o[snake];
  if (v == null) return '';
  return String(v);
}

const companyDataSchema = z.object({
  name: z
    .string()
    .refine((s) => s.trim().length > 0, { message: 'Nazwa firmy jest wymagana' })
    .transform((s) => s.trim()),
  nip: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || validateNipChecksum(s), {
      message: 'Nieprawidłowy numer NIP',
    }),
  city: z
    .string()
    .refine((s) => s.trim().length > 0, { message: 'Miasto jest wymagane' })
    .transform((s) => s.trim()),
  address: z
    .string()
    .transform((s) => s.trim() || undefined)
    .optional(),
  postalCode: z
    .string()
    .transform((s) => s.trim() || undefined)
    .optional(),
  phone: z
    .string()
    .transform((s) => s.trim() || undefined)
    .refine(
      (s) => {
        if (s === undefined) return true;
        const d = s.replace(/\D/g, '');
        return d.length >= 9 && d.length <= 15;
      },
      { message: 'Podaj 9–15 cyfr lub zostaw puste' },
    ),
  email: z
    .string()
    .transform((s) => s.trim() || undefined)
    .refine(
      (s) => s === undefined || z.string().email().safeParse(s).success,
      { message: 'Nieprawidłowy adres e-mail' },
    ),
  // KSeF / invoice defaults
  bank_account_iban: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(s.replace(/\s/g, '')), {
      message: 'Nieprawidłowy format IBAN',
    })
    .optional(),
  bank_swift: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s), {
      message: 'Nieprawidłowy format SWIFT/BIC',
    })
    .optional(),
  bank_name: z.string().transform((s) => s.trim()).optional(),
  regon: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || /^\d{9}(\d{5})?$/.test(s), {
      message: 'REGON musi mieć 9 lub 14 cyfr',
    })
    .optional(),
  krs: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || /^\d{10}$/.test(s), {
      message: 'KRS musi mieć 10 cyfr',
    })
    .optional(),
  bdo: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || /^\d{9}$/.test(s), {
      message: 'BDO musi mieć 9 cyfr',
    })
    .optional(),
});

type FormValues = z.infer<typeof companyDataSchema>;

function rowToDefaults(c: CompanyRow | undefined): FormValues {
  if (!c) {
    return {
      name: '',
      nip: '',
      city: '',
      address: '',
      postalCode: '',
      phone: '',
      email: '',
      bank_account_iban: '',
      bank_swift: '',
      bank_name: '',
      regon: '',
      krs: '',
      bdo: '',
    };
  }
  return {
    name: c.name ?? '',
    nip: pickStr(c, 'nip', 'nip'),
    city: pickStr(c, 'city', 'city'),
    address: pickStr(c, 'address', 'address'),
    postalCode: pickStr(c, 'postalCode', 'postal_code'),
    phone: pickStr(c, 'phone', 'phone'),
    email: pickStr(c, 'email', 'email'),
    bank_account_iban: c.bank_account_iban ?? '',
    bank_swift: c.bank_swift ?? '',
    bank_name: c.bank_name ?? '',
    regon: c.regon ?? '',
    krs: c.krs ?? '',
    bdo: c.bdo ?? '',
  };
}

function formToWrite(v: FormValues): CompanyWrite {
  return {
    name: v.name,
    nip: v.nip,
    city: v.city,
    address: v.address,
    postalCode: v.postalCode,
    phone: v.phone,
    email: v.email,
    bank_account_iban: v.bank_account_iban,
    bank_swift: v.bank_swift,
    bank_name: v.bank_name,
    regon: v.regon,
    krs: v.krs,
    bdo: v.bdo,
  };
}

const outlineLinkClass = cn(
  'text-sm font-medium text-primary underline-offset-4 hover:underline',
);

export function CompanyDataPage() {
  const { refreshUser } = useAuth();
  const resolved = useResolvedCompanyId();
  const updateCompany = useUpdateCompanyMutation();
  const [saveOk, setSaveOk] = useState(false);
  const [isVatPayer, setIsVatPayer] = useState(false);

  const currentCompany: CompanyRow | undefined = resolved.state === 'ready' ? resolved.company : undefined;
  const companyId = resolved.state === 'ready' ? resolved.companyId : undefined;
  const isUnsynced = resolved.state === 'ready' && resolved.isUnsynced;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(companyDataSchema),
    defaultValues: rowToDefaults(undefined),
  });

  useEffect(() => {
    reset(rowToDefaults(currentCompany));
    setIsVatPayer(currentCompany?.is_vat_payer ?? false);
  }, [currentCompany, reset]);

  const onSubmit = async (values: FormValues) => {
    if (resolved.state !== 'ready' || !companyId) return;
    setSaveOk(false);
    const body = { ...formToWrite(values), is_vat_payer: isVatPayer };
    await updateCompany.mutateAsync({ companyId, data: body });
    await refreshUser();
    setSaveOk(true);
  };

  if (resolved.state === 'loading') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      </div>
    );
  }

  if (resolved.state === 'no_companies') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground">Nie należysz do żadnej firmy — utwórz ją w onboardingu albo poproś o zaproszenie.</p>
        <Button type="button" className="mt-4" variant="outline" onClick={() => void refreshUser()}>
          Odśwież dane użytkownika
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-semibold tracking-tight">Dane firmy</h1>
          <p className="text-sm text-muted-foreground">
            Edycja danych bieżącej organizacji (jak podczas onboardingu).{' '}
            <Link to="/settings/company" className={outlineLinkClass}>
              Ustawienia modułów
            </Link>
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dane rejestrowe i kontakt</CardTitle>
          <CardDescription>Zapis zmian wysyła się do serwera (PATCH /api/companies/…/).</CardDescription>
        </CardHeader>
        <CardContent>
          {isUnsynced && (
            <p
              className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-foreground"
              role="status"
            >
              W odpowiedzi /me pole <code className="text-xs">current_company</code> jest puste — poniżej używamy
              pierwszej firmy z Twojej listy. Przy jednej firmie na koncie zostanie ona ustawiona jako bieżąca
              automatycznie.
            </p>
          )}

          {saveOk && (
            <p
              className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
              role="status"
            >
              Zapisano.
            </p>
          )}

          {updateCompany.isError && (
            <p
              className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {updateCompany.error instanceof Error
                ? updateCompany.error.message
                : 'Nie udało się zapisać danych.'}
            </p>
          )}

          {!currentCompany && (
            <p className="mb-4 text-sm text-muted-foreground">
              Brak danych firmy na liście członkostw. Spróbuj odświeżyć stronę.
            </p>
          )}

          <form id="company-data-form" className="space-y-4" onSubmit={handleSubmit((v) => void onSubmit(v))} noValidate>
            <Input label="Nazwa firmy" required autoComplete="organization" error={errors.name?.message} {...register('name')} />
            <Input label="NIP" placeholder="opcjonalnie" inputMode="numeric" error={errors.nip?.message} {...register('nip')} />
            <Input label="Miasto" required autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
            <Input label="Kod pocztowy" autoComplete="postal-code" error={errors.postalCode?.message} {...register('postalCode')} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Adres</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoComplete="street-address"
                {...register('address')}
              />
            </div>
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
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">KSeF — dane dodatkowe</CardTitle>
          <CardDescription>
            Dane bankowe są automatycznie przenoszone na każdą nową fakturę. Rejestry (REGON, KRS, BDO) pojawiają się
            w bloku sprzedawcy w XML FA-3.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">Konto bankowe (przelew)</p>
            <Input
              label="IBAN"
              placeholder="np. PL61109010140000071219812874"
              error={errors.bank_account_iban?.message}
              {...register('bank_account_iban')}
            />
            <Input
              label="SWIFT / BIC"
              placeholder="np. WBKPPLPP"
              error={errors.bank_swift?.message}
              {...register('bank_swift')}
            />
            <Input
              label="Nazwa banku"
              placeholder="np. Santander Bank Polska"
              error={errors.bank_name?.message}
              {...register('bank_name')}
            />
            <p className="pt-2 text-sm font-medium text-muted-foreground">Rejestry</p>
            <Input
              label="REGON"
              placeholder="9 lub 14 cyfr"
              inputMode="numeric"
              error={errors.regon?.message}
              {...register('regon')}
            />
            <Input
              label="KRS"
              placeholder="10 cyfr"
              inputMode="numeric"
              error={errors.krs?.message}
              {...register('krs')}
            />
            <Input
              label="BDO (rejestr odpadów)"
              placeholder="9 cyfr"
              inputMode="numeric"
              error={errors.bdo?.message}
              {...register('bdo')}
            />
          </div>
        </CardContent>
      </Card>

      {/* VAT payer toggle */}
      <Card>
        <CardHeader>
          <CardTitle>VAT</CardTitle>
          <CardDescription>Wpływa na wyświetlanie podziału VAT w raportach sprzedaży.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={isVatPayer}
              onChange={(e) => setIsVatPayer(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <div>
              <p className="text-sm font-medium">Czynny podatnik VAT</p>
              <p className="text-xs text-muted-foreground">Zaznacz jeśli firma jest zarejestrowana jako płatnik VAT</p>
            </div>
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 pb-2">
        <Button form="company-data-form" type="submit" loading={updateCompany.isPending} disabled={!currentCompany}>
          Zapisz
        </Button>
      </div>
    </div>
  );
}

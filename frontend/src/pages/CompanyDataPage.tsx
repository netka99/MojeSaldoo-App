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
  }, [currentCompany, reset]);

  const onSubmit = async (values: FormValues) => {
    if (resolved.state !== 'ready' || !companyId) return;
    setSaveOk(false);
    const body = formToWrite(values);
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
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dane firmy</h1>
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

          <form className="space-y-4" onSubmit={handleSubmit((v) => void onSubmit(v))} noValidate>
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
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" loading={updateCompany.isPending} disabled={!currentCompany}>
                Zapisz
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

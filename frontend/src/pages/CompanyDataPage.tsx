import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { validateNipChecksum } from '@/components/features/CustomerForm';
import { useAuth } from '@/context/AuthContext';
import { useDeleteLogoMutation, useUpdateCompanyMutation, useUploadLogoMutation } from '@/query/use-companies';
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
  logo_url?: string | null;
};

function SectionHeading({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
        {children}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium text-slate-800">{children}</label>;
}

function fieldStateCls(value: string | undefined) {
  const filled = Boolean(value?.trim());
  return filled
    ? 'border-solid border-slate-300 bg-white'
    : 'border-dashed border-slate-300 bg-[#F2F2F7] placeholder:text-slate-400';
}

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

function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 md:h-10 md:w-10"
      aria-label="Wróć"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5}>
        <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const cardCls = 'rounded-2xl border border-slate-200 bg-white p-4 md:rounded-3xl md:p-6';
const primaryBtnCls = 'rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50';
const quietBtnCls = 'rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export function CompanyDataPage() {
  const { refreshUser } = useAuth();
  const resolved = useResolvedCompanyId();
  const updateCompany = useUpdateCompanyMutation();
  const uploadLogo = useUploadLogoMutation();
  const deleteLogo = useDeleteLogoMutation();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [isVatPayer, setIsVatPayer] = useState(false);
  const saveOkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentCompany: CompanyRow | undefined = resolved.state === 'ready' ? resolved.company : undefined;
  const companyId = resolved.state === 'ready' ? resolved.companyId : undefined;
  const isUnsynced = resolved.state === 'ready' && resolved.isUnsynced;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(companyDataSchema),
    defaultValues: rowToDefaults(undefined),
  });

  const filled = watch();

  useEffect(() => {
    reset(rowToDefaults(currentCompany));
    setIsVatPayer(currentCompany?.is_vat_payer ?? false);
  }, [currentCompany, reset]);

  const onSubmit = async (values: FormValues) => {
    if (resolved.state !== 'ready' || !companyId) return;
    setSaveOk(false);
    const body = { ...formToWrite(values), is_vat_payer: isVatPayer };
    await updateCompany.mutateAsync({ companyId, data: body });
    reset(values);
    await refreshUser();
    setSaveOk(true);
    if (saveOkTimerRef.current) clearTimeout(saveOkTimerRef.current);
    saveOkTimerRef.current = setTimeout(() => setSaveOk(false), 4000);
  };

  if (resolved.state === 'loading') {
    return (
      <div className="min-h-full bg-[#F2F2F7] px-4 pt-8">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <BackButton />
          <p className="text-sm text-slate-600">Ładowanie…</p>
        </div>
      </div>
    );
  }

  if (resolved.state === 'no_companies') {
    return (
      <div className="min-h-full bg-[#F2F2F7] px-4 pt-8">
        <div className="mx-auto flex max-w-2xl items-start gap-3">
          <BackButton />
          <p className="text-sm text-slate-600">Nie należysz do żadnej firmy. Utwórz ją przy starcie albo poproś o zaproszenie.</p>
        </div>
        <button type="button" className={cn('mt-4', quietBtnCls)} onClick={() => void refreshUser()}>
          Odśwież
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#F2F2F7]">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-10 pt-8">
        <header className="flex items-center gap-3">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Dane firmy</h1>
            <p className="mt-1 text-xs text-slate-500">
              Nazwa, adres i konto bankowe trafiają na fakturę.{' '}
              <Link to="/settings/company" className="font-medium text-primary">Ustawienia modułów</Link>
            </p>
          </div>
        </header>

        <section className={cardCls}>
          <SectionHeading title="Logo firmy" hint="W nagłówku faktury. PNG, JPG lub SVG, do 2 MB.">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 16l-5-5-9 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </SectionHeading>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-[#F2F2F7]">
              {currentCompany?.logo_url ? (
                <img src={currentCompany.logo_url} alt="Logo firmy" className="max-h-12 max-w-[96px] object-contain" />
              ) : (
                <span className="text-xs text-slate-500">Brak logo</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !companyId) return;
                  void uploadLogo.mutateAsync({ companyId, file }).then(() => refreshUser());
                  e.target.value = '';
                }}
              />
              <button type="button" className={quietBtnCls} disabled={!companyId || uploadLogo.isPending} onClick={() => logoInputRef.current?.click()}>
                {uploadLogo.isPending ? 'Wgrywanie…' : currentCompany?.logo_url ? 'Zmień logo' : 'Wgraj logo'}
              </button>
              {currentCompany?.logo_url && (
                <button
                  type="button"
                  className="rounded-2xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  disabled={!companyId || deleteLogo.isPending}
                  onClick={() => {
                    if (!companyId) return;
                    void deleteLogo.mutateAsync(companyId).then(() => refreshUser());
                  }}
                >
                  {deleteLogo.isPending ? 'Usuwanie…' : 'Usuń logo'}
                </button>
              )}
            </div>
          </div>
          {uploadLogo.isError && (
            <p className="mt-3 text-xs text-red-600">
              {uploadLogo.error instanceof Error ? uploadLogo.error.message : 'Nie udało się wgrać logo.'}
            </p>
          )}
        </section>

        <form id="company-data-form" className="flex flex-col gap-3" onSubmit={handleSubmit((v) => void onSubmit(v))} noValidate>
          <section className={cardCls}>
            <SectionHeading title="Dane rejestrowe i kontakt" hint="Widoczne na fakturze jako sprzedawca.">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </SectionHeading>

            {isUnsynced && (
              <p className="mb-4 rounded-2xl border border-[#F3D072] bg-[#FFFBEB] px-3 py-2 text-sm text-slate-800" role="status">
                Nie ustawiono bieżącej firmy. Pokazujemy pierwszą firmę z Twojego konta.
              </p>
            )}

            {updateCompany.isError && (
              <p className="mb-4 rounded-2xl border border-[#F2B6B6] bg-[#FEF2F2] px-3 py-2 text-sm text-red-700" role="alert">
                {updateCompany.error instanceof Error ? updateCompany.error.message : 'Nie udało się zapisać danych.'}
              </p>
            )}

            {!currentCompany && (
              <p className="mb-4 text-sm text-slate-600">Brak danych firmy. Odśwież stronę.</p>
            )}

            <div className="grid gap-4">
              <div>
                <FieldLabel>Nazwa firmy</FieldLabel>
                <input className={cn('field-ios w-full', fieldStateCls(filled.name))} autoComplete="organization" {...register('name')} />
                {errors.name?.message && <p className="mt-1.5 text-xs text-red-600">{errors.name.message}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>NIP</FieldLabel>
                  <input className={cn('field-ios w-full tabular-nums', fieldStateCls(filled.nip))} inputMode="numeric" autoComplete="off" {...register('nip')} />
                  {errors.nip?.message && <p className="mt-1.5 text-xs text-red-600">{errors.nip.message}</p>}
                </div>
                <div>
                  <FieldLabel>Miasto</FieldLabel>
                  <input className={cn('field-ios w-full', fieldStateCls(filled.city))} autoComplete="address-level2" {...register('city')} />
                  {errors.city?.message && <p className="mt-1.5 text-xs text-red-600">{errors.city.message}</p>}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Kod pocztowy</FieldLabel>
                  <input className={cn('field-ios w-full', fieldStateCls(filled.postalCode))} autoComplete="postal-code" placeholder="00-000" {...register('postalCode')} />
                  {errors.postalCode?.message && <p className="mt-1.5 text-xs text-red-600">{errors.postalCode.message}</p>}
                </div>
                <div>
                  <FieldLabel>Telefon</FieldLabel>
                  <input className={cn('field-ios w-full', fieldStateCls(filled.phone))} type="tel" autoComplete="tel" {...register('phone')} />
                  {errors.phone?.message && <p className="mt-1.5 text-xs text-red-600">{errors.phone.message}</p>}
                </div>
              </div>
              <div>
                <FieldLabel>Adres</FieldLabel>
                <textarea className={cn('field-ios-tall min-h-[72px] w-full', fieldStateCls(filled.address))} autoComplete="street-address" {...register('address')} />
              </div>
              <div>
                <FieldLabel>E-mail</FieldLabel>
                <input className={cn('field-ios w-full', fieldStateCls(filled.email))} type="email" autoComplete="email" {...register('email')} />
                {errors.email?.message && <p className="mt-1.5 text-xs text-red-600">{errors.email.message}</p>}
              </div>
            </div>
          </section>

          <section className={cardCls}>
            <SectionHeading title="Konto i rejestry" hint="Konto bankowe wchodzi na nowe faktury. REGON, KRS i BDO do danych sprzedawcy.">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <rect x="3" y="6" width="18" height="13" rx="2" />
                <path d="M3 10h18" strokeLinecap="round" />
              </svg>
            </SectionHeading>
            <div className="grid gap-4">
              <div>
                <FieldLabel>IBAN</FieldLabel>
                <input className={cn('field-ios w-full tabular-nums', fieldStateCls(filled.bank_account_iban))} placeholder="PL00 0000 0000 0000 0000 0000 0000" autoComplete="off" {...register('bank_account_iban')} />
                {errors.bank_account_iban?.message && <p className="mt-1.5 text-xs text-red-600">{errors.bank_account_iban.message}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>SWIFT / BIC</FieldLabel>
                  <input className={cn('field-ios w-full', fieldStateCls(filled.bank_swift))} placeholder="WBKPPLPP" autoComplete="off" {...register('bank_swift')} />
                  {errors.bank_swift?.message && <p className="mt-1.5 text-xs text-red-600">{errors.bank_swift.message}</p>}
                </div>
                <div>
                  <FieldLabel>Nazwa banku</FieldLabel>
                  <input className={cn('field-ios w-full', fieldStateCls(filled.bank_name))} autoComplete="off" {...register('bank_name')} />
                  {errors.bank_name?.message && <p className="mt-1.5 text-xs text-red-600">{errors.bank_name.message}</p>}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <FieldLabel>REGON</FieldLabel>
                  <input className={cn('field-ios w-full tabular-nums', fieldStateCls(filled.regon))} inputMode="numeric" placeholder="9 lub 14 cyfr" {...register('regon')} />
                  {errors.regon?.message && <p className="mt-1.5 text-xs text-red-600">{errors.regon.message}</p>}
                </div>
                <div>
                  <FieldLabel>KRS</FieldLabel>
                  <input className={cn('field-ios w-full tabular-nums', fieldStateCls(filled.krs))} inputMode="numeric" placeholder="10 cyfr" {...register('krs')} />
                  {errors.krs?.message && <p className="mt-1.5 text-xs text-red-600">{errors.krs.message}</p>}
                </div>
                <div>
                  <FieldLabel>BDO</FieldLabel>
                  <input className={cn('field-ios w-full tabular-nums', fieldStateCls(filled.bdo))} inputMode="numeric" placeholder="9 cyfr" {...register('bdo')} />
                  {errors.bdo?.message && <p className="mt-1.5 text-xs text-red-600">{errors.bdo.message}</p>}
                </div>
              </div>
            </div>
          </section>

          <section className={cardCls}>
            <SectionHeading title="VAT" hint="Od tego zależy podział VAT w raportach sprzedaży.">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="4" y="4" width="16" height="16" rx="3" />
              </svg>
            </SectionHeading>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={isVatPayer}
                onChange={(e) => setIsVatPayer(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
              />
              <span className="text-sm font-medium text-slate-800">Czynny podatnik VAT</span>
            </label>
          </section>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="submit" className={primaryBtnCls} disabled={!currentCompany || updateCompany.isPending}>
              {updateCompany.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </button>
            {saveOk && !isDirty && (
              <p className="text-sm font-medium text-emerald-700">Zapisane</p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

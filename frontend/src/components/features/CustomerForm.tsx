import { useEffect, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { IosToggle } from '@/components/ui/IosToggle';
import { cn } from '@/lib/utils';
import type { Customer, CustomerWrite } from '@/types';

/** Polish NIP checksum (matches backend `CustomerSerializer.validate_nip_format`). */
export function validateNipChecksum(nip: string): boolean {
  const trimmed = nip.trim();
  if (!trimmed || trimmed.length !== 10 || !/^\d{10}$/.test(trimmed)) {
    return false;
  }
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const digits = trimmed.split('').map((d) => parseInt(d, 10));
  const checksum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * weights[i], 0) % 11;
  return digits[9] === checksum;
}

function validatePhoneDigits(phone: string): boolean {
  if (!phone.trim()) return true;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function normalizeCreditLimitInput(s: string): string {
  let t = s.trim();
  if (t === '' || t === '.') return '0';
  if (t.startsWith('.')) t = `0${t}`;
  if (/\d+\.$/.test(t)) t = t.slice(0, -1);
  return t;
}

const creditLimitStr = z
  .string()
  .transform(normalizeCreditLimitInput)
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), { message: 'Maks. 2 miejsca po przecinku' });

export const customerFormSchema = z.object({
  name: z.string().min(1, 'Nazwa jest wymagana').max(255),
  company_name: z.string().max(255),
  nip: z.string().refine((s) => !s.trim() || validateNipChecksum(s), {
    message: 'Nieprawidłowy NIP (10 cyfr i suma kontrolna) lub pozostaw puste',
  }),
  email: z.string().refine((s) => !s.trim() || z.string().email().safeParse(s.trim()).success, {
    message: 'Nieprawidłowy adres email',
  }),
  phone: z.string().max(20).refine(validatePhoneDigits, {
    message: 'Telefon: 9–15 cyfr lub puste',
  }),
  street: z.string().max(255),
  city: z.string().max(100),
  postal_code: z.string().max(10),
  country: z.string().length(2, 'Kod kraju ISO-2 (np. PL)'),
  distance_km: z
    .string()
    .refine((s) => s.trim() === '' || /^\d+$/.test(s.trim()), {
      message: 'Tylko kilometry całkowite lub puste',
    }),
  delivery_days: z.string().max(50),
  payment_terms: z.preprocess(
    (val) => {
      if (val === '' || val == null) return '14';
      if (typeof val === 'number' && !Number.isNaN(val)) return String(val);
      return val;
    },
    z
      .string()
      .min(1, 'Wymagane')
      .regex(/^\d+$/, 'Liczba całkowita (dni)')
      .refine((s) => {
        const n = Number.parseInt(s, 10);
        return n >= 0 && n <= 36500;
      }, 'Od 0 do 36500 dni'),
  ),
  credit_limit: creditLimitStr,
  is_active: z.boolean(),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

const EMPTY_CUSTOMER_DEFAULTS: CustomerFormValues = {
  name: '',
  company_name: '',
  nip: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  postal_code: '',
  country: 'PL',
  distance_km: '',
  delivery_days: '',
  payment_terms: '14',
  credit_limit: '0',
  is_active: true,
};

function customerToFormDefaults(customer: Customer): CustomerFormValues {
  return {
    name: customer.name,
    company_name: customer.company_name ?? '',
    nip: customer.nip ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    street: customer.street ?? '',
    city: customer.city ?? '',
    postal_code: customer.postal_code ?? '',
    country: customer.country || 'PL',
    distance_km: customer.distance_km != null ? String(customer.distance_km) : '',
    delivery_days: customer.delivery_days ?? '',
    payment_terms: String(customer.payment_terms),
    credit_limit: String(customer.credit_limit),
    is_active: customer.is_active,
  };
}

function formValuesToCustomerWrite(values: CustomerFormValues, id?: string): CustomerWrite {
  const dist = values.distance_km.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    company_name: values.company_name.trim() ? values.company_name.trim() : null,
    nip: values.nip.trim() ? values.nip.trim() : null,
    email: values.email.trim() ? values.email.trim() : null,
    phone: values.phone.trim() ? values.phone.trim() : null,
    street: values.street.trim() ? values.street.trim() : null,
    city: values.city.trim() ? values.city.trim() : null,
    postal_code: values.postal_code.trim() ? values.postal_code.trim() : null,
    country: values.country.trim().toUpperCase(),
    distance_km: dist ? Number.parseInt(dist, 10) : null,
    delivery_days: values.delivery_days.trim() ? values.delivery_days.trim() : null,
    payment_terms: Number.parseInt(values.payment_terms, 10),
    credit_limit: values.credit_limit,
    is_active: values.is_active,
  };
}

const ksefFieldInputClass = cn(
  'h-11 min-h-[44px] rounded-xl border-0 bg-secondary px-3.5 text-[15px] text-foreground shadow-none',
  'placeholder:text-muted-foreground focus:bg-secondary focus:shadow-none focus:ring-2 focus:ring-primary/30',
);

function iconBoxClass() {
  return 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary';
}

type IconComp = ComponentType<SVGProps<SVGSVGElement>>;

function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPhone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.12.9.33 1.78.63 2.63a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.45-1.2a2 2 0 012.11-.45c.85.3 1.73.51 2.63.63A2 2 0 0122 16.92z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMapPin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth={1.75} />
    </svg>
  );
}

function IconCredit(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth={1.75} />
      <path d="M2 10h20" stroke="currentColor" strokeWidth={1.75} />
    </svg>
  );
}

const sectionMotion = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 380, damping: 32 } },
};

function FormSection({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: IconComp;
  children: ReactNode;
}) {
  return (
    <motion.section
      variants={sectionMotion}
      initial="hidden"
      animate="show"
      className="shadow-soft rounded-2xl bg-surface-card p-4"
    >
      <div className="mb-4 flex items-center gap-2.5">
        <div className={iconBoxClass()}>
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </motion.section>
  );
}

export interface CustomerFormProps {
  customer?: Customer | null;
  onSubmit: (data: CustomerWrite) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitLabel?: string;
}

export function CustomerForm({
  customer,
  onSubmit,
  onCancel,
  isLoading = false,
  submitLabel,
}: CustomerFormProps) {
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: customer ? customerToFormDefaults(customer) : EMPTY_CUSTOMER_DEFAULTS,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitted },
  } = form;

  const hasSubmitErrors = isSubmitted && Object.keys(errors).length > 0;

  useEffect(() => {
    reset(customer ? customerToFormDefaults(customer) : EMPTY_CUSTOMER_DEFAULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, customer?.updated_at, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(formValuesToCustomerWrite(values, customer?.id));
  });

  const inField = (name: keyof CustomerFormValues) =>
    cn(ksefFieldInputClass, errors[name] && 'ring-2 ring-destructive/40 focus:ring-destructive/40');

  return (
    <form noValidate onSubmit={submit} className="space-y-4 pb-4">
      {hasSubmitErrors && (
        <p
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          Popraw pola oznaczone błędami i spróbuj ponownie.
        </p>
      )}

      <div className="space-y-4">
        <FormSection title="Dane podstawowe" Icon={IconUser}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Nazwa wyświetlana"
              placeholder="np. Sklep u Jana"
              required
              {...register('name')}
              error={errors.name?.message}
              className={inField('name')}
            />
            <Input
              label="Nazwa firmy"
              placeholder="Opcjonalnie"
              {...register('company_name')}
              error={errors.company_name?.message}
              className={inField('company_name')}
            />
          </div>
          <Input
            label="NIP"
            placeholder="10 cyfr"
            maxLength={10}
            {...register('nip')}
            error={errors.nip?.message}
            helperText="Polski NIP z sumą kontrolną lub puste."
            className={inField('nip')}
          />
        </FormSection>

        <FormSection title="Kontakt" Icon={IconPhone}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Email"
              type="email"
              placeholder="kontakt@firma.pl"
              {...register('email')}
              error={errors.email?.message}
              className={inField('email')}
            />
            <Input
              label="Telefon"
              placeholder="+48 600 000 000"
              {...register('phone')}
              error={errors.phone?.message}
              className={inField('phone')}
            />
          </div>
        </FormSection>

        <FormSection title="Adres" Icon={IconMapPin}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Kraj (ISO-2)"
              placeholder="PL"
              maxLength={2}
              {...register('country')}
              error={errors.country?.message}
              className={inField('country')}
            />
            <Input
              label="Miasto"
              placeholder="Warszawa"
              {...register('city')}
              error={errors.city?.message}
              className={inField('city')}
            />
          </div>
          <Input
            label="Ulica"
            placeholder="ul. Przykładowa 1"
            {...register('street')}
            error={errors.street?.message}
            className={inField('street')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Kod pocztowy"
              placeholder="00-000"
              {...register('postal_code')}
              error={errors.postal_code?.message}
              className={inField('postal_code')}
            />
            <Input
              label="Odległość (km)"
              type="number"
              min={0}
              placeholder="np. 12"
              {...register('distance_km')}
              error={errors.distance_km?.message}
              className={inField('distance_km')}
            />
          </div>
          <Input
            label="Dni dostawy (opis)"
            placeholder="np. pon., śr., pt."
            {...register('delivery_days')}
            error={errors.delivery_days?.message}
            className={inField('delivery_days')}
          />
        </FormSection>

        <FormSection title="Płatność i limit" Icon={IconCredit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Termin płatności (dni)"
              type="number"
              min={0}
              placeholder="14"
              required
              {...register('payment_terms')}
              error={errors.payment_terms?.message}
              className={inField('payment_terms')}
            />
            <Input
              label="Limit kredytowy"
              placeholder="0"
              {...register('credit_limit')}
              error={errors.credit_limit?.message}
              className={inField('credit_limit')}
            />
          </div>
        </FormSection>
      </div>

      <Controller
        name="is_active"
        control={control}
        render={({ field }) => (
          <IosToggle
            checked={field.value}
            onChange={field.onChange}
            label="Aktywny kontrahent"
            description="Widoczny przy zamówieniach i fakturach"
            disabled={isLoading}
          />
        )}
      />

      <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" className="w-full sm:flex-1" loading={isLoading}>
            {submitLabel ?? (customer ? 'Zapisz zmiany' : 'Zapisz kontrahenta')}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onCancel} disabled={isLoading}>
              Anuluj
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
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

/** Number inputs can send "", "0.", ".5" — normalize before a strict 2-dp check (blocks submit and POST if invalid). */
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
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), { message: 'Use up to 2 decimal places' });

export const customerFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  company_name: z.string().max(255),
  nip: z.string().refine((s) => !s.trim() || validateNipChecksum(s), {
    message: 'Invalid NIP: 10 digits and the last digit must match the Polish check digit (or leave empty)',
  }),
  email: z.string().refine((s) => !s.trim() || z.string().email().safeParse(s.trim()).success, {
    message: 'Invalid email',
  }),
  phone: z.string().max(20).refine(validatePhoneDigits, {
    message: 'Phone should contain 9–15 digits',
  }),
  street: z.string().max(255),
  city: z.string().max(100),
  postal_code: z.string().max(10),
  country: z.string().length(2, 'Use 2-letter country code'),
  distance_km: z
    .string()
    .refine((s) => s.trim() === '' || /^\d+$/.test(s.trim()), {
      message: 'Whole kilometers only, or leave empty',
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
      .min(1, 'Required')
      .regex(/^\d+$/, 'Whole days')
      .refine((s) => {
        const n = Number.parseInt(s, 10);
        return n >= 0 && n <= 36500;
      }, 'Must be between 0 and 36500'),
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
    // Reset when the loaded entity identity changes (id/updated_at), not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, customer?.updated_at, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(formValuesToCustomerWrite(values, customer?.id));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{customer ? 'Edit customer' : 'New customer'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="space-y-4">
          {hasSubmitErrors && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              Some fields are invalid. Please fix the highlighted values and try again.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Display name" {...register('name')} error={errors.name?.message} required />
            <Input label="Company name" {...register('company_name')} error={errors.company_name?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="NIP"
              {...register('nip')}
              error={errors.nip?.message}
              maxLength={10}
              helperText="Polish NIP: 10 digits, last is a check digit. Leave empty if not used."
            />
            <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
          </div>

          <Input label="Phone" {...register('phone')} error={errors.phone?.message} />

          <Input label="Street" {...register('street')} error={errors.street?.message} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="City" {...register('city')} error={errors.city?.message} />
            <Input label="Postal code" {...register('postal_code')} error={errors.postal_code?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Country (ISO-2)" {...register('country')} error={errors.country?.message} maxLength={2} />
            <Input
              label="Distance (km)"
              type="number"
              min={0}
              {...register('distance_km')}
              error={errors.distance_km?.message}
              helperText="Optional"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Delivery days (text)"
              {...register('delivery_days')}
              error={errors.delivery_days?.message}
              helperText="Optional note, e.g. Mon–Fri"
            />
            <Input
              label="Payment terms (days)"
              type="number"
              min={0}
              {...register('payment_terms')}
              error={errors.payment_terms?.message}
            />
          </div>

          <Input label="Credit limit" {...register('credit_limit')} error={errors.credit_limit?.message} />

          <Controller
            name="is_active"
            control={control}
            render={({ field }) => (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
                Active
              </label>
            )}
          />

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" loading={isLoading}>
              {submitLabel ?? (customer ? 'Save changes' : 'Create customer')}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

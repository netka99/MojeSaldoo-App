import { useEffect, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { IosToggle } from '@/components/ui/IosToggle';
import { cn } from '@/lib/utils';
import type { Product, ProductWrite } from '@/types';

const decimalStr = z
  .string()
  .min(1, 'Wymagane')
  .regex(/^\d+(\.\d{1,2})?$/, 'Format: np. 12.50 (kropka jako separator)');

const minStockStr = z
  .string()
  .regex(/^\d*(\.\d{0,2})?$/, 'Nieprawidłowa liczba')
  .transform((s) => (s.trim() === '' ? '0' : s))
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'Maks. 2 miejsca po przecinku');

export const productFormSchema = z.object({
  name: z.string().min(1, 'Nazwa jest wymagana').max(255),
  description: z.string().max(5000),
  unit: z.string().min(1, 'Jednostka jest wymagana').max(20),
  price_net: decimalStr,
  price_gross: decimalStr,
  vat_rate: decimalStr,
  sku: z.string().max(50),
  barcode: z.string().max(50),
  pkwiu: z.string().max(20),
  track_batches: z.boolean(),
  min_stock_alert: minStockStr,
  shelf_life_days: z
    .string()
    .refine((s) => s.trim() === '' || /^\d+$/.test(s.trim()), {
      message: 'Tylko liczba całkowita dni lub puste',
    }),
  is_active: z.boolean(),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

const EMPTY_PRODUCT_DEFAULTS: ProductFormValues = {
  name: '',
  description: '',
  unit: 'szt',
  price_net: '0',
  price_gross: '0',
  vat_rate: '23',
  sku: '',
  barcode: '',
  pkwiu: '',
  track_batches: true,
  min_stock_alert: '0',
  shelf_life_days: '',
  is_active: true,
};

const VAT_PRESETS = ['0', '5', '8', '23'] as const;

function productToFormDefaults(product: Product): ProductFormValues {
  return {
    name: product.name,
    description: product.description ?? '',
    unit: product.unit,
    price_net: String(product.price_net),
    price_gross: String(product.price_gross),
    vat_rate: (() => {
      const r = String(product.vat_rate).replace(',', '.').trim();
      const n = Number(r);
      return Number.isFinite(n) ? String(n) : r;
    })(),
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    pkwiu: product.pkwiu ?? '',
    track_batches: product.track_batches,
    min_stock_alert: String(product.min_stock_alert),
    shelf_life_days: product.shelf_life_days != null ? String(product.shelf_life_days) : '',
    is_active: product.is_active,
  };
}

function formValuesToProductWrite(values: ProductFormValues, id?: string): ProductWrite {
  const shelf = values.shelf_life_days.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    description: values.description.trim() ? values.description.trim() : null,
    unit: values.unit,
    price_net: values.price_net,
    price_gross: values.price_gross,
    vat_rate: values.vat_rate,
    sku: values.sku.trim() ? values.sku.trim() : null,
    barcode: values.barcode.trim() ? values.barcode.trim() : null,
    pkwiu: values.pkwiu.trim(),
    track_batches: values.track_batches,
    min_stock_alert: values.min_stock_alert,
    shelf_life_days: shelf ? Number.parseInt(shelf, 10) : null,
    is_active: values.is_active,
  };
}

const ksefFieldInputClass = cn(
  'h-11 min-h-[44px] rounded-xl border-0 bg-secondary px-3.5 text-[15px] text-foreground shadow-none',
  'placeholder:text-muted-foreground focus:bg-secondary focus:shadow-none focus:ring-2 focus:ring-primary/30',
);

const ksefTextareaClass = cn(
  ksefFieldInputClass,
  'min-h-[88px] resize-none py-2.5 leading-snug',
);

type IconComp = ComponentType<SVGProps<SVGSVGElement>>;

function IconPackage(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth={1.75} />
    </svg>
  );
}

function IconTag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M12 2H2v10l9.29 9.29a1 1 0 001.41 0l6.59-6.59a1 1 0 000-1.41L12 2zM7 7h.01"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBox(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M21 8l-9 4-9-4M21 8v8l-9 4-9-4V8M3 8l9 4 9-4M12 4v16"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const sectionMotion = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 380, damping: 32 } },
};

function iconBoxClass() {
  return 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary';
}

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

export interface ProductFormProps {
  product?: Product | null;
  onSubmit: (data: ProductWrite) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitLabel?: string;
}

export function ProductForm({
  product,
  onSubmit,
  onCancel,
  isLoading = false,
  submitLabel,
}: ProductFormProps) {
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product ? productToFormDefaults(product) : EMPTY_PRODUCT_DEFAULTS,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors },
  } = form;

  const priceNet = useWatch({ control, name: 'price_net' });
  const vatRate = useWatch({ control, name: 'vat_rate' });

  useEffect(() => {
    const net = priceNet?.trim() ?? '';
    const vat = vatRate?.trim() ?? '';
    if (/^\d+(\.\d{1,2})?$/.test(net) && /^\d+(\.\d{1,2})?$/.test(vat)) {
      const gross = (Number(net) * (1 + Number(vat) / 100)).toFixed(2);
      setValue('price_gross', gross, { shouldValidate: true });
    }
  }, [priceNet, vatRate, setValue]);

  useEffect(() => {
    reset(product ? productToFormDefaults(product) : EMPTY_PRODUCT_DEFAULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, product?.updated_at, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(formValuesToProductWrite(values, product?.id));
  });

  const inField = (name: keyof ProductFormValues) =>
    cn(ksefFieldInputClass, errors[name] && 'ring-2 ring-destructive/40 focus:ring-destructive/40');

  const normalizedVat =
    vatRate != null && String(vatRate).trim() !== ''
      ? String(Number(String(vatRate).replace(',', '.').trim()))
      : '';
  const vatPresetActive = (VAT_PRESETS as readonly string[]).includes(normalizedVat);

  return (
    <form noValidate onSubmit={submit} className="space-y-4 pb-4">
      <div className="space-y-4">
        <FormSection title="Dane podstawowe" Icon={IconPackage}>
          <Input
            label="Nazwa"
            placeholder="np. Kartacze"
            required
            {...register('name')}
            error={errors.name?.message}
            className={inField('name')}
          />
          <div className="space-y-2">
            <label htmlFor="product-description" className="text-sm font-medium leading-none text-foreground">
              Opis
            </label>
            <textarea
              id="product-description"
              placeholder="Opcjonalny opis produktu"
              className={cn(ksefTextareaClass, errors.description && 'ring-2 ring-destructive/40')}
              {...register('description')}
            />
            {errors.description?.message && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Jednostka"
              placeholder="szt"
              required
              {...register('unit')}
              error={errors.unit?.message}
              className={inField('unit')}
            />
            <Input
              label="Termin przydatności (dni)"
              type="number"
              min={0}
              placeholder="np. 30"
              {...register('shelf_life_days')}
              error={errors.shelf_life_days?.message}
              className={inField('shelf_life_days')}
            />
          </div>
        </FormSection>

        <FormSection title="Cennik i VAT" Icon={IconTag}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Cena netto"
              inputMode="decimal"
              {...register('price_net')}
              error={errors.price_net?.message}
              className={inField('price_net')}
            />
            <Input
              label="Cena brutto"
              inputMode="decimal"
              {...register('price_gross')}
              error={errors.price_gross?.message}
              className={inField('price_gross')}
            />
          </div>
          <div className="space-y-2">
            {vatPresetActive ? (
              <>
                <p className="text-sm font-medium text-foreground">Stawka VAT</p>
                <Controller
                  name="vat_rate"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2">
                      {VAT_PRESETS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => field.onChange(v)}
                          className={cn(
                            'h-11 min-w-[3.25rem] flex-1 rounded-xl text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                            normalizedVat === v
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-foreground',
                          )}
                        >
                          {v}%
                        </button>
                      ))}
                    </div>
                  )}
                />
              </>
            ) : (
              <Input
                label="Stawka VAT (%)"
                inputMode="decimal"
                {...register('vat_rate')}
                error={errors.vat_rate?.message}
                className={inField('vat_rate')}
                helperText="Niestandardowa stawka z katalogu — wpisz wartość ręcznie."
              />
            )}
          </div>
        </FormSection>

        <FormSection title="Magazyn i kody" Icon={IconBox}>
          <Input
            label="Kod PKWiU"
            type="text"
            placeholder="np. 10.89.19.0"
            helperText="Przydatne przy fakturach KSeF"
            {...register('pkwiu')}
            error={errors.pkwiu?.message}
            className={inField('pkwiu')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="SKU"
              {...register('sku')}
              error={errors.sku?.message}
              className={inField('sku')}
            />
            <Input
              label="Kod kreskowy"
              {...register('barcode')}
              error={errors.barcode?.message}
              className={inField('barcode')}
            />
          </div>
          <Input
            label="Alert minimalnego stanu"
            inputMode="decimal"
            {...register('min_stock_alert')}
            error={errors.min_stock_alert?.message}
            className={inField('min_stock_alert')}
          />
        </FormSection>
      </div>

      <div className="space-y-3">
        <Controller
          name="track_batches"
          control={control}
          render={({ field }) => (
            <IosToggle
              checked={field.value}
              onChange={field.onChange}
              label="Śledzenie partii (FIFO)"
              description="Rejestruj partie towaru przy przyjęciu"
              disabled={isLoading}
            />
          )}
        />
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <IosToggle
              checked={field.value}
              onChange={field.onChange}
              label="Aktywny w katalogu"
              description="Widoczny przy zamówieniach i fakturach"
              disabled={isLoading}
            />
          )}
        />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" className="w-full sm:flex-1" loading={isLoading}>
            {submitLabel ?? (product ? 'Zapisz zmiany' : 'Zapisz produkt')}
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

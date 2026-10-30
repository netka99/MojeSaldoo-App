import { forwardRef, useEffect, useRef, useState, type ComponentType, type InputHTMLAttributes, type SVGProps } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { IosToggle } from '@/components/ui/IosToggle';
import { cn } from '@/lib/utils';
import { usePriceInputMode } from '@/hooks/usePriceInputMode';
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

const optionalDecimalStr = z
  .string()
  .refine((s) => s.trim() === '' || /^\d+(\.\d{1,2})?$/.test(s.trim()), {
    message: 'Format: np. 30.00 (kropka jako separator)',
  });

const optionalCostStr = z
  .string()
  .refine((s) => s.trim() === '' || /^\d+(\.\d{1,4})?$/.test(s.trim()), {
    message: 'Format: np. 2.5000 (kropka jako separator)',
  });

export const productFormSchema = z.object({
  product_type: z.enum(['material', 'finished', 'trade', 'service']),
  is_service: z.boolean(),
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
  is_resalable: z.boolean(),
  markup_percent: optionalDecimalStr,
  avg_cost_manual: optionalCostStr,
  is_active: z.boolean(),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

const EMPTY_PRODUCT_DEFAULTS: ProductFormValues = {
  product_type: 'trade',
  is_service: false,
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
  is_resalable: true,
  markup_percent: '',
  avg_cost_manual: '',
  is_active: true,
};

const EMPTY_SERVICE_DEFAULTS: ProductFormValues = {
  ...EMPTY_PRODUCT_DEFAULTS,
  product_type: 'service',
  is_service: true,
  unit: 'godz',
  track_batches: false,
  min_stock_alert: '0',
  shelf_life_days: '',
};

const VAT_PRESETS = ['0', '5', '8', '23'] as const;

function productToFormDefaults(product: Product): ProductFormValues {
  return {
    product_type: product.product_type ?? (product.is_service ? 'service' : 'trade'),
    is_service: product.is_service ?? false,
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
    is_resalable: product.is_resalable ?? true,
    markup_percent: product.markup_percent != null ? String(product.markup_percent) : '',
    // Only pre-fill avg_cost_manual when source is manual (or not set); auto-set sources are read-only
    avg_cost_manual:
      product.avg_cost_source === 'manual' || product.avg_cost_source == null
        ? (product.avg_cost != null ? String(product.avg_cost) : '')
        : '',
    is_active: product.is_active,
  };
}

function formValuesToProductWrite(values: ProductFormValues, id?: string): ProductWrite {
  const shelf = values.shelf_life_days.trim();
  const markup = values.markup_percent.trim();
  return {
    ...(id ? { id } : {}),
    product_type: values.product_type,
    is_service: values.product_type === 'service',
    name: values.name,
    description: values.description.trim() ? values.description.trim() : null,
    unit: values.unit,
    price_net: values.price_net,
    price_gross: values.price_gross,
    vat_rate: values.vat_rate,
    sku: values.sku.trim() ? values.sku.trim() : null,
    barcode: values.is_service ? null : (values.barcode.trim() ? values.barcode.trim() : null),
    pkwiu: values.pkwiu.trim(),
    track_batches: values.is_service ? false : values.track_batches,
    min_stock_alert: values.is_service ? '0' : values.min_stock_alert,
    shelf_life_days: values.is_service ? null : (shelf ? Number.parseInt(shelf, 10) : null),
    is_resalable: values.is_service ? true : values.is_resalable,
    markup_percent: markup ? markup : null,
    avg_cost: values.avg_cost_manual.trim() ? values.avg_cost_manual.trim() : null,
    avg_cost_source: null,
    avg_cost_updated_at: null,
    last_cost: null,
    is_active: values.is_active,
  };
}

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

function IconDatabase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <line x1="4" y1="9" x2="20" y2="9" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <line x1="4" y1="15" x2="20" y2="15" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <line x1="10" y1="3" x2="8" y2="21" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <line x1="16" y1="3" x2="14" y2="21" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface ProductImageChange {
  file: File | null;
  remove: boolean;
}

export interface ProductFormProps {
  product?: Product | null;
  onSubmit: (data: ProductWrite, image?: ProductImageChange) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitLabel?: string;
}

function fieldStateCls(value: string | undefined) {
  return value?.trim()
    ? 'border-solid border-[#D4D2EE] bg-white'
    : 'border-dashed border-[#D4D2EE] bg-white placeholder:text-slate-500';
}

function choiceBtnClass(active: boolean) {
  return cn(
    'rounded-2xl px-3 py-1.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    active
      ? 'bg-primary text-primary-foreground'
      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  );
}

const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    error?: string;
    helperText?: string;
    stateValue?: string;
  }
>(function TextField({ label, error, helperText, stateValue, className, ...props }, ref) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
        <input
          {...props}
          ref={ref}
          className={cn(
            'field-ios',
            fieldStateCls(stateValue),
            error && 'ring-2 ring-destructive/40 focus:ring-destructive/40',
            className,
          )}
        />
      </label>
      {error ? (
        <p className="mt-1.5 text-xs text-destructive">{error}</p>
      ) : helperText ? (
        <p className="mt-1.5 text-xs text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
});

function SectionHeader({ Icon, title }: { Icon: IconComp; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
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

  const { isGross } = usePriceInputMode();

  const productType = useWatch({ control, name: 'product_type' });
  const isService = productType === 'service';
  const priceNet = useWatch({ control, name: 'price_net' });
  const priceGross = useWatch({ control, name: 'price_gross' });
  const vatRate = useWatch({ control, name: 'vat_rate' });
  const isResalable = useWatch({ control, name: 'is_resalable' });
  const markupPercent = useWatch({ control, name: 'markup_percent' });

  // Net mode: auto-calculate price_gross from price_net + vat_rate
  useEffect(() => {
    if (isGross) return;
    const net = priceNet?.trim() ?? '';
    const vat = vatRate?.trim() ?? '';
    if (/^\d+(\.\d{1,2})?$/.test(net) && /^\d+(\.\d{1,2})?$/.test(vat)) {
      const gross = (Number(net) * (1 + Number(vat) / 100)).toFixed(2);
      setValue('price_gross', gross, { shouldValidate: true });
    }
  }, [isGross, priceNet, vatRate, setValue]);

  // Gross mode: auto-calculate price_net from price_gross + vat_rate
  useEffect(() => {
    if (!isGross) return;
    const gross = priceGross?.trim() ?? '';
    const vat = vatRate?.trim() ?? '';
    if (/^\d+(\.\d{1,2})?$/.test(gross) && /^\d+(\.\d{1,2})?$/.test(vat)) {
      const net = (Number(gross) / (1 + Number(vat) / 100)).toFixed(2);
      setValue('price_net', net, { shouldValidate: true });
    }
  }, [isGross, priceGross, vatRate, setValue]);

  const productName = useWatch({ control, name: 'name' });
  const description = useWatch({ control, name: 'description' });
  const unit = useWatch({ control, name: 'unit' });
  const shelfLifeDays = useWatch({ control, name: 'shelf_life_days' });
  const minStockAlert = useWatch({ control, name: 'min_stock_alert' });
  const avgCostManual = useWatch({ control, name: 'avg_cost_manual' });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [codesOpen, setCodesOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  // Resolved avg_cost for price suggestion: manual input takes precedence over stored value
  const resolvedAvgCost = (() => {
    const manual = avgCostManual?.trim();
    if (manual && /^\d+(\.\d{1,4})?$/.test(manual)) return Number(manual);
    return product?.avg_cost != null ? Number(product.avg_cost) : null;
  })();

  // Suggested price_net from avg_cost × (1 + markup/100)
  const avgCost = resolvedAvgCost;
  const suggestedPriceNet = (() => {
    if (avgCost == null || avgCost <= 0) return null;
    const m = markupPercent?.trim() ?? '';
    if (!/^\d+(\.\d{1,2})?$/.test(m)) return null;
    return (avgCost * (1 + Number(m) / 100)).toFixed(2);
  })();

  useEffect(() => {
    reset(product ? productToFormDefaults(product) : EMPTY_PRODUCT_DEFAULTS);
    setImageFile(null);
    setRemoveImage(false);
    setImageError(null);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, product?.updated_at, reset]);

  function handleImagePick(file: File | undefined) {
    setImageError(null);
    if (!file) return;
    if (!PRODUCT_IMAGE_TYPES.includes(file.type)) {
      setImageError('Dozwolone formaty: JPEG, PNG, WebP.');
      return;
    }
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      setImageError('Zdjęcie jest za duże. Maksymalnie 5 MB.');
      return;
    }
    setImageFile(file);
    setRemoveImage(false);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function clearImage() {
    setImageFile(null);
    setRemoveImage(true);
    setImageError(null);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  const shownImage = imagePreview || (!removeImage ? product?.image_url : null);
  const imageLetter = (productName || product?.name || '?').trim().charAt(0).toUpperCase() || '?';

  const submit = handleSubmit(async (values) => {
    const payload = formValuesToProductWrite(values, product?.id);
    if (imageFile || removeImage) {
      await onSubmit(payload, { file: imageFile, remove: removeImage && !imageFile });
      return;
    }
    await onSubmit(payload);
  });

  const normalizedVat =
    vatRate != null && String(vatRate).trim() !== ''
      ? String(Number(String(vatRate).replace(',', '.').trim()))
      : '';
  const vatPresetActive = (VAT_PRESETS as readonly string[]).includes(normalizedVat);

  // For accordion badge
  const watchedPkwiu = useWatch({ control, name: 'pkwiu' });
  const watchedSku = useWatch({ control, name: 'sku' });
  const watchedBarcode = useWatch({ control, name: 'barcode' });
  const hasAnyCodes = !!(watchedPkwiu?.trim() || watchedSku?.trim() || watchedBarcode?.trim());

  return (
    <form noValidate onSubmit={submit} className="space-y-3 pb-4">
      {/* 1. Product type selector */}
      <Controller
        name="product_type"
        control={control}
        render={({ field }) => {
          const TYPE_OPTIONS = [
            { value: 'trade' as const,    label: 'Towar handlowy', icon: '🛒', unit: 'szt', track: true },
            { value: 'material' as const, label: 'Surowiec',        icon: '🧱', unit: 'szt', track: true },
            { value: 'finished' as const, label: 'Wyrób gotowy',    icon: '📦', unit: 'szt', track: false },
            { value: 'service' as const,  label: 'Usługa',          icon: '🛎️', unit: 'godz', track: false },
          ];
          const stockTotal = Number(product?.stock_total ?? 0);
          const selectedOption = TYPE_OPTIONS.find((o) => o.value === field.value);
          const showStockWarning = selectedOption?.track === false && stockTotal > 0;
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={field.value === opt.value}
                    onClick={() => {
                      field.onChange(opt.value);
                      setValue('is_service', opt.value === 'service');
                      if (!product) {
                        setValue('unit', opt.unit);
                        setValue('track_batches', opt.track);
                      }
                    }}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                      field.value === opt.value
                        ? 'border-primary bg-primary/5 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-primary/40',
                    )}
                  >
                    <span aria-hidden>{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
              {showStockWarning && (
                <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  Ten produkt ma {stockTotal} szt. na stanie. Wybrany typ nie śledzi magazynu — stan pozostanie zamrożony i nie będzie automatycznie aktualizowany. Możesz go wyzerować ręcznie przez korektę stanu w magazynie.
                </p>
              )}
            </div>
          );
        }}
      />

      {/* 2. Dane podstawowe */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        <div className="px-4 pt-4 pb-2">
          <SectionHeader Icon={IconPackage} title={isService ? 'Dane usługi' : 'Dane podstawowe'} />
        </div>
        <div className="space-y-3 px-4 pb-4 pt-3">
          {/* Photo picker */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-800">Zdjęcie</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#D4D2EE] bg-white text-sm font-semibold text-primary"
                aria-label="Wybierz zdjęcie produktu"
              >
                {shownImage ? (
                  <img src={shownImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  imageLetter
                )}
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => handleImagePick(e.target.files?.[0])}
              />
              {shownImage && (
                <button type="button" className="text-sm font-medium text-slate-700 hover:underline" onClick={clearImage}>
                  Usuń zdjęcie
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">JPEG, PNG lub WebP, maks. 5 MB. Zapisujemy tylko małą miniaturę.</p>
            {imageError && <p className="mt-1.5 text-xs text-destructive">{imageError}</p>}
          </div>

          <TextField
            label="Nazwa"
            placeholder={isService ? 'np. Naprawa zmywarki' : 'np. Kartacze'}
            required
            stateValue={productName}
            error={errors.name?.message}
            {...register('name')}
          />

          <label className="block" htmlFor="product-description">
            <span className="mb-1.5 block text-sm font-medium text-slate-800">Opis</span>
            <textarea
              id="product-description"
              placeholder={isService ? 'Co obejmuje usługa' : 'Opcjonalny opis produktu'}
              className={cn(
                'field-ios-tall min-h-[4.5rem] resize-y',
                fieldStateCls(description),
                errors.description && 'ring-2 ring-destructive/40',
              )}
              {...register('description')}
            />
            {errors.description?.message && (
              <p className="mt-1.5 text-xs text-destructive">{errors.description.message}</p>
            )}
          </label>

          <div className={cn('grid gap-3', isService ? 'grid-cols-1' : 'sm:grid-cols-2')}>
            <TextField
              label="Jednostka"
              placeholder={isService ? 'godz / usługa / projekt' : 'szt'}
              required
              stateValue={unit}
              error={errors.unit?.message}
              {...register('unit')}
            />
            {!isService && (
              <TextField
                label="Termin przydatności (dni)"
                type="number"
                min={0}
                placeholder="np. 30"
                stateValue={shelfLifeDays}
                error={errors.shelf_life_days?.message}
                {...register('shelf_life_days')}
              />
            )}
          </div>
        </div>
      </section>

      {/* 3. Sprzedaż */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        <div className="px-4 pt-4 pb-2">
          <SectionHeader Icon={IconTag} title="Sprzedaż" />
        </div>
        <div className="space-y-3 px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {isGross ? (
              <>
                <TextField
                  label="Cena brutto sprzedaży"
                  inputMode="decimal"
                  stateValue={priceGross}
                  error={errors.price_gross?.message}
                  {...register('price_gross')}
                />
                <TextField
                  label="Cena netto (obliczona)"
                  inputMode="decimal"
                  stateValue={priceNet}
                  error={errors.price_net?.message}
                  {...register('price_net')}
                />
              </>
            ) : (
              <>
                <div>
                  <TextField
                    label="Cena netto sprzedaży"
                    inputMode="decimal"
                    stateValue={priceNet}
                    error={errors.price_net?.message}
                    {...register('price_net')}
                  />
                  {suggestedPriceNet && suggestedPriceNet !== priceNet?.trim() && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setValue('price_net', suggestedPriceNet, { shouldValidate: true })}
                    >
                      Zastosuj sugerowaną: {suggestedPriceNet} zł
                    </button>
                  )}
                </div>
                <TextField
                  label="Cena brutto"
                  inputMode="decimal"
                  stateValue={priceGross}
                  error={errors.price_gross?.message}
                  {...register('price_gross')}
                />
              </>
            )}
          </div>

          {/* VAT */}
          <div className="space-y-2">
            {vatPresetActive ? (
              <>
                <p className="mb-1.5 block text-sm font-medium text-slate-800">Stawka VAT</p>
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
                          className={choiceBtnClass(normalizedVat === v)}
                        >
                          {v}%
                        </button>
                      ))}
                    </div>
                  )}
                />
              </>
            ) : (
              <TextField
                label="Stawka VAT (%)"
                inputMode="decimal"
                stateValue={vatRate}
                error={errors.vat_rate?.message}
                helperText="Niestandardowa stawka z katalogu — wpisz wartość ręcznie."
                {...register('vat_rate')}
              />
            )}
          </div>

          {/* Markup */}
          {(!isService || isResalable) && (
            <TextField
              label="Narzut / marża (%)"
              inputMode="decimal"
              placeholder="np. 55"
              stateValue={markupPercent}
              helperText={
                avgCost != null && avgCost > 0
                  ? `Aktualny koszt zakupu: ${avgCost.toFixed(4)} zł/jm`
                  : 'Koszt zakupu pojawi się po pierwszym PZ, produkcji lub wpisz ręcznie poniżej'
              }
              error={errors.markup_percent?.message}
              {...register('markup_percent')}
            />
          )}

          {/* Divider + is_resalable toggle */}
          <div className="border-t border-slate-100 mt-2 pt-3">
            {!isService && (
              <Controller
                name="is_resalable"
                control={control}
                render={({ field }) => (
                  <IosToggle
                    embedded
                    checked={field.value}
                    onChange={field.onChange}
                    label="Produkt do sprzedaży"
                    description="Pojawia się na fakturach i zamówieniach klientów. Wyłącz dla surowców używanych tylko w produkcji."
                    disabled={isLoading}
                  />
                )}
              />
            )}
          </div>
        </div>
      </section>

      {/* 4. Koszty i magazyn — hidden for services */}
      {!isService && (
        <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          <div className="px-4 pt-4 pb-2">
            <SectionHeader Icon={IconDatabase} title="Koszty i magazyn" />
          </div>
          <div className="space-y-3 px-4 pb-4 pt-3">
            {/* avg_cost */}
            {(() => {
              const source = product?.avg_cost_source;
              const autoSources: Array<typeof source> = ['pz', 'production'];
              const isAutoSet = autoSources.includes(source ?? null as never);
              const sourceLabel =
                source === 'pz' ? 'z PZ' :
                source === 'production' ? 'z produkcji' :
                source === 'recipe' ? 'szacunek z receptury' : null;

              return (
                <div className="space-y-1">
                  {isAutoSet ? (
                    <div>
                      <p className="mb-1.5 block text-sm font-medium text-slate-800">Koszt własny (avg_cost)</p>
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D4D2EE] bg-white px-3 py-2 text-sm">
                        <span className="tabular-nums font-medium">
                          {product?.avg_cost != null ? `${Number(product.avg_cost).toFixed(4)} zł/jm` : '—'}
                        </span>
                        {sourceLabel && (
                          <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                            {sourceLabel}
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          Ustawiany automatycznie — nie można edytować ręcznie
                        </span>
                      </div>
                    </div>
                  ) : (
                    <TextField
                      label="Koszt własny (avg_cost)"
                      inputMode="decimal"
                      placeholder="np. 2.5000"
                      stateValue={avgCostManual}
                      helperText={
                        source === 'recipe'
                          ? 'Szacunek z receptury — wpisz rzeczywisty koszt aby nadpisać'
                          : 'Ręczny koszt — zostanie zastąpiony automatycznie po pierwszym PZ lub produkcji'
                      }
                      error={errors.avg_cost_manual?.message}
                      {...register('avg_cost_manual')}
                    />
                  )}
                </div>
              );
            })()}

            {/* track_batches toggle */}
            <Controller
              name="track_batches"
              control={control}
              render={({ field }) => (
                <IosToggle
                  embedded
                  checked={field.value}
                  onChange={field.onChange}
                  label="Śledzenie partii (FIFO)"
                  description={
                    productType === 'finished'
                      ? 'Śledź stan gotowych wyrobów w magazynie. Wyłącz jeśli produkujesz na bieżąco pod zamówienie — bez trzymania zapasów.'
                      : productType === 'material'
                      ? 'Śledź partie surowców i ich koszty. Wymagane do liczenia kosztu wytworzenia w produkcji.'
                      : 'Śledź partie towaru i ich koszty zakupu (FIFO). Wymagane do wyliczenia marży.'
                  }
                  disabled={isLoading}
                />
              )}
            />

            {/* min_stock_alert */}
            <TextField
              label="Alert minimalnego stanu"
              inputMode="decimal"
              stateValue={minStockAlert}
              error={errors.min_stock_alert?.message}
              {...register('min_stock_alert')}
            />
          </div>
        </section>
      )}

      {/* 5. Kody i klasyfikacja — accordion */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50/60"
          onClick={() => setCodesOpen((o) => !o)}
          aria-expanded={codesOpen}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconHash className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Kody i klasyfikacja</p>
              <p className="text-xs text-slate-500">Nie są wymagane do wystawienia faktury</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasAnyCodes && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                ustawione
              </span>
            )}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', codesOpen && 'rotate-180')}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </button>
        {codesOpen && (
          <div className="space-y-3 border-t border-slate-200 px-4 pb-4 pt-3">
            <TextField
              label="Kod PKWiU"
              type="text"
              placeholder="np. 10.89.19.0"
              stateValue={watchedPkwiu}
              helperText="Przydatne przy fakturach KSeF"
              error={errors.pkwiu?.message}
              {...register('pkwiu')}
            />
            <div className={cn('grid gap-3', isService ? 'grid-cols-1' : 'sm:grid-cols-2')}>
              <TextField
                label="SKU / kod wewnętrzny"
                stateValue={watchedSku}
                error={errors.sku?.message}
                {...register('sku')}
              />
              {!isService && (
                <TextField
                  label="Kod kreskowy"
                  stateValue={watchedBarcode}
                  error={errors.barcode?.message}
                  {...register('barcode')}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* 6. is_active toggle */}
      <Controller
        name="is_active"
        control={control}
        render={({ field }) => (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 md:rounded-3xl">
            <IosToggle
              embedded
              checked={field.value}
              onChange={field.onChange}
              label={isService ? 'Aktywna w katalogu' : 'Aktywny w katalogu'}
              description="Widoczny przy zamówieniach i fakturach"
              disabled={isLoading}
            />
          </div>
        )}
      />

      {/* Sticky bottom bar */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-t border-slate-200 bg-[#F2F2F7] px-4 py-3 sm:-mx-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="submit"
            className="h-auto w-full rounded-2xl px-5 py-2.5 text-sm font-semibold sm:flex-1"
            loading={isLoading}
          >
            {submitLabel ?? (product
              ? 'Zapisz zmiany'
              : isService ? 'Zapisz usługę' : 'Zapisz produkt')}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-none sm:w-auto"
              onClick={onCancel}
              disabled={isLoading}
            >
              Anuluj
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

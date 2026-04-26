import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { Product, ProductWrite } from '@/types';

const decimalStr = z
  .string()
  .min(1, 'Required')
  .regex(/^\d+(\.\d{1,2})?$/, 'Use up to 2 decimal places, e.g. 12.50');

const minStockStr = z
  .string()
  .regex(/^\d*(\.\d{0,2})?$/, 'Invalid number')
  .transform((s) => (s.trim() === '' ? '0' : s))
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'Use up to 2 decimal places');

export const productFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(5000),
  unit: z.string().min(1, 'Unit is required').max(20),
  price_net: decimalStr,
  price_gross: decimalStr,
  vat_rate: decimalStr,
  sku: z.string().max(50),
  barcode: z.string().max(50),
  track_batches: z.boolean(),
  min_stock_alert: minStockStr,
  shelf_life_days: z
    .string()
    .refine((s) => s.trim() === '' || /^\d+$/.test(s.trim()), {
      message: 'Whole days only, or leave empty',
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
  track_batches: true,
  min_stock_alert: '0',
  shelf_life_days: '',
  is_active: true,
};

function productToFormDefaults(product: Product): ProductFormValues {
  return {
    name: product.name,
    description: product.description ?? '',
    unit: product.unit,
    price_net: String(product.price_net),
    price_gross: String(product.price_gross),
    vat_rate: String(product.vat_rate),
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
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
    track_batches: values.track_batches,
    min_stock_alert: values.min_stock_alert,
    shelf_life_days: shelf ? Number.parseInt(shelf, 10) : null,
    is_active: values.is_active,
  };
}

const textareaClassName = cn(
  'flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export interface ProductFormProps {
  /** When set, form starts in edit mode with these values. */
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
    formState: { errors },
  } = form;

  useEffect(() => {
    reset(product ? productToFormDefaults(product) : EMPTY_PRODUCT_DEFAULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, product?.updated_at, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(formValuesToProductWrite(values, product?.id));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{product ? 'Edit product' : 'New product'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="space-y-4">
          <Input label="Name" {...register('name')} error={errors.name?.message} required />

          <div className="space-y-2">
            <label htmlFor="product-description" className="text-sm font-medium leading-none">
              Description
            </label>
            <textarea
              id="product-description"
              className={cn(textareaClassName, errors.description && 'border-destructive')}
              {...register('description')}
            />
            {errors.description?.message && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Unit" {...register('unit')} error={errors.unit?.message} required />
            <Input label="VAT rate" {...register('vat_rate')} error={errors.vat_rate?.message} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Price (net)" {...register('price_net')} error={errors.price_net?.message} required />
            <Input label="Price (gross)" {...register('price_gross')} error={errors.price_gross?.message} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="SKU" {...register('sku')} error={errors.sku?.message} />
            <Input label="Barcode" {...register('barcode')} error={errors.barcode?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Min stock alert"
              {...register('min_stock_alert')}
              error={errors.min_stock_alert?.message}
            />
            <Input
              label="Shelf life (days)"
              type="number"
              min={0}
              {...register('shelf_life_days')}
              error={errors.shelf_life_days?.message}
              helperText="Optional; leave empty if not applicable"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Controller
              name="track_batches"
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
                  Track batches
                </label>
              )}
            />
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
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" loading={isLoading}>
              {submitLabel ?? (product ? 'Save changes' : 'Create product')}
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

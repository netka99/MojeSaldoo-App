import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { WAREHOUSE_TYPES, type Warehouse, type WarehouseType, type WarehouseWrite } from '@/types';

export const warehouseFormSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(10)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, dash or underscore only'),
  name: z.string().min(1, 'Name is required').max(255),
  warehouse_type: z.enum(WAREHOUSE_TYPES),
  address: z.string().max(5000),
  is_active: z.boolean(),
  allow_negative_stock: z.boolean(),
  fifo_enabled: z.boolean(),
});

export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;

const EMPTY_DEFAULTS: WarehouseFormValues = {
  code: '',
  name: '',
  warehouse_type: 'main',
  address: '',
  is_active: true,
  allow_negative_stock: false,
  fifo_enabled: true,
};

function warehouseToForm(w: Warehouse): WarehouseFormValues {
  return {
    code: w.code,
    name: w.name,
    warehouse_type: w.warehouse_type,
    address: w.address ?? '',
    is_active: w.is_active,
    allow_negative_stock: w.allow_negative_stock,
    fifo_enabled: w.fifo_enabled,
  };
}

function formToWrite(values: WarehouseFormValues, id?: string): WarehouseWrite {
  return {
    ...(id ? { id } : {}),
    code: values.code.trim().toUpperCase(),
    name: values.name.trim(),
    warehouse_type: values.warehouse_type as WarehouseType,
    address: values.address.trim(),
    is_active: values.is_active,
    allow_negative_stock: values.allow_negative_stock,
    fifo_enabled: values.fifo_enabled,
  };
}

export interface WarehouseFormProps {
  warehouse?: Warehouse | null;
  onSubmit: (data: WarehouseWrite) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  submitLabel?: string;
}

export function WarehouseForm({
  warehouse,
  onSubmit,
  onCancel,
  isLoading = false,
  submitLabel,
}: WarehouseFormProps) {
  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: warehouse ? warehouseToForm(warehouse) : EMPTY_DEFAULTS,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = form;

  useEffect(() => {
    reset(warehouse ? warehouseToForm(warehouse) : EMPTY_DEFAULTS);
  }, [warehouse?.id, warehouse?.updated_at, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(formToWrite(values, warehouse?.id));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{warehouse ? 'Edit warehouse' : 'New warehouse'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Code"
              {...register('code')}
              error={errors.code?.message}
              required
              maxLength={10}
              helperText="Short unique code, e.g. MG"
            />
            <Input label="Name" {...register('name')} error={errors.name?.message} required />
          </div>

          <div className="space-y-2">
            <label htmlFor="warehouse-type" className="text-sm font-medium">
              Type
            </label>
            <select
              id="warehouse-type"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...register('warehouse_type')}
            >
              {WAREHOUSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {errors.warehouse_type?.message && (
              <p className="text-xs text-destructive">{errors.warehouse_type.message}</p>
            )}
          </div>

          <Input label="Address" {...register('address')} error={errors.address?.message} />

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
            <Controller
              name="allow_negative_stock"
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
                  Allow negative stock
                </label>
              )}
            />
            <Controller
              name="fifo_enabled"
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
                  FIFO enabled
                </label>
              )}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" loading={isLoading}>
              {submitLabel ?? (warehouse ? 'Save changes' : 'Create warehouse')}
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

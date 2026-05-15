import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { WAREHOUSE_TYPES, WAREHOUSE_TYPE_LABELS_PL, type Warehouse, type WarehouseType, type WarehouseWrite } from '@/types';

export const warehouseFormSchema = z.object({
  code: z
    .string()
    .min(1, 'Kod jest wymagany')
    .max(10)
    .regex(/^[A-Za-z0-9_-]+$/, 'Dozwolone: litery, cyfry, myślnik i podkreślenie'),
  name: z.string().min(1, 'Nazwa jest wymagana').max(255),
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
  /** When `embedded`, omits outer Card wrapper (e.g. inside accordion). Defaults to `card`. */
  presentation?: 'card' | 'embedded';
}

export function WarehouseForm({
  warehouse,
  onSubmit,
  onCancel,
  isLoading = false,
  submitLabel,
  presentation = 'card',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouse?.id, warehouse?.updated_at, reset]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(formToWrite(values, warehouse?.id));
  });

  const formBody = (
    <form noValidate onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Kod"
          {...register('code')}
          error={errors.code?.message}
          required
          maxLength={10}
          helperText="Krótki unikalny kod, np. MG"
        />
        <Input label="Nazwa" {...register('name')} error={errors.name?.message} required />
      </div>

      <div className="space-y-2">
        <label htmlFor="warehouse-type" className="text-sm font-medium">
          Typ magazynu
        </label>
        <select
          id="warehouse-type"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register('warehouse_type')}
        >
          {WAREHOUSE_TYPES.map((t) => (
            <option key={t} value={t}>
              {WAREHOUSE_TYPE_LABELS_PL[t]}
            </option>
          ))}
        </select>
        {errors.warehouse_type?.message && (
          <p className="text-xs text-destructive">{errors.warehouse_type.message}</p>
        )}
      </div>

      <Input label="Adres" {...register('address')} error={errors.address?.message} />

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
              Aktywny
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
              Dopuszczalny stan ujemny
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
              FIFO włączone
            </label>
          )}
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button type="submit" loading={isLoading}>
          {submitLabel ?? (warehouse ? 'Zapisz zmiany' : 'Utwórz magazyn')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Anuluj
          </Button>
        )}
      </div>
    </form>
  );

  if (presentation === 'embedded') {
    return <div className="space-y-4">{formBody}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{warehouse ? 'Edycja magazynu' : 'Nowy magazyn'}</CardTitle>
      </CardHeader>
      <CardContent>{formBody}</CardContent>
    </Card>
  );
}

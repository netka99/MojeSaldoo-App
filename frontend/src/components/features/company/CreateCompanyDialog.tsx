import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useCreateCompanyMutation, useSwitchCompanyMutation } from '@/query/use-companies';
import { companyCreateFormSchema, type CompanyCreateFormValues } from '@/lib/companyCreateFormSchema';
import type { CompanyWrite } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

type CreateCompanyDialogProps = {
  /** Optional class for the trigger control. */
  triggerClassName?: string
  /** Trigger label (Polish). */
  triggerLabel?: string
  /** `outline`: prominent button. `link`: text link (e.g. sidebar). */
  triggerVariant?: 'link' | 'outline'
  /** Runs right before the dialog opens (e.g. close a parent popover). */
  onBeforeOpen?: () => void
}

/**
 * Modal to POST a new company, switch the session to it, invalidate queries, refresh /me, and reload.
 */
export function CreateCompanyDialog({
  triggerClassName,
  triggerLabel = 'Dodaj firmę',
  triggerVariant = 'link',
  onBeforeOpen,
}: CreateCompanyDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const titleId = useId();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompanyMutation();
  const { mutateAsync: switchCompany, isPending: isSwitching } = useSwitchCompanyMutation();
  const isBusy = createCompany.isPending || isSwitching;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CompanyCreateFormValues>({
    resolver: zodResolver(companyCreateFormSchema),
    defaultValues: {
      name: '',
      nip: '',
      city: '',
      address: '',
      phone: '',
      email: '',
    },
  });

  const onClose = useCallback(() => {
    setOpen(false);
    setSubmitError(null);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, isBusy, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const onSubmit = async (values: CompanyCreateFormValues) => {
    setSubmitError(null);
    const body: CompanyWrite = {
      name: values.name,
      nip: values.nip,
      city: values.city,
      address: values.address,
      phone: values.phone,
      email: values.email,
    };
    try {
      const company = await createCompany.mutateAsync(body);
      await switchCompany(company.id);
      await queryClient.invalidateQueries();
      await refreshUser();
      window.location.reload();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się utworzyć firmy');
    }
  };

  const openDialog = () => {
    onBeforeOpen?.();
    setSubmitError(null);
    setOpen(true);
  };

  return (
    <>
      {triggerVariant === 'outline' ? (
        <Button
          type="button"
          variant="outline"
          className={triggerClassName}
          onClick={openDialog}
        >
          {triggerLabel}
        </Button>
      ) : (
        <button
          type="button"
          className={cn(
            'text-left text-sm font-medium text-primary underline-offset-4 hover:underline',
            triggerClassName,
          )}
          onClick={openDialog}
        >
          {triggerLabel}
        </button>
      )}

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-end justify-center bg-white p-4 sm:items-center"
            role="presentation"
            onClick={(e) => {
              if (isBusy) {
                return;
              }
              if (e.target === e.currentTarget) {
                onClose();
              }
            }}
          >
            <div
              className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-0 shadow-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onClick={(e) => e.stopPropagation()}
            >
            <Card className="border-0 bg-white shadow-none">
              <CardHeader>
                <CardTitle id={titleId} className="text-xl">
                  Nowa firma
                </CardTitle>
                <CardDescription>
                  Utworzysz kolejną organizację i zostaniesz do niej przełączony. Wypełnij dane jak przy pierwszej
                  firmie.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
                  {submitError && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                      {submitError}
                    </p>
                  )}
                  <Input
                    label="Nazwa firmy"
                    required
                    autoComplete="organization"
                    error={errors.name?.message}
                    {...register('name')}
                  />
                  <Input
                    label="NIP"
                    inputMode="numeric"
                    required
                    autoComplete="on"
                    error={errors.nip?.message}
                    {...register('nip')}
                  />
                  <Input
                    label="Miasto"
                    required
                    autoComplete="address-level2"
                    error={errors.city?.message}
                    {...register('city')}
                  />
                  <Input label="Adres" autoComplete="street-address" error={errors.address?.message} {...register('address')} />
                  <Input label="Telefon" type="tel" autoComplete="tel" error={errors.phone?.message} {...register('phone')} />
                  <Input label="E-mail" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
                      Anuluj
                    </Button>
                    <Button type="submit" loading={isBusy} disabled={isBusy}>
                      Utwórz i przełącz
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}

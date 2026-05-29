import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CustomerForm } from '@/components/features/CustomerForm';
import { Button } from '@/components/ui/Button';
import { customerKeys } from '@/query/keys';
import { useCustomerQuery, useUpdateCustomerMutation } from '@/query/use-customers';
import { authStorage } from '@/services/api';
import type { CustomerWrite } from '@/types';

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function customerBodyForPut(data: CustomerWrite): CustomerWrite {
  const { id: _id, ...rest } = data as CustomerWrite & { id?: string };
  return rest;
}

export function CustomerEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: customer, isLoading, isError, error, refetch } = useCustomerQuery(id);
  const update = useUpdateCustomerMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!id) {
    return <Navigate to="/customers" replace />;
  }

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-xl space-y-4 px-4 pb-8 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="shadow-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-card text-on-surface transition-colors hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Wróć do listy"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]">
            Edytuj kontrahenta
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {customer?.name ?? (isLoading ? 'Ładowanie…' : '')}
          </p>
        </div>
      </header>

      {isError && (
        <div
          className="shadow-soft flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Nie udało się wczytać kontrahenta'}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {isLoading && !customer && !isError && (
        <p className="py-8 text-center text-sm text-muted-foreground">Ładowanie karty kontrahenta…</p>
      )}

      {customer && (
        <>
          {submitError && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {submitError}
            </p>
          )}
          <CustomerForm
            customer={customer}
            onSubmit={async (data: CustomerWrite) => {
              setSubmitError(null);
              try {
                await update.mutateAsync({ id, body: customerBodyForPut(data) });
                await queryClient.invalidateQueries({ queryKey: customerKeys.all });
                navigate('/customers');
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian');
              }
            }}
            onCancel={() => navigate(-1)}
            isLoading={update.isPending}
          />
        </>
      )}
    </div>
  );
}

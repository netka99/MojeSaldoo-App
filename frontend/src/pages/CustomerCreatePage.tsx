import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CustomerForm } from '@/components/features/CustomerForm';
import { useCreateCustomerMutation } from '@/query/use-customers';
import { customerKeys } from '@/query/keys';
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

export function CustomerCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateCustomerMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-xl space-y-4 px-4 pb-8 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/customers')}
          className="shadow-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-card text-on-surface transition-colors hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Wróć do listy"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.25rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.375rem]">
            Nowy kontrahent
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Dodaj kontrahenta do bazy</p>
        </div>
      </header>

      {submitError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}
      <CustomerForm
        onSubmit={async (data: CustomerWrite) => {
          setSubmitError(null);
          try {
            await create.mutateAsync(data);
            await queryClient.invalidateQueries({ queryKey: customerKeys.all });
            navigate('/customers');
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Nie udało się utworzyć kontrahenta');
          }
        }}
        onCancel={() => navigate('/customers')}
        isLoading={create.isPending}
      />
    </div>
  );
}

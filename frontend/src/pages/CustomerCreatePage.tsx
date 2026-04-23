import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CustomerForm } from '@/components/features/CustomerForm';
import { Button } from '@/components/ui/Button';
import { useCreateCustomerMutation } from '@/query/use-customers';
import { authStorage } from '@/services/api';
import type { CustomerWrite } from '@/types';

export function CustomerCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const create = useCreateCustomerMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/customers')}>
          Back to list
        </Button>
      </div>
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
            navigate('/customers');
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not create customer');
          }
        }}
        onCancel={() => navigate('/customers')}
        isLoading={create.isPending}
      />
    </div>
  );
}

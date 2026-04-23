import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { WarehouseForm } from '@/components/features/warehouses/WarehouseForm';
import { Button } from '@/components/ui/Button';
import { useCreateWarehouseMutation } from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import type { WarehouseWrite } from '@/types';

export function WarehouseCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const create = useCreateWarehouseMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/warehouses')}>
          Back to list
        </Button>
      </div>
      {submitError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}
      <WarehouseForm
        onSubmit={async (data: WarehouseWrite) => {
          setSubmitError(null);
          try {
            await create.mutateAsync(data);
            navigate('/warehouses');
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not create warehouse');
          }
        }}
        onCancel={() => navigate('/warehouses')}
        isLoading={create.isPending}
      />
    </div>
  );
}

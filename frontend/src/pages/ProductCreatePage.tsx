import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ProductForm } from '@/components/features/ProductForm';
import { Button } from '@/components/ui/Button';
import { useCreateProductMutation } from '@/query/use-products';
import { authStorage } from '@/services/api';
import type { ProductWrite } from '@/types';

export function ProductCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const create = useCreateProductMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/products')}>
          Back to list
        </Button>
      </div>
      {submitError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}
      <ProductForm
        onSubmit={async (data: ProductWrite) => {
          setSubmitError(null);
          try {
            await create.mutateAsync(data);
            navigate('/products');
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not create product');
          }
        }}
        onCancel={() => navigate('/products')}
        isLoading={create.isPending}
      />
    </div>
  );
}

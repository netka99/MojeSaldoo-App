import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ProductForm } from '@/components/features/ProductForm';
import { Button } from '@/components/ui/Button';
import { productKeys } from '@/query/keys';
import { useProductQuery, useUpdateProductMutation } from '@/query/use-products';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ProductWrite } from '@/types';

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

function productBodyForPut(data: ProductWrite): ProductWrite {
  const { id: _id, ...rest } = data as ProductWrite & { id?: string };
  return rest;
}

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: product, isLoading, isError, error, refetch } = useProductQuery(id);
  const update = useUpdateProductMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!id) {
    return <Navigate to="/products" replace />;
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
            Edytuj produkt
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {product?.name ?? (isLoading ? 'Ładowanie…' : '')}
          </p>
        </div>
      </header>

      {isError && (
        <div
          className="shadow-soft flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Nie udało się wczytać produktu'}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {isLoading && !product && !isError && (
        <p className="py-8 text-center text-sm text-muted-foreground">Ładowanie karty produktu…</p>
      )}

      {product && (
        <>
          {submitError && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {submitError}
            </p>
          )}
          <ProductForm
            product={product}
            onSubmit={async (data: ProductWrite) => {
              setSubmitError(null);
              try {
                await update.mutateAsync({ id, body: productBodyForPut(data) });
                await queryClient.invalidateQueries({ queryKey: productKeys.all });
                navigate('/products');
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian');
              }
            }}
            onCancel={() => navigate(-1)}
            isLoading={update.isPending}
          />

          <div className="shadow-soft rounded-2xl bg-surface-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Stan magazynowy
            </p>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              Korektę ilości w magazynie zapisujesz osobno — nie wpływa na dane katalogowe (cena, VAT, SKU).
            </p>
            <Link
              to={`/products/${id}/adjust-stock`}
              className={cn(
                'mt-3 inline-flex h-9 items-center justify-center rounded-2xl bg-surface-card px-4 text-sm font-medium text-on-surface shadow-[0_2px_12px_rgba(26,28,31,0.08)] ring-offset-background transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95',
              )}
            >
              Korekta stanów magazynowych
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

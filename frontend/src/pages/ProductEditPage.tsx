import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ProductForm } from '@/components/features/ProductForm';
import { Button } from '@/components/ui/Button';
import { productKeys } from '@/query/keys';
import { useProductQuery, useUpdateProductMutation, useDeleteProductMutation } from '@/query/use-products';
import { openLabelPrintWindow } from '@/lib/openLabelPrintWindow';
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

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.75} />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
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
  const deleteMutation = useDeleteProductMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        <Link
          to={`/products/${id}/movements`}
          className="shadow-soft flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-surface-card px-3 text-[13px] font-medium text-on-surface transition-colors hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Historia ruchów"
        >
          <ClockIcon className="h-4 w-4 text-muted-foreground" />
          <span className="hidden sm:inline">Historia ruchów</span>
        </Link>
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

          {/* ── Delete zone ──────────────────────────────────────── */}
          <div className="shadow-soft rounded-2xl border border-destructive/20 bg-surface-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Usuń produkt
            </p>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              Możliwe tylko gdy produkt nie ma ruchów magazynowych, zamówień, WZ/PZ ani faktur.
            </p>

            {deleteError && (
              <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                {deleteError}
              </p>
            )}

            {!confirmDelete ? (
              <button
                type="button"
                className="mt-3 rounded-xl border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/5"
                onClick={() => { setDeleteError(null); setConfirmDelete(true); }}
              >
                Usuń produkt
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">Na pewno usunąć?</span>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  className="rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  onClick={async () => {
                    setDeleteError(null);
                    try {
                      await deleteMutation.mutateAsync(id!);
                      navigate('/products');
                    } catch (e: unknown) {
                      const err = e as { response?: { data?: { blockers?: string[]; detail?: string } } };
                      const blockers = err?.response?.data?.blockers;
                      setDeleteError(
                        blockers?.length
                          ? blockers.join(' ')
                          : (e instanceof Error ? e.message : 'Nie udało się usunąć produktu.')
                      );
                      setConfirmDelete(false);
                    }
                  }}
                >
                  {deleteMutation.isPending ? 'Usuwanie…' : 'Tak, usuń'}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                  onClick={() => setConfirmDelete(false)}
                >
                  Anuluj
                </button>
              </div>
            )}
          </div>

          <div className="shadow-soft rounded-2xl bg-surface-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Stan magazynowy
            </p>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              Korektę ilości w magazynie zapisujesz osobno — nie wpływa na dane katalogowe (cena, VAT, SKU).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/products/${id}/adjust-stock`}
                className={cn(
                  'inline-flex h-9 items-center justify-center rounded-2xl bg-surface-card px-4 text-sm font-medium text-on-surface shadow-[0_2px_12px_rgba(26,28,31,0.08)] ring-offset-background transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95',
                )}
              >
                Korekta stanów magazynowych
              </Link>
              <Link
                to={`/products/${id}/movements`}
                className={cn(
                  'inline-flex h-9 items-center justify-center rounded-2xl bg-surface-card px-4 text-sm font-medium text-on-surface shadow-[0_2px_12px_rgba(26,28,31,0.08)] ring-offset-background transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95',
                )}
              >
                Historia ruchów
              </Link>
              <button
                type="button"
                onClick={() =>
                  openLabelPrintWindow({
                    id: product.id,
                    name: product.name,
                    sku: product.sku ?? null,
                    barcode: product.barcode ?? null,
                    unit: product.unit,
                    price_gross: product.price_gross,
                  })
                }
                className={cn(
                  'inline-flex h-9 items-center justify-center rounded-2xl bg-surface-card px-4 text-sm font-medium text-on-surface shadow-[0_2px_12px_rgba(26,28,31,0.08)] ring-offset-background transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95',
                )}
              >
                Drukuj etykietę
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

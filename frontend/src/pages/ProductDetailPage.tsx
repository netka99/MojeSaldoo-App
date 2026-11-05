import { Navigate, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useProductQuery } from '@/query/use-products';
import { Button } from '@/components/ui/Button';

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  trade: 'Towar handlowy',
  material: 'Surowiec',
  finished: 'Wyrób gotowy',
  service: 'Usługa',
};

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function fmt(v: string | number | null | undefined) {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (Number.isNaN(n)) return '—';
  return pln.format(n);
}

function fmtQty(v: string | number | null | undefined) {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
}

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <p className="text-sm font-medium text-slate-800">{label}</p>
      <p className="text-sm text-slate-600 text-right">{value}</p>
    </div>
  );
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: product, isLoading, isError, error, refetch } = useProductQuery(id);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) return <Navigate to="/products" replace />;

  return (
    <div className="safe-area-pt safe-area-pb mx-auto max-w-xl space-y-3 px-4 pb-8 pt-4 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:h-10 md:w-10"
          aria-label="Wróć"
        >
          <ChevronLeftIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold tracking-tight text-slate-900 md:text-xl">
            {product?.name ?? (isLoading ? 'Ładowanie…' : 'Produkt')}
          </h1>
          {product && (
            <p className="text-xs text-slate-500">
              {PRODUCT_TYPE_LABEL[product.product_type] ?? product.product_type}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to={`/products/${id}/movements`}
            className="flex h-9 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.75} />
              <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Historia</span>
          </Link>
          <Link
            to={`/products/${id}/edit`}
            className="flex h-9 items-center gap-1.5 rounded-2xl bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Edytuj
          </Link>
        </div>
      </header>

      {isError && (
        <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Nie udało się wczytać produktu'}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}

      {isLoading && !product && (
        <p className="py-8 text-center text-sm text-slate-500">Ładowanie…</p>
      )}

      {product && (
        <>
          {/* image */}
          {product.image_url && (
            <div className="flex justify-center">
              <img src={product.image_url} alt={product.name} className="h-32 w-32 rounded-2xl object-cover shadow-apple-sm" />
            </div>
          )}

          {/* main info */}
          <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8}>
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M3 9h18M9 21V9" strokeLinecap="round" />
                </svg>
              </span>
              <h2 className="text-sm font-semibold text-slate-900">Dane podstawowe</h2>
            </div>
            <div className="divide-y divide-slate-100">
              <Row label="Nazwa" value={product.name} />
              <Row label="Typ" value={PRODUCT_TYPE_LABEL[product.product_type] ?? product.product_type} />
              <Row label="Jednostka" value={product.unit || '—'} />
              <Row label="SKU" value={product.sku || '—'} />
              <Row label="Status" value={
                <span className={product.is_active ? 'font-medium text-emerald-700' : 'text-slate-400'}>
                  {product.is_active ? 'Aktywny' : 'Nieaktywny'}
                </span>
              } />
              {product.description && <Row label="Opis" value={product.description} />}
            </div>
          </section>

          {/* prices */}
          {product.product_type !== 'material' && (
            <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
              <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v10M9 9.5h4.5a1.5 1.5 0 010 3H10.5a1.5 1.5 0 000 3H15" strokeLinecap="round" />
                  </svg>
                </span>
                <h2 className="text-sm font-semibold text-slate-900">Ceny</h2>
              </div>
              <div className="divide-y divide-slate-100">
                <Row label="Netto" value={fmt(product.price_net)} />
                <Row label="VAT" value={product.vat_rate ?? '—'} />
                <Row label="Brutto" value={<span className="font-semibold text-slate-900">{fmt(product.price_gross)}</span>} />
              </div>
            </section>
          )}

          {/* stock */}
          {product.product_type !== 'service' && (
            <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
              <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M20 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM1 7l3-4h16l3 4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <h2 className="text-sm font-semibold text-slate-900">Stan magazynowy</h2>
              </div>
              <div className="divide-y divide-slate-100">
                <Row label="Stan łączny" value={
                  <span className="font-semibold tabular-nums text-slate-900">
                    {fmtQty(product.stock_total)} {product.unit || ''}
                  </span>
                } />
                {product.avg_cost && parseFloat(String(product.avg_cost)) > 0 && (
                  <Row label="Śr. koszt zakupu" value={fmt(product.avg_cost)} />
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

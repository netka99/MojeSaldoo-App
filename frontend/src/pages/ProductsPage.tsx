import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ProductList } from '@/components/features/products/ProductList';
import { ProductImportDialog } from '@/components/features/products/ProductImportDialog';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { ReportShell, reportButtonClass, reportTitleClass } from '@/lib/reportSurface';

export function ProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canManageProducts = usePermission('can_manage_products');
  const [importOpen, setImportOpen] = useState(false);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <ReportShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={reportTitleClass}>Produkty</h1>
        {canManageProducts && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={reportButtonClass} onClick={() => setImportOpen(true)}>
              Importuj
            </button>
            <button
              type="button"
              onClick={() => navigate('/products/new')}
              className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Dodaj produkt
            </button>
          </div>
        )}
      </div>
      <ProductList onRowClick={canManageProducts ? (p) => navigate(`/products/${p.id}/edit`) : undefined} />
      {importOpen && <ProductImportDialog onClose={() => setImportOpen(false)} />}
    </ReportShell>
  );
}

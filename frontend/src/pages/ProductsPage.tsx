import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ProductList } from '@/components/features/products/ProductList';
import { ProductImportDialog } from '@/components/features/products/ProductImportDialog';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';

export function ProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canManageProducts = usePermission('can_manage_products');
  const [importOpen, setImportOpen] = useState(false);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl justify-end gap-2">
        {canManageProducts && (
          <>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              Importuj
            </Button>
            <Button type="button" onClick={() => navigate('/products/new')}>
              Dodaj produkt
            </Button>
          </>
        )}
      </div>
      <ProductList onRowClick={canManageProducts ? (p) => navigate(`/products/${p.id}/edit`) : undefined} />
      {importOpen && <ProductImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

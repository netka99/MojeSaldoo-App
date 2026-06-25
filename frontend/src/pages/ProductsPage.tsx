import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ProductList } from '@/components/features/products/ProductList';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';

export function ProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canManageProducts = usePermission('can_manage_products');

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl justify-end">
        {canManageProducts && (
          <Button type="button" onClick={() => navigate('/products/new')}>
            Dodaj produkt
          </Button>
        )}
      </div>
      <ProductList onRowClick={canManageProducts ? (p) => navigate(`/products/${p.id}/edit`) : undefined} />
    </div>
  );
}

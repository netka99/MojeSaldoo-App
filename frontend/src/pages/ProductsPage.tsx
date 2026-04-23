import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ProductList } from '@/components/features/products/ProductList';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';

export function ProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl justify-end">
        <Button type="button" onClick={() => navigate('/products/new')}>
          Add product
        </Button>
      </div>
      <ProductList />
    </div>
  );
}

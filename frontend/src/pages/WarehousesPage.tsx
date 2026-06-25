import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { WarehouseList } from '@/components/features/warehouses/WarehouseList';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';

export function WarehousesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canManageProducts = usePermission('can_manage_warehouses');

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="space-y-4 p-6">
      {canManageProducts && (
        <div className="mx-auto flex max-w-6xl justify-end">
          <Button type="button" onClick={() => navigate('/warehouses/new')}>
            Dodaj magazyn
          </Button>
        </div>
      )}
      <WarehouseList onRowClick={(w) => navigate(`/warehouses/${w.id}`)} />
    </div>
  );
}

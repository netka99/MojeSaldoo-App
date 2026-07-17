import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { WarehouseList } from '@/components/features/warehouses/WarehouseList';
import { WarehouseImportDialog } from '@/components/features/warehouses/WarehouseImportDialog';
import { Button } from '@/components/ui/Button';
import { authStorage } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';

export function WarehousesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const canManageProducts = usePermission('can_manage_warehouses');
  const [importOpen, setImportOpen] = useState(false);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="space-y-4 p-6">
      {canManageProducts && (
        <div className="mx-auto flex max-w-6xl justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
            Importuj stany
          </Button>
          <Button type="button" onClick={() => navigate('/warehouses/new')}>
            Dodaj magazyn
          </Button>
        </div>
      )}
      {importOpen && <WarehouseImportDialog onClose={() => setImportOpen(false)} />}
      <WarehouseList onRowClick={(w) => navigate(`/warehouses/${w.id}`)} />
    </div>
  );
}

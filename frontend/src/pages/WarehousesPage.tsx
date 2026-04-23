import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { WarehouseList } from '@/components/features/warehouses/WarehouseList';
import { Button } from '@/components/ui/Button';
import { useDeleteWarehouseMutation } from '@/query/use-warehouses';
import { authStorage } from '@/services/api';
import type { Warehouse } from '@/types';

export function WarehousesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const remove = useDeleteWarehouseMutation();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const handleDelete = async (w: Warehouse) => {
    if (!window.confirm(`Delete warehouse ${w.code} (${w.name})?`)) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(w.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto flex max-w-6xl justify-end">
        <Button type="button" onClick={() => navigate('/warehouses/new')}>
          Add warehouse
        </Button>
      </div>
      {deleteError && (
        <div className="mx-auto max-w-6xl rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {deleteError}
        </div>
      )}
      <WarehouseList onDelete={handleDelete} />
    </div>
  );
}

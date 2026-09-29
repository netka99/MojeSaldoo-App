import { useEffect } from 'react';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { useWarehouseListQuery } from '@/query/use-warehouses';

/** When warehouse management is off, stock still lives on one implicit MG. */
export function useSilentWarehouse() {
  const warehousesEnabled = useModuleGuard('warehouses');
  const listQ = useWarehouseListQuery(1);
  const first = listQ.data?.results?.[0];
  const silent = !warehousesEnabled;

  return {
    silent,
    warehouseId: first?.id ?? '',
    warehouseName: first?.name ?? first?.code ?? '',
    isLoading: listQ.isPending,
  };
}

/** Prefill a warehouse id once the default MG is known. */
export function usePrefillWarehouseId(
  currentId: string,
  setId: (id: string) => void,
) {
  const { warehouseId, isLoading } = useSilentWarehouse();
  useEffect(() => {
    if (!currentId && warehouseId) setId(warehouseId);
  }, [currentId, warehouseId, setId, isLoading]);
}

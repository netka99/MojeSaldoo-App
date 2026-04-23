import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { warehouseService } from '@/services/warehouse.service';
import type { WarehouseWrite } from '@/types';
import { warehouseKeys } from './keys';

export function useWarehouseListQuery(page = 1) {
  return useQuery({
    queryKey: warehouseKeys.list({ page }),
    queryFn: () => warehouseService.fetchList({ page, ordering: 'code' }),
  });
}

export function useCreateWarehouseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WarehouseWrite) => warehouseService.createItem(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

export function useUpdateWarehouseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WarehouseWrite }) => warehouseService.updateItem(id, body),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.detail(id) });
    },
  });
}

export function useDeleteWarehouseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => warehouseService.deleteItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
    },
  });
}

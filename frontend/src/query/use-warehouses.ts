import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { warehouseService } from '@/services/warehouse.service';
import type { ImportWarehousesResult } from '@/services/warehouse.service';
import type { WarehouseWrite } from '@/types';
import { stockSnapshotKeys, warehouseKeys, warehouseStockKeys, productKeys } from './keys';

export function useWarehouseListQuery(page = 1) {
  return useQuery({
    queryKey: warehouseKeys.list({ page }),
    queryFn: () => warehouseService.fetchList({ page, ordering: 'code' }),
  });
}

export function useWarehouseQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? warehouseKeys.detail(id) : [...warehouseKeys.details(), 'pending'],
    queryFn: () => warehouseService.fetchById(id!),
    enabled: Boolean(id) && enabled,
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
      void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.byWarehouse(id) });
    },
  });
}

export function useDeleteWarehouseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => warehouseService.deleteItem(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
      void queryClient.invalidateQueries({ queryKey: warehouseKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.byWarehouse(id) });
    },
  });
}

export type TransferItem = { product_id: string; quantity: number | string };

export function useTransferStockMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    { transferred: number; source: string; destination: string },
    Error,
    { sourceWarehouseId: string; destination_warehouse_id: string; items: TransferItem[]; notes?: string }
  >({
    mutationFn: ({ sourceWarehouseId, ...body }) =>
      api.post(`/warehouses/${sourceWarehouseId}/transfer/`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useImportStockMutation() {
  const queryClient = useQueryClient();
  return useMutation<ImportWarehousesResult, Error, { file: File; dryRun: boolean }>({
    mutationFn: ({ file, dryRun }) => warehouseService.importStock(file, dryRun),
    onSuccess: (_data, { dryRun }) => {
      if (!dryRun) {
        void queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
        void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
        void queryClient.invalidateQueries({ queryKey: productKeys.all });
      }
    },
  });
}

export function useWarehouseStockQuery(
  warehouseId: string | undefined,
  params?: { below_minimum?: boolean; search?: string },
) {
  return useQuery({
    queryKey: warehouseId
      ? warehouseStockKeys.byWarehouse(warehouseId, params)
      : warehouseStockKeys.all,
    queryFn: () => warehouseService.fetchStock(warehouseId!, params),
    enabled: Boolean(warehouseId),
  });
}

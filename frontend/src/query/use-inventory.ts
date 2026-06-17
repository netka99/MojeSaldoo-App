import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryService } from '@/services/inventory.service';
import type { InventoryCountCreate, InventoryUpdateItemsPayload } from '@/types/inventory.types';
import { inventoryKeys } from './keys';

export function useInventoryListQuery(page = 1) {
  return useQuery({
    queryKey: inventoryKeys.list(page),
    queryFn: () => inventoryService.fetchList({ page, page_size: 20 }),
  });
}

export function useInventoryDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.detail(id ?? ''),
    queryFn: () => inventoryService.fetchDetail(id!),
    enabled: Boolean(id),
  });
}

export function useCreateInventoryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: InventoryCountCreate) => inventoryService.create(data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}

export function useUpdateInventoryItemsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: InventoryUpdateItemsPayload }) =>
      inventoryService.updateItems(id, data),
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
      void qc.setQueryData(inventoryKeys.detail(doc.id), doc);
    },
  });
}

export function useCompleteInventoryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => inventoryService.complete(id),
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
      void qc.setQueryData(inventoryKeys.detail(doc.id), doc);
    },
  });
}

export function useCancelInventoryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => inventoryService.cancel(id),
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
      void qc.setQueryData(inventoryKeys.detail(doc.id), doc);
    },
  });
}

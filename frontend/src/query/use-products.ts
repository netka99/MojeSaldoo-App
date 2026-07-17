import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productService, type StockUpdatePayload, type ImportProductsResult } from '@/services/product.service';
import type { ProductWrite } from '@/types';
import { productKeys, stockMovementKeys, stockSnapshotKeys, warehouseStockKeys, type StockMovementParams } from './keys';

export function useProductListQuery(page: number, sku: string, isService?: boolean) {
  return useQuery({
    queryKey: productKeys.list({ page, sku, isService }),
    queryFn: () =>
      productService.fetchList({
        page,
        sku: sku || undefined,
        ordering: '-created_at',
        is_service: isService,
      }),
  });
}

export function useProductQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? productKeys.detail(id) : [...productKeys.details(), 'pending'],
    queryFn: () => productService.fetchById(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductWrite) => productService.createItem(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useUpdateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProductWrite }) => productService.updateItem(id, body),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(id) });
    },
  });
}

export function usePatchProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ProductWrite> }) =>
      productService.partialUpdateItem(id, body),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(id) });
    },
  });
}

export function useDeleteProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => productService.deleteItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useUpdateProductStockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: StockUpdatePayload }) =>
      productService.updateStock(id, body),
    onSuccess: (_data, { id, body }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
      if (body.warehouse_id) {
        void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.byWarehouse(body.warehouse_id) });
      }
    },
  });
}

export function useStockSnapshotQuery(warehouseId: string | undefined) {
  return useQuery({
    queryKey: warehouseId ? stockSnapshotKeys.byWarehouse(warehouseId) : stockSnapshotKeys.all,
    queryFn: () => productService.fetchStockSnapshot(warehouseId!),
    enabled: Boolean(warehouseId),
  });
}

export function useAllProductsQuery() {
  return useQuery({
    queryKey: [...productKeys.lists(), 'all'],
    queryFn: () => productService.fetchList({ page_size: 200, ordering: 'name' }),
  });
}

export function useImportProductsMutation() {
  const queryClient = useQueryClient();
  return useMutation<ImportProductsResult, Error, { file: File; dryRun: boolean }>({
    mutationFn: ({ file, dryRun }) => productService.importProducts(file, dryRun),
    onSuccess: (data) => {
      if (!data.dry_run) {
        void queryClient.invalidateQueries({ queryKey: productKeys.all });
      }
    },
  });
}

export function useStockMovementsQuery(params: StockMovementParams) {
  return useQuery({
    queryKey: stockMovementKeys.list(params),
    queryFn: () => productService.fetchStockMovements(params),
    enabled: Boolean(params.product || params.warehouse),
  });
}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productService, type StockUpdatePayload } from '@/services/product.service';
import type { ProductWrite } from '@/types';
import { productKeys } from './keys';

export function useProductListQuery(page: number, sku: string) {
  return useQuery({
    queryKey: productKeys.list({ page, sku }),
    queryFn: () =>
      productService.fetchList({
        page,
        sku: sku || undefined,
        ordering: '-created_at',
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
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(id) });
    },
  });
}

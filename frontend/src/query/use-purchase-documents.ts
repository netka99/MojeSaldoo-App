import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  purchaseDocumentService,
  type PurchaseDocListParams,
  type PurchaseDocumentWrite,
} from '@/services/purchase-document.service';
import { purchaseDocumentKeys } from './keys';

export type PurchaseDocListFilters = Omit<PurchaseDocListParams, 'page'>;

export function usePurchaseDocumentListQuery(page: number, filters: PurchaseDocListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: purchaseDocumentKeys.list({ page, companyId, ...filters }),
    queryFn: () => purchaseDocumentService.fetchList({ page, ...filters }),
    enabled: Boolean(companyId),
  });
}

export function usePurchaseDocumentQuery(id: string | undefined) {
  return useQuery({
    queryKey: id ? purchaseDocumentKeys.detail(id) : [...purchaseDocumentKeys.details(), 'pending'],
    queryFn: () => purchaseDocumentService.fetchById(id!),
    enabled: Boolean(id),
  });
}

export function useCreatePurchaseDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PurchaseDocumentWrite) => purchaseDocumentService.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

export function usePatchPurchaseDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PurchaseDocumentWrite }) =>
      purchaseDocumentService.patch(id, data),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.detail(id) });
    },
  });
}

export function useDeletePurchaseDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchaseDocumentService.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

export function useMarkPurchaseDocPaidMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isPaid }: { id: string; isPaid: boolean }) =>
      purchaseDocumentService.markPaid(id, isPaid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

export function useSetPurchaseDocCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, category }: { id: string; category: string | null }) =>
      purchaseDocumentService.setCategory(id, category),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

export function useCreatePzFromPurchaseDocMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, warehouseId }: { id: string; warehouseId: string }) =>
      purchaseDocumentService.createPz(id, warehouseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

export function useLinkPzMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pzId }: { id: string; pzId: string }) =>
      purchaseDocumentService.linkPz(id, pzId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

export function useSetLinecategoriesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lineCategories }: { id: string; lineCategories: Record<string, string> }) =>
      purchaseDocumentService.setLineCategories(id, lineCategories),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: purchaseDocumentKeys.all });
    },
  });
}

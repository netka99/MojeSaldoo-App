import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { deliveryService, type DeliveryListParams } from '@/services/delivery.service';
import type {
  DeliveryCompletePayload,
  DeliveryDocument,
  DeliveryDocumentCreate,
  DeliveryDocumentPatch,
  VanLoadingPayload,
  VanReconciliationPayload,
} from '@/types';
import { deliveryKeys, orderKeys } from './keys';

/** Filters for `useDeliveryListQuery` (excludes `page` — pass page as the first argument). */
export type DeliveryListFilters = Omit<DeliveryListParams, 'page'>;

/**
 * Paginated delivery documents. Cache key includes `page`, active company, and filter fields.
 */
export function useDeliveryListQuery(page: number, filters: DeliveryListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: deliveryKeys.list({ page, companyId, ...filters }),
    queryFn: () => deliveryService.fetchList({ page, ...filters }),
  });
}

export function useDeliveryQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? deliveryKeys.detail(id) : [...deliveryKeys.details(), 'pending'],
    queryFn: () => deliveryService.fetchById(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeliveryDocumentCreate) => deliveryService.createDocument(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

export function usePatchDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DeliveryDocumentPatch }) =>
      deliveryService.patchDocument(id, data),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
    },
  });
}

export function useDeleteDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deliveryService.deleteDocument(id),
    onSuccess: (_void, id) => {
      void queryClient.removeQueries({ queryKey: deliveryKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

export function useSaveDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deliveryService.saveDocument(id),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
    },
  });
}

export function useStartDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deliveryService.startDelivery(id),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
    },
  });
}

export function useCompleteDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: DeliveryCompletePayload }) =>
      deliveryService.completeDelivery(id, data),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

/**
 * Imperative `GET` that creates a draft WZ; invalidates delivery + order lists so remaining qty stays fresh.
 */
export function useGenerateDeliveryForOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => deliveryService.generateForOrder(orderId),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useVanLoadingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VanLoadingPayload) => deliveryService.vanLoading(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

export function useVanReconciliationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, data }: { warehouseId: string; data: VanReconciliationPayload }) =>
      deliveryService.vanReconciliation(warehouseId, data),
    onSuccess: () => {
      // Invalidate delivery docs and product stock data after reconciliation
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

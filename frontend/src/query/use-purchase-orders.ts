import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  purchaseOrderService,
  type SupplierOrderListParams,
  type CreatePzBody,
} from '@/services/purchase-order.service';
import type { SupplierOrderCreate } from '@/types/purchase-order.types';
import { supplierOrderKeys } from './keys';

export type SupplierOrderListFilters = Omit<SupplierOrderListParams, 'page'>;

export function useSupplierOrderListQuery(page = 1, filters: SupplierOrderListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: supplierOrderKeys.list({ page, companyId, ...filters }),
    queryFn: () => purchaseOrderService.fetchList({ page, ...filters }),
    enabled: Boolean(companyId),
  });
}

export function useSupplierOrderDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: supplierOrderKeys.detail(id ?? ''),
    queryFn: () => purchaseOrderService.fetchById(id!),
    enabled: Boolean(id),
  });
}

export function useCreateSupplierOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierOrderCreate) => purchaseOrderService.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplierOrderKeys.lists() });
    },
  });
}

export function useSendSupplierOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchaseOrderService.send(id),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: supplierOrderKeys.lists() });
      qc.setQueryData(supplierOrderKeys.detail(updated.id), updated);
    },
  });
}

export function useCancelSupplierOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchaseOrderService.cancel(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: supplierOrderKeys.lists() });
      qc.invalidateQueries({ queryKey: supplierOrderKeys.detail(id) });
    },
  });
}

export function useCreatePzFromSupplierOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreatePzBody }) =>
      purchaseOrderService.createPz(id, body),
    onSuccess: (_pz, { id }) => {
      qc.invalidateQueries({ queryKey: supplierOrderKeys.detail(id) });
      qc.invalidateQueries({ queryKey: supplierOrderKeys.lists() });
      // Invalidate delivery list so new PZ appears there
      qc.invalidateQueries({ queryKey: ['delivery-documents'] });
    },
  });
}

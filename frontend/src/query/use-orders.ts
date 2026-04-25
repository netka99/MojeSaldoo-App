import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { orderService, type OrderListParams } from '@/services/order.service';
import type { OrderCreate, Order } from '@/types';
import { orderKeys } from './keys';

/** Filters for `useOrderListQuery` (excludes `page` — pass page as the first argument). */
export type OrderListFilters = Omit<OrderListParams, 'page'>;

/**
 * Paginated list of orders. Cache key includes `page`, active company, and all filter fields.
 * Default list ordering is server-side; pass `ordering` in `filters` to override.
 */
export function useOrderListQuery(page: number, filters: OrderListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: orderKeys.list({ page, companyId, ...filters }),
    queryFn: () => orderService.fetchList({ page, ...filters }),
  });
}

export function useOrderQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? orderKeys.detail(id) : [...orderKeys.details(), 'pending'],
    queryFn: () => orderService.fetchById(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderCreate) => orderService.createOrder(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useConfirmOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.confirmOrder(id),
    onSuccess: (data: Order) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(data.id) });
    },
  });
}

export function useCancelOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.cancelOrder(id),
    onSuccess: (data: Order) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(data.id) });
    },
  });
}

export function useDeleteOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.deleteOrder(id),
    onSuccess: (_void, id) => {
      void queryClient.removeQueries({ queryKey: orderKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

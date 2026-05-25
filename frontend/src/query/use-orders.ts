import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { orderService, type OrderListParams } from '@/services/order.service';
import type { OrderChangeLogEntry, OrderCreate, OrderUpdate, Order, OrderStatus } from '@/types';
import { orderKeys } from './keys';

/** Filters for `useOrderListQuery` (excludes `page` — pass page as the first argument). */
export type OrderListFilters = Omit<OrderListParams, 'page'>;

export function buildOrderListApiFilters(
  search: string,
  status: '' | OrderStatus,
  dateFrom: string,
  dateTo: string,
): OrderListFilters {
  const filters: OrderListFilters = {};
  const t = search.trim();
  if (t) filters.search = t;
  if (status) filters.status = status;
  if (dateFrom) filters.delivery_date_after = dateFrom;
  if (dateTo) filters.delivery_date_before = dateTo;
  return filters;
}

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

/**
 * All orders with delivery_date == date (exact day).
 * Fetches all results (page_size=100) — day views don't need pagination.
 * Disabled when date is empty string.
 */
export function useOrdersByDateQuery(date: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: orderKeys.byDate(date, companyId),
    queryFn: () =>
      orderService.fetchList({ delivery_date: date, page: 1, page_size: 100 }),
    enabled: Boolean(date) && Boolean(companyId),
  });
}

/**
 * All orders for a specific customer, sorted newest first.
 * Returns the results array directly (no pagination — fetches up to 200 orders).
 */
export function useOrdersByCustomerQuery(customerId: string | undefined, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: orderKeys.list({ page: 1, companyId, customer: customerId, ordering: '-delivery_date' }),
    queryFn: () =>
      orderService.fetchList({ page: 1, customer: customerId, page_size: 200, ordering: '-delivery_date' }),
    enabled: Boolean(customerId) && Boolean(companyId) && enabled,
    select: (data) => data.results,
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

export function useUpdateOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OrderUpdate }) =>
      orderService.updateOrder(id, body),
    onSuccess: (data: Order) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.changelog(data.id) });
    },
  });
}

export function useOrderChangelogQuery(id: string | undefined) {
  return useQuery({
    queryKey: id ? orderKeys.changelog(id) : [...orderKeys.details(), 'changelog-pending'],
    queryFn: () => orderService.fetchChangelog(id!),
    enabled: Boolean(id),
    select: (data): OrderChangeLogEntry[] => data,
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

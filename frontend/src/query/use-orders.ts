import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { orderService, type OrderListParams } from '@/services/order.service';
import type { OrderChangeLogEntry, OrderCreate, OrderUpdate, Order, OrderStatus } from '@/types';
import type { OrderProductSummaryRow } from '@/services/order.service';
import { deliveryKeys, orderKeys } from './keys';

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
 * All open orders (excluding cancelled and invoiced), sorted by delivery_date ascending.
 * Used for the "all open orders" cross-day view. Fetches up to 300 orders.
 */
export function useOpenOrdersQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  // Show orders from last 60 days onward — avoids loading years of history
  // while still capturing recent undelivered orders and all future dates.
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 60);
  const delivery_date_after = dateFrom.toISOString().slice(0, 10);

  return useQuery({
    queryKey: [...orderKeys.lists(), { companyId, ordering: 'delivery_date', view: 'open', delivery_date_after }] as const,
    queryFn: () =>
      orderService.fetchList({ page: 1, page_size: 500, ordering: 'delivery_date', delivery_date_after }),
    enabled: Boolean(companyId),
    staleTime: 2 * 60 * 1000,
    select: (data) =>
      data.results.filter((o) => o.status !== 'cancelled' && o.status !== 'invoiced'),
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
    staleTime: 2 * 60 * 1000, // 2 minuty — dane trzymane w cache bez ponownego fetchu
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

export function useOrderProductSummaryQuery(params: OrderListParams, enabled: boolean) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: [...orderKeys.all, 'product-summary', companyId, params] as const,
    queryFn: (): Promise<OrderProductSummaryRow[]> => orderService.fetchProductSummary(params),
    enabled: Boolean(companyId) && enabled,
    staleTime: 30 * 1000,
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

export function useUnblockOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.unblockOrder(id),
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

export function useApplyWzCorrectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, wzKorId }: { orderId: string; wzKorId: string }) =>
      orderService.applyWzCorrection(orderId, wzKorId),
    onSuccess: (_data, { orderId }) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      // Invalidate delivery docs so order_correction_applied flag refreshes and banner disappears
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

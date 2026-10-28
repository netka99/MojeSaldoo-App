import { api } from './api';
import type { Order, OrderChangeLogEntry, OrderCreate, OrderUpdate, PaginatedOrders } from '../types';

/**
 * Query string for `GET /api/orders/` — `OrderViewSet` + `OrderFilter` + pagination/search/ordering.
 */
export type OrderListParams = {
  page?: number;
  /** When supported by the list endpoint, request a larger page (e.g. day views). */
  page_size?: number;
  search?: string;
  /** One of: `delivery_date`, `-delivery_date`, `created_at`, `-created_at`, `total_gross`, `-total_gross` (see backend `ordering_fields`). */
  ordering?: string;
  customer?: string;
  status?: string;
  delivery_date?: string;
  delivery_date_after?: string;
  delivery_date_before?: string;
  /** Delivered orders that have no invoice yet (django-filter). */
  without_invoice?: boolean;
  /** Exclude orders already assigned to an active van route. */
  exclude_routed?: boolean;
};

export type OrderProductSummaryRow = {
  product_name: string;
  unit: string;
  total_quantity: string;
  total_gross: string;
};

export const orderService = {
  fetchList: (params?: OrderListParams) =>
    api.get<PaginatedOrders>('/orders/', { params }),

  fetchProductSummary: (params?: OrderListParams) =>
    api.get<OrderProductSummaryRow[]>('/orders/product-summary/', { params }),

  fetchById: (id: string) => api.get<Order>(`/orders/${id}/`),

  createOrder: (data: OrderCreate) => api.post<Order>('/orders/', data),

  updateOrder: (id: string, data: OrderUpdate) => api.put<Order>(`/orders/${id}/`, data),

  confirmOrder: (id: string) => api.post<Order>(`/orders/${id}/confirm/`, {}),

  cancelOrder: (id: string) => api.post<Order>(`/orders/${id}/cancel/`, {}),

  unblockOrder: (id: string) => api.post<Order>(`/orders/${id}/unblock/`, {}),

  deleteOrder: (id: string) => api.delete<Record<string, never>>(`/orders/${id}/`),

  fetchChangelog: (id: string) => api.get<OrderChangeLogEntry[]>(`/orders/${id}/changelog/`),

  applyWzCorrection: (orderId: string, wzKorId: string) =>
    api.post<Order>(`/orders/${orderId}/apply-wz-correction/`, { wz_kor_id: wzKorId }),
};

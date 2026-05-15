import { api } from './api';
import type {
  DeliveryCompletePayload,
  DeliveryDocument,
  DeliveryDocumentCreate,
  DeliveryDocumentPatch,
  DeliveryDocumentPreviewPayload,
  DeliveryUpdateLinesPayload,
  PaginatedDeliveryDocuments,
  PendingReturnItem,
  VanLoadingPayload,
  VanReconciliationPayload,
  VanReconciliationResult,
} from '../types';

/**
 * Query string for `GET /api/delivery/` — filters + pagination + ordering.
 */
export type DeliveryListParams = {
  page?: number;
  /** One of: `issue_date`, `-issue_date`, `created_at`, `-created_at`, `document_number`, `status`, etc. */
  ordering?: string;
  order?: string;
  status?: string;
  document_type?: string;
  issue_date_after?: string;
  issue_date_before?: string;
};

const basePath = '/delivery/';

export const deliveryService = {
  fetchList: (params?: DeliveryListParams) =>
    api.get<PaginatedDeliveryDocuments>(basePath, { params }),

  fetchById: (id: string) => api.get<DeliveryDocument>(`${basePath}${id}/`),

  fetchPreview: (id: string) =>
    api.get<DeliveryDocumentPreviewPayload>(`${basePath}${id}/preview/`),

  createDocument: (data: DeliveryDocumentCreate) =>
    api.post<DeliveryDocument>(basePath, data),

  patchDocument: (id: string, data: DeliveryDocumentPatch) =>
    api.patch<DeliveryDocument>(`${basePath}${id}/`, data),

  deleteDocument: (id: string) => api.delete<Record<string, never>>(`${basePath}${id}/`),

  saveDocument: (id: string, returnItems?: PendingReturnItem[]) =>
    api.post<DeliveryDocument>(
      `${basePath}${id}/save/`,
      returnItems && returnItems.length > 0
        ? { return_items: returnItems.map(({ product_id, quantity, return_reason }) => ({ product_id, quantity, return_reason })) }
        : {},
    ),

  startDelivery: (id: string) =>
    api.post<DeliveryDocument>(`${basePath}${id}/start-delivery/`, {}),

  completeDelivery: (id: string, data?: DeliveryCompletePayload) =>
    api.post<DeliveryDocument>(`${basePath}${id}/complete/`, data ?? {}),

  updateLines: (id: string, data: DeliveryUpdateLinesPayload) =>
    api.post<DeliveryDocument>(`${basePath}${id}/update-lines/`, data),

  /** `GET` — creates draft WZ from confirmed order (remaining quantities per line on the server). */
  generateForOrder: (orderId: string) =>
    api.get<DeliveryDocument>(`${basePath}generate-for-order/${orderId}/`),

  /** `POST` — batch create draft WZ for multiple confirmed orders (one round-trip). */
  generateForOrders: (orderIds: string[]) =>
    api.post<{ documents: DeliveryDocument[] }>(`${basePath}generate-for-orders/`, {
      order_ids: orderIds,
    }),

  vanLoading: (data: VanLoadingPayload) =>
    api.post<DeliveryDocument>('/delivery/van-loading/', data),

  vanReconciliation: (warehouseId: string, data: VanReconciliationPayload) =>
    api.post<VanReconciliationResult>(`/delivery/van-reconciliation/${warehouseId}/`, data),
};

import { api } from './api';
import type {
  DeliveryCompletePayload,
  DeliveryDocument,
  DeliveryDocumentCreate,
  DeliveryDocumentPatch,
  PaginatedDeliveryDocuments,
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

  createDocument: (data: DeliveryDocumentCreate) =>
    api.post<DeliveryDocument>(basePath, data),

  patchDocument: (id: string, data: DeliveryDocumentPatch) =>
    api.patch<DeliveryDocument>(`${basePath}${id}/`, data),

  deleteDocument: (id: string) => api.delete<Record<string, never>>(`${basePath}${id}/`),

  saveDocument: (id: string) => api.post<DeliveryDocument>(`${basePath}${id}/save/`, {}),

  startDelivery: (id: string) =>
    api.post<DeliveryDocument>(`${basePath}${id}/start-delivery/`, {}),

  completeDelivery: (id: string, data?: DeliveryCompletePayload) =>
    api.post<DeliveryDocument>(`${basePath}${id}/complete/`, data ?? {}),

  /** `GET` — creates draft WZ from confirmed order (remaining quantities per line on the server). */
  generateForOrder: (orderId: string) =>
    api.get<DeliveryDocument>(`${basePath}generate-for-order/${orderId}/`),

  vanLoading: (data: VanLoadingPayload) =>
    api.post<DeliveryDocument>('/delivery/van-loading/', data),

  vanReconciliation: (warehouseId: string, data: VanReconciliationPayload) =>
    api.post<VanReconciliationResult>(`/delivery/van-reconciliation/${warehouseId}/`, data),
};

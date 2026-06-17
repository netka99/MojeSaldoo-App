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
  PzCompleteItemRow,
  PzCreatePayload,
  PzKorPayload,
  RwCreatePayload,
  StandaloneWzCreate,
  VanLoadingPayload,
  VanReconciliationPayload,
  VanReconciliationResult,
} from '../types';

/**
 * Query string for `GET /api/delivery/` — filters + pagination + ordering.
 */
export type DeliveryListParams = {
  page?: number;
  page_size?: number;
  /** One of: `issue_date`, `-issue_date`, `created_at`, `-created_at`, `document_number`, `status`, etc. */
  ordering?: string;
  order?: string;
  order_ids?: string;
  to_customer?: string;
  status?: string;
  document_type?: string;
  from_warehouse_id?: string;
  van_route?: string;
  issue_date_after?: string;
  issue_date_before?: string;
  /** Filter by supplier UUID. */
  from_supplier?: string;
  /** When true, returns only PZ documents with no linked KSeF invoice. */
  ksef_unlinked?: boolean;
  /**
   * When true, the list response includes nested `items`, `return_documents`, and `linked_invoices`.
   * Omit for the paginated "Lista" view; pass `true` for "Wg sklepu" and other views that
   * need line-item data to render product summaries or quantities.
   */
  include_items?: boolean;
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

  createStandaloneWz: (data: StandaloneWzCreate) =>
    api.post<DeliveryDocument>(`${basePath}create-standalone/`, data),

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

  /** `POST` — sync an existing draft/saved WZ's items from the current order quantities. */
  syncFromOrder: (wzId: string) =>
    api.post<DeliveryDocument>(`${basePath}${wzId}/sync-from-order/`, {}),

  /** `POST` — create a ZW return document linked to a WZ without changing WZ status. */
  addReturns: (id: string, returnItems: PendingReturnItem[]) =>
    api.post<DeliveryDocument>(`${basePath}${id}/add-returns/`, {
      return_items: returnItems.map(({ product_id, quantity, return_reason }) => ({
        product_id,
        quantity,
        return_reason,
      })),
    }),

  /** `GET` — creates WZ from confirmed order. */
  generateForOrder: (orderId: string, opts?: { vanWarehouseId?: string; vanRouteId?: string; issueDate?: string }) => {
    const params = new URLSearchParams();
    if (opts?.vanWarehouseId) params.set('van_warehouse_id', opts.vanWarehouseId);
    if (opts?.vanRouteId) params.set('van_route_id', opts.vanRouteId);
    if (opts?.issueDate) params.set('issue_date', opts.issueDate);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return api.get<DeliveryDocument>(`${basePath}generate-for-order/${orderId}/${qs}`);
  },

  /** `POST` — batch create draft WZ for multiple confirmed orders (one round-trip). */
  generateForOrders: (orderIds: string[]) =>
    api.post<{ documents: DeliveryDocument[] }>(`${basePath}generate-for-orders/`, {
      order_ids: orderIds,
    }),

  /** `POST /api/delivery/create-pz/` — create a draft PZ with items in one call. */
  createPz: (data: PzCreatePayload) =>
    api.post<DeliveryDocument>(`${basePath}create-pz/`, data),

  /** `POST /api/delivery/:id/complete/` for PZ — optionally update quantity_actual per line. */
  completePz: (id: string, items?: PzCompleteItemRow[]) =>
    api.post<DeliveryDocument>(`${basePath}${id}/complete/`, { items: items ?? [] }),

  /** `POST /api/delivery/:id/cancel-pz/` — cancel a PZ and reverse its stock impact. */
  cancelPz: (id: string) =>
    api.post<DeliveryDocument>(`${basePath}${id}/cancel-pz/`, {}),

  /** `POST /api/delivery/:id/create-kor/` — create a PZ-KOR correction document. */
  createPzKor: (id: string, data: PzKorPayload) =>
    api.post<DeliveryDocument>(`${basePath}${id}/create-kor/`, data),

  /** `POST /api/delivery/create-rw/` — create and immediately post a manual RW write-off. */
  createRw: (data: RwCreatePayload) =>
    api.post<DeliveryDocument>(`${basePath}create-rw/`, data),

  vanLoading: (data: VanLoadingPayload) =>
    api.post<DeliveryDocument>('/delivery/van-loading/', data),

  vanReconciliation: (warehouseId: string, data: VanReconciliationPayload, routeId?: string) =>
    api.post<VanReconciliationResult>(
      `/delivery/van-reconciliation/${warehouseId}/${routeId ? `?route_id=${routeId}` : ''}`,
      data,
    ),
};

import { api } from './api';
import type {
  PaginatedSupplierOrders,
  SupplierOrder,
  SupplierOrderCreate,
} from '../types/purchase-order.types';

export type SupplierOrderListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
  supplier_id?: string;
  ordering?: string;
};

export type CreatePzBody = {
  to_warehouse_id: string;
  issue_date?: string;
  notes?: string;
  external_document_number?: string;
};

export const purchaseOrderService = {
  fetchList: (params?: SupplierOrderListParams) =>
    api.get<PaginatedSupplierOrders>('/purchase-orders/', { params }),

  fetchById: (id: string) =>
    api.get<SupplierOrder>(`/purchase-orders/${id}/`),

  create: (body: SupplierOrderCreate) =>
    api.post<SupplierOrder>('/purchase-orders/', body),

  patch: (id: string, body: Partial<SupplierOrderCreate>) =>
    api.patch<SupplierOrder>(`/purchase-orders/${id}/`, body),

  cancel: (id: string) =>
    api.delete<void>(`/purchase-orders/${id}/`),

  send: (id: string) =>
    api.post<SupplierOrder>(`/purchase-orders/${id}/send/`),

  createPz: (id: string, body: CreatePzBody) =>
    api.post<Record<string, unknown>>(`/purchase-orders/${id}/create-pz/`, body),
};

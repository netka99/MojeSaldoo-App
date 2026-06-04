import { api } from './api';
import type {
  PaginatedSuppliers,
  Supplier,
  SupplierCreate,
  SupplierListItem,
  SupplierPatch,
} from '../types';

export type SupplierListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
};

export const supplierService = {
  fetchList: (params?: SupplierListParams) =>
    api.get<PaginatedSuppliers>('/suppliers/', { params }),

  /** Fetch all active suppliers (page_size=500 to avoid pagination for dropdowns). */
  fetchAll: () =>
    api.get<PaginatedSuppliers>('/suppliers/', { params: { page_size: 500 } }),

  fetchById: (id: string) => api.get<Supplier>(`/suppliers/${id}/`),

  createItem: (body: SupplierCreate) => api.post<Supplier>('/suppliers/', body),

  updateItem: (id: string, body: SupplierCreate) =>
    api.put<Supplier>(`/suppliers/${id}/`, body),

  patchItem: (id: string, body: SupplierPatch) =>
    api.patch<Supplier>(`/suppliers/${id}/`, body),

  deleteItem: (id: string) =>
    api.delete<Record<string, never>>(`/suppliers/${id}/`),
};

/** Slim list for use in dropdowns (id + name only). */
export type SupplierOption = Pick<SupplierListItem, 'id' | 'name'>;

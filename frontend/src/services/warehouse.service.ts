import { api } from './api';
import type { Warehouse, WarehouseWrite } from '../types';

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type WarehouseListParams = {
  page?: number;
  page_size?: number;
  ordering?: string;
  code?: string;
  is_active?: boolean;
  warehouse_type?: 'main' | 'mobile' | 'customer' | 'external';
};

export const warehouseService = {
  fetchList: (params?: WarehouseListParams) =>
    api.get<PaginatedResponse<Warehouse>>('/warehouses/', { params }),

  fetchById: (id: string) => api.get<Warehouse>(`/warehouses/${id}/`),

  createItem: (body: WarehouseWrite) => api.post<Warehouse>('/warehouses/', body),

  updateItem: (id: string, body: WarehouseWrite) => api.put<Warehouse>(`/warehouses/${id}/`, body),

  deleteItem: (id: string) => api.delete<Record<string, never>>(`/warehouses/${id}/`),

  partialUpdateItem: (id: string, body: Partial<WarehouseWrite>) =>
    api.patch<Warehouse>(`/warehouses/${id}/`, body),
};

import { api } from './api';
import type { Warehouse, WarehouseStockItem, WarehouseWrite } from '../types';

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

  fetchStock: (id: string, params?: { below_minimum?: boolean; search?: string }) =>
    api.get<WarehouseStockItem[]>(`/warehouses/${id}/stock/`, { params }),

  downloadImportTemplate: async (): Promise<void> => {
    const blob = await api.get<Blob>('/warehouses/import-template/', { responseType: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'szablon_stan_magazynowy.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  },

  importStock: async (file: File, dryRun: boolean): Promise<ImportWarehousesResult> => {
    const form = new FormData();
    form.append('file', file);
    form.append('dry_run', dryRun ? 'true' : 'false');
    return api.post<ImportWarehousesResult>('/warehouses/import/', form, {
      headers: { 'Content-Type': undefined },
    });
  },
};

export type ImportWarehouseError = { row: number; field: string; message: string };

export type ImportWarehousesResult = {
  dry_run: boolean;
  valid_count?: number;
  to_create?: number;
  to_update?: number;
  to_skip?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  error_count: number;
  errors: ImportWarehouseError[];
};

import { api } from './api';
import type {
  InventoryCount,
  InventoryCountCreate,
  InventoryUpdateItemsPayload,
} from '../types/inventory.types';

export interface PaginatedInventoryCounts {
  count: number;
  next: string | null;
  previous: string | null;
  results: InventoryCount[];
}

export const inventoryService = {
  fetchList: (params?: { page?: number; page_size?: number }) =>
    api.get<PaginatedInventoryCounts>('/inventory/', { params }),

  fetchDetail: (id: string) =>
    api.get<InventoryCount>(`/inventory/${id}/`),

  create: (data: InventoryCountCreate) =>
    api.post<InventoryCount>('/inventory/', data),

  updateItems: (id: string, data: InventoryUpdateItemsPayload) =>
    api.post<InventoryCount>(`/inventory/${id}/update-items/`, data),

  complete: (id: string) =>
    api.post<InventoryCount>(`/inventory/${id}/complete/`, {}),

  cancel: (id: string) =>
    api.post<InventoryCount>(`/inventory/${id}/cancel/`, {}),
};

import { api } from './api';
import type { Product, ProductWrite, StockSnapshot } from '../types';

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Query params aligned with `ProductViewSet` filters, search, ordering, and `page`. */
export type ProductListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  name?: string;
  unit?: string;
  sku?: string;
  barcode?: string;
  is_active?: boolean;
  track_batches?: boolean;
};

export type StockMovementType =
  | 'purchase'
  | 'sale'
  | 'return'
  | 'adjustment'
  | 'transfer'
  | 'damage';

/** POST `/products/{id}/update-stock/` body — matches `StockUpdateSerializer`. */
export type StockUpdatePayload = {
  warehouse_id?: string;
  /** Resolve warehouse by `Warehouse.code` for the product owner (alternative to `warehouse_id`). */
  warehouse_code?: string;
  quantity_change: string | number;
  movement_type?: StockMovementType;
  reference_type?: string;
  reference_id?: string | null;
  notes?: string;
  stock_movement_id?: string | null;
};

/** Response shape from `StockMovementSerializer` after stock update. */
export type StockMovement = {
  id: string;
  product: string;
  warehouse: string;
  warehouse_code?: string;
  user: number;
  movement_type: StockMovementType;
  quantity: string | number;
  quantity_before: string | number;
  quantity_after: string | number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string;
  created_at: string;
  created_by: number | null;
};

export const productService = {
  fetchList: (params?: ProductListParams) =>
    api.get<PaginatedResponse<Product>>('/products/', { params }),

  fetchById: (id: string) => api.get<Product>(`/products/${id}/`),

  createItem: (body: ProductWrite) => api.post<Product>('/products/', body),

  updateItem: (id: string, body: ProductWrite) => api.put<Product>(`/products/${id}/`, body),

  deleteItem: (id: string) => api.delete<Record<string, never>>(`/products/${id}/`),

  partialUpdateItem: (id: string, body: Partial<ProductWrite>) =>
    api.patch<Product>(`/products/${id}/`, body),

  updateStock: (id: string, body: StockUpdatePayload) =>
    api.post<StockMovement>(`/products/${id}/update-stock/`, body),

  fetchStockSnapshot: (warehouseId: string) =>
    api.get<StockSnapshot>('/products/stock-snapshot/', { params: { warehouse_id: warehouseId } }),
};

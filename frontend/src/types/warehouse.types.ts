/**
 * Warehouse entity — mirrors `apps.products.models.Warehouse` / DRF `WarehouseSerializer`.
 * `warehouse_type` matches `Warehouse.WarehouseType` in Django.
 */
export const WAREHOUSE_TYPES = ['main', 'mobile', 'customer', 'external'] as const;

export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

/** Polish labels for `warehouse_type` (UI only; API values stay English enums). */
export const WAREHOUSE_TYPE_LABELS_PL: Record<WarehouseType, string> = {
  main: 'Magazyn główny',
  mobile: 'Mobilny',
  customer: 'U klienta',
  external: 'Zewnętrzny',
};

export interface Warehouse {
  id: string;
  user: number;
  code: string;
  name: string;
  warehouse_type: WarehouseType;
  address: string;
  is_active: boolean;
  allow_negative_stock: boolean;
  fifo_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type WarehouseWrite = Omit<Warehouse, 'id' | 'created_at' | 'updated_at' | 'user'> &
  Partial<Pick<Warehouse, 'id'>>;

/** ProductStock row enriched with product details — from GET /warehouses/{id}/stock/. */
export interface WarehouseStockItem {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  product_unit: string;
  quantity_available: string | number;
  quantity_reserved: string | number;
  quantity_total: string | number;
  min_stock_alert: string | number | null;
  is_below_minimum: boolean;
}

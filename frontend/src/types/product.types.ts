/**
 * Product catalog entity — mirrors `apps.products.models.Product` / DRF `ProductSerializer`.
 * Decimal fields are usually JSON strings from Django REST Framework; `number` is allowed if the renderer sends floats.
 */
export interface Product {
  id: string;
  user: number | null;
  name: string;
  description: string | null;
  unit: string;
  price_net: string | number;
  price_gross: string | number;
  vat_rate: string | number;
  sku: string | null;
  barcode: string | null;
  /** Polish PKWiU classification code (KSeF invoice lines). */
  pkwiu: string;
  track_batches: boolean;
  min_stock_alert: string | number;
  shelf_life_days: number | null;
  /** True when this entry is a service (not a physical product). */
  is_service: boolean;
  is_resalable: boolean;
  markup_percent: string | number | null;
  avg_cost: string | number | null;
  /** How avg_cost was last set. null = never set. */
  avg_cost_source: 'pz' | 'production' | 'recipe' | 'manual' | null;
  avg_cost_updated_at: string | null;
  last_cost: string | number | null;
  is_active: boolean;
  /** Absolute URL of the 128px thumbnail, or null when the product has no photo. */
  image_url?: string | null;
  /** Sum of `quantity_available` across all company warehouses; from list/detail API. */
  stock_total?: string | number;
  /** Per-warehouse stock breakdown — only present on detail (retrieve) responses. */
  stocks_by_warehouse?: {
    warehouse_id: string;
    warehouse_name: string;
    warehouse_code: string;
    quantity_available: string;
    quantity_reserved: string;
    quantity_total: string;
  }[];
  created_at: string;
  updated_at: string;
}

/** Fields clients may send on create/update (read-only server fields omitted). */
export type ProductWrite = Omit<Product, 'id' | 'created_at' | 'updated_at' | 'user' | 'image_url'> &
  Partial<Pick<Product, 'id'>>;

// Stock snapshot for a single warehouse (used by van reconciliation)

export interface StockSnapshotItem {
  product_id: string;
  product_name: string;
  sku: string | null;
  unit: string;
  quantity_available: string; // decimal string
}

export interface StockSnapshot {
  warehouse_id: string;
  warehouse_name: string;
  items: StockSnapshotItem[];
}

/** Rich read-only movement row — from GET /products/stock-movements/. */
export interface StockMovementListItem {
  id: string;
  product: string;
  product_name: string;
  warehouse: string;
  warehouse_name: string;
  movement_type: string;
  quantity: string | number;
  quantity_before: string | number;
  quantity_after: string | number;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  notes: string;
  created_at: string;
  created_by_name: string | null;
}

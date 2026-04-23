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
  track_batches: boolean;
  min_stock_alert: string | number;
  shelf_life_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Fields clients may send on create/update (read-only server fields omitted). */
export type ProductWrite = Omit<Product, 'id' | 'created_at' | 'updated_at' | 'user'> &
  Partial<Pick<Product, 'id'>>;

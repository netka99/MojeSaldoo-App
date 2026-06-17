// ── Recipe ────────────────────────────────────────────────────────────────────

export type RecipeItem = {
  id: string;
  ingredient: string;        // product UUID
  ingredient_name: string;
  ingredient_unit: string;
  quantity: string | number;
  unit: string;
  notes: string;
};

export type Recipe = {
  id: string;
  product: string;           // finished-good product UUID
  product_name: string;
  product_unit: string;
  name: string;
  yield_quantity: string | number;
  is_active: boolean;
  notes: string;
  items: RecipeItem[];
  created_at: string;
  updated_at: string;
};

export type RecipeCreate = {
  product: string;
  name?: string;
  yield_quantity: number | string;
  is_active?: boolean;
  notes?: string;
  items: {
    ingredient: string;
    quantity: number | string;
    unit?: string;
    notes?: string;
  }[];
};

// ── Production Order ──────────────────────────────────────────────────────────

export type ProductionOrderMode = 'simple' | 'batch';
export type ProductionOrderStatus = 'draft' | 'completed';

export type ProductionOrderInput = {
  id: string;
  ingredient: string;
  ingredient_name: string;
  ingredient_unit: string;
  quantity_used: string | number;
  unit: string;
  fifo_cost: string | number | null;
};

export type ProductionOrder = {
  id: string;
  order_number: string;
  recipe: string;
  recipe_name: string | null;
  finished_product_name: string;
  finished_product_unit: string;
  date: string;
  mode: ProductionOrderMode;
  status: ProductionOrderStatus;
  quantity_produced: string | number;
  total_input_cost: string | number | null;
  real_unit_cost: string | number | null;
  rw_document: string | null;
  rw_document_number: string | null;
  pw_document: string | null;
  pw_document_number: string | null;
  notes: string;
  inputs: ProductionOrderInput[];
  completed_at: string | null;
  created_at: string;
};

export type ProductionOrderCreate = {
  recipe: string;
  date: string;
  mode: ProductionOrderMode;
  quantity_produced: number | string;
  notes?: string;
  inputs?: {
    ingredient: string;
    quantity_used: number | string;
    unit?: string;
  }[];
};

export interface PaginatedProductionOrders {
  count: number;
  next: string | null;
  previous: string | null;
  results: ProductionOrder[];
}

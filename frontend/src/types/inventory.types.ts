export interface InventoryCountItem {
  id: string;
  product: string;
  product_name: string;
  product_unit: string;
  quantity_system: string | number;
  quantity_actual: string | number | null;
  difference: number | null;
  notes: string;
  created_at: string;
}

export interface InventoryCount {
  id: string;
  warehouse: string;
  warehouse_name: string;
  document_number: string;
  status: 'draft' | 'completed' | 'cancelled';
  count_date: string;
  notes: string;
  created_by: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  items: InventoryCountItem[];
}

export interface InventoryCountCreate {
  warehouse: string;
  count_date: string;
  notes?: string;
}

export interface InventoryUpdateItemsPayload {
  items: Array<{
    id: string;
    quantity_actual: string | number | null;
    notes?: string;
  }>;
}

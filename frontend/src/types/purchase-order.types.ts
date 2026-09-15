export type SupplierOrderStatus =
  | 'draft'
  | 'sent'
  | 'partial'
  | 'fulfilled'
  | 'cancelled';

export interface SupplierOrderItem {
  id: string;
  product_id: string;
  product_name: string;
  product_unit: string;
  quantity_ordered: string;
  quantity_received: string;
  unit_price_net: string | null;
  vat_rate: string | null;
  notes: string;
  created_at: string;
}

export interface SupplierOrder {
  id: string;
  document_number: string;
  status: SupplierOrderStatus;
  supplier_id: string | null;
  supplier_name: string;
  issue_date: string;
  expected_delivery_date: string | null;
  source_order_id: string | null;
  notes: string;
  items: SupplierOrderItem[];
  pz_count: number;
  created_at: string;
  updated_at: string;
}

export interface SupplierOrderItemWrite {
  product_id: string;
  quantity_ordered: string;
  unit_price_net?: string;
  vat_rate?: string;
  notes?: string;
}

export interface SupplierOrderCreate {
  supplier_id?: string | null;
  issue_date?: string;
  expected_delivery_date?: string | null;
  notes?: string;
  items: SupplierOrderItemWrite[];
}

export interface PaginatedSupplierOrders {
  count: number;
  next: string | null;
  previous: string | null;
  results: SupplierOrder[];
}

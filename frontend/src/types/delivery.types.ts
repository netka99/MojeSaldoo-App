/**
 * Delivery documents / WZ lines — match `apps.delivery.serializers` + models (DRF JSON, snake_case).
 */

/** `DeliveryDocument.document_type`. */
export type DeliveryDocumentType = 'WZ' | 'MM' | 'PZ';

/** `DeliveryDocument.status`. */
export type DeliveryDocumentStatus =
  | 'draft'
  | 'saved'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

/** One line on a delivery document (read shape from API). */
export interface DeliveryItem {
  id: string;
  order_item_id: string;
  product_id: string;
  quantity_planned: string | number;
  quantity_actual: string | number | null;
  quantity_returned: string | number;
  return_reason: string;
  is_damaged: boolean;
  notes: string;
  created_at: string;
}

/** Full document as returned from GET (includes nested `items`). */
export interface DeliveryDocument {
  id: string;
  company: string;
  order_id: string;
  /** From linked order (read-only API). */
  order_number: string | null;
  /** From linked order's customer (read-only API). */
  customer_name: string;
  user: number | null;
  document_type: DeliveryDocumentType;
  document_number: string | null;
  issue_date: string;
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
  to_customer_id: string | null;
  status: DeliveryDocumentStatus;
  has_returns: boolean;
  returns_notes: string;
  driver_name: string;
  receiver_name: string;
  delivered_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  items: DeliveryItem[];
}

/** `POST /api/delivery/` — writable fields on `DeliveryDocumentSerializer` (status is server-controlled). */
export interface DeliveryDocumentCreate {
  order_id: string;
  document_type: DeliveryDocumentType;
  issue_date: string;
  from_warehouse_id?: string | null;
  to_warehouse_id?: string | null;
  to_customer_id?: string | null;
  has_returns?: boolean;
  returns_notes?: string;
  driver_name?: string;
  receiver_name?: string;
  notes?: string;
}

/** `PATCH /api/delivery/:id/` — partial update (same writable fields as create where applicable). */
export type DeliveryDocumentPatch = Partial<Omit<DeliveryDocumentCreate, 'order_id' | 'document_type'>> & {
  order_id?: string;
  document_type?: DeliveryDocumentType;
  issue_date?: string;
};

/** `POST /api/delivery/:id/complete/` body. */
export interface DeliveryCompleteItemRow {
  id: string;
  quantity_actual?: string | number | null;
  quantity_returned?: string | number;
  return_reason?: string;
  is_damaged?: boolean;
  notes?: string;
}

export interface DeliveryCompletePayload {
  items?: DeliveryCompleteItemRow[];
  receiver_name?: string;
  has_returns?: boolean;
  returns_notes?: string;
}

export interface PaginatedDeliveryDocuments {
  count: number;
  next: string | null;
  previous: string | null;
  results: DeliveryDocument[];
}

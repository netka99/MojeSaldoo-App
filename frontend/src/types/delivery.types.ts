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
  order_item_id: string | null;
  product_id: string;
  /** From linked product (API); present for MM/PZ lines without order_item. */
  product_name?: string | null;
  quantity_planned: string | number;
  quantity_actual: string | number | null;
  quantity_returned: string | number;
  return_reason: string;
  is_damaged: boolean;
  notes: string;
  created_at: string;
}

/** Linked invoice preview on delivery detail (WZ locked). */
export interface LinkedInvoiceRef {
  id: string;
  invoice_number: string;
}

/** Full document as returned from GET (includes nested `items`). */
export interface DeliveryDocument {
  id: string;
  company: string;
  order_id: string | null;
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
  /** True when an invoice references this delivery document (editing blocked server-side). */
  locked_for_edit?: boolean;
  linked_invoices?: LinkedInvoiceRef[];
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

/** POST `/api/delivery/:id/update-lines/` body. */
export interface DeliveryUpdateLinesPayload {
  items: Array<{
    id: string;
    quantity_planned?: string | number;
    quantity_actual?: string | number | null;
    quantity_returned?: string | number;
    return_reason?: string;
    is_damaged?: boolean;
    notes?: string;
  }>;
}

export interface PaginatedDeliveryDocuments {
  count: number;
  next: string | null;
  previous: string | null;
  results: DeliveryDocument[];
}

export interface VanLoadingItemPayload {
  product_id: string;
  quantity: string; // decimal string, e.g. "10.000"
}

export interface VanLoadingPayload {
  from_warehouse_id: string;
  to_warehouse_id: string;
  issue_date: string; // "YYYY-MM-DD"
  driver_name?: string;
  notes?: string;
  items: VanLoadingItemPayload[];
}

// Van reconciliation types (POST /api/delivery/van-reconciliation/:id/)

export interface VanReconciliationItemPayload {
  product_id: string;
  /** Decimal string, e.g. "5.00" — physical count remaining on the van. */
  quantity_actual_remaining: string;
}

export interface VanReconciliationPayload {
  /** Backend `VanReconciliationSerializer` only validates `items`. */
  items: VanReconciliationItemPayload[];
}

export interface VanReconciliationDiscrepancy {
  product_id: string;
  product_name: string;
  quantity_expected: string;
  quantity_actual: string;
  quantity_delta: string;
  discrepancy_type: 'damage' | 'adjustment';
}

/** Response from `apply_van_reconciliation()` / POST van-reconciliation. */
export interface VanReconciliationResult {
  van_warehouse_id: string;
  reconciliation_id: string | null;
  reconciled_at: string;
  items_processed: number;
  discrepancies: VanReconciliationDiscrepancy[];
}

/** `GET /api/delivery/:id/preview/` — print-oriented payload. */
export interface DeliveryDocumentPreviewDocument {
  id: string;
  company: string;
  order: string | null;
  user: string | null;
  document_type: DeliveryDocumentType;
  document_number: string;
  issue_date: string;
  from_warehouse: string | null;
  to_warehouse: string | null;
  to_customer: string | null;
  status: DeliveryDocumentStatus;
  has_returns: boolean;
  returns_notes: string;
  driver_name: string;
  receiver_name: string;
  delivered_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface DeliveryDocumentPreviewCompany {
  name: string;
  nip: string;
  address: string;
}

export interface DeliveryDocumentPreviewCustomer {
  name: string;
  nip: string;
  address: string;
}

export interface DeliveryDocumentPreviewWarehouse {
  name: string;
  code: string;
}

export interface DeliveryDocumentPreviewItem {
  product_name: string;
  quantity_planned: string;
  quantity_actual: string | null;
  quantity_returned: string;
  unit: string;
}

export interface DeliveryDocumentPreviewPayload {
  document: DeliveryDocumentPreviewDocument;
  company: DeliveryDocumentPreviewCompany;
  customer: DeliveryDocumentPreviewCustomer;
  from_warehouse: DeliveryDocumentPreviewWarehouse | null;
  items: DeliveryDocumentPreviewItem[];
}

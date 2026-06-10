/**
 * Delivery documents / WZ lines — match `apps.delivery.serializers` + models (DRF JSON, snake_case).
 */

/** `DeliveryDocument.document_type`. */
export type DeliveryDocumentType = 'WZ' | 'MM' | 'PZ' | 'ZW' | 'RW';

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
  /** Purchase cost per unit — populated on PZ lines. */
  unit_cost?: string | number | null;
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

/** One item in a linked ZW document (shown on the parent WZ page). */
export interface LinkedZWItem {
  id: string;
  product_id: string;
  product_name: string | null;
  quantity_planned: string | number;
  return_reason: string;
}

/** A ZW document linked to a WZ (shown as a read-only block on the WZ detail page). */
export interface LinkedZWDocument {
  id: string;
  document_number: string | null;
  issue_date: string;
  status: DeliveryDocumentStatus;
  items: LinkedZWItem[];
}

/** One return line sent to `POST /api/delivery/{id}/save/` when collecting returns. */
export interface PendingReturnItem {
  product_id: string;
  product_name?: string;  // UI-only — not sent to API
  quantity: string;       // decimal string, e.g. "2.00"
  return_reason?: string;
}

/** Optional body for `POST /api/delivery/{id}/save/` */
export interface SaveDeliveryPayload {
  return_items?: PendingReturnItem[];
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
  /** Human-readable name of the source warehouse (read-only, from API). */
  from_warehouse_name?: string | null;
  to_warehouse_id: string | null;
  /** Human-readable name of the destination warehouse (read-only, from API). */
  to_warehouse_name?: string | null;
  to_customer_id: string | null;
  /** Van route this document belongs to. */
  van_route_id?: string | null;
  /** Route delivery date (read-only, from API). */
  van_route_date?: string | null;
  /** Supplier FK — populated on PZ documents. */
  from_supplier_id?: string | null;
  /** Supplier name (read-only, from API). */
  supplier_name?: string | null;
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
  /** For ZW documents: the WZ that triggered this return. */
  linked_wz_id?: string | null;
  /** Document number of the linked WZ (read-only, from API). */
  linked_wz_number?: string | null;
  /** ZW return documents linked to this WZ. */
  return_documents?: LinkedZWDocument[];
  items: DeliveryItem[];
}

/** `POST /api/delivery/create-standalone/` — create a draft WZ without an order. */
export interface StandaloneWzCreate {
  /** Omit when the customer is not yet known (e.g. additional products WZ on a van route). */
  to_customer_id?: string;
  /** Link WZ to the active van route (from route dashboard). */
  van_route_id?: string;
  /** Pin the source warehouse to a specific van; defaults to the first active mobile warehouse. */
  from_warehouse_id?: string;
  issue_date?: string;
  items: Array<{ product_id: string; quantity_planned: string }>;
}

/** `POST /api/delivery/` — writable fields on `DeliveryDocumentSerializer` (status is server-controlled). */
export interface DeliveryDocumentCreate {
  order_id?: string | null;
  document_type: DeliveryDocumentType;
  issue_date: string;
  from_warehouse_id?: string | null;
  to_warehouse_id?: string | null;
  to_customer_id?: string | null;
  van_route_id?: string | null;
  from_supplier_id?: string | null;
  has_returns?: boolean;
  returns_notes?: string;
  driver_name?: string;
  receiver_name?: string;
  notes?: string;
}

/** `POST /api/delivery/create-pz/` — create a draft PZ with items in one call. */
export interface PzCreateItem {
  product_id: string;
  quantity_planned: string;  // decimal string, e.g. "10.00"
  unit_cost?: string | null; // decimal string, e.g. "5.5000"
  ksef_line_position?: number | null;
}

export interface PzCreatePayload {
  to_warehouse_id: string;
  from_supplier_id?: string | null;
  issue_date?: string;  // "YYYY-MM-DD", defaults to today
  notes?: string;
  ksef_number?: string;
  items: PzCreateItem[];
}

/** `POST /api/delivery/:id/complete/` for PZ — optionally update quantity_actual per line. */
export interface PzCompleteItemRow {
  id: string;
  quantity_actual?: string | number | null;
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
  /** Decimal string — quantity returned to MG via MM-P. */
  quantity_actual_remaining: string;
  /**
   * Optional explicit write-off (DAMAGE). When provided, activates "split mode":
   * P → MM-P return, W → DAMAGE, remainder stays in van.
   * When absent, falls back to legacy delta-based discrepancy logic.
   */
  quantity_writeoff?: string;
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
  mm_return_number: string | null;
  rw_writeoff_number: string | null;
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

export interface DeliveryDocumentPreviewReturnItem {
  product_name: string;
  quantity_planned: string;
  return_reason: string;
  unit: string;
}

export interface DeliveryDocumentPreviewReturnDocument {
  id: string;
  document_number: string;
  issue_date: string;
  items: DeliveryDocumentPreviewReturnItem[];
}

export interface DeliveryDocumentPreviewPayload {
  document: DeliveryDocumentPreviewDocument;
  company: DeliveryDocumentPreviewCompany;
  customer: DeliveryDocumentPreviewCustomer;
  from_warehouse: DeliveryDocumentPreviewWarehouse | null;
  to_warehouse: DeliveryDocumentPreviewWarehouse | null;
  items: DeliveryDocumentPreviewItem[];
  return_documents?: DeliveryDocumentPreviewReturnDocument[];
}

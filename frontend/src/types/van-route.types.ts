/**
 * Van route types — match apps.van_routes.serializers (DRF JSON, snake_case).
 */

export type VanRouteStatus =
  | 'planned'
  | 'loading'
  | 'in_progress'
  | 'settling'
  | 'closed';

export const VAN_ROUTE_ACTIVE_STATUSES: VanRouteStatus[] = [
  'planned',
  'loading',
  'in_progress',
  'settling',
];

/** Minimal order info nested inside a route (RouteOrderSerializer). */
export interface RouteOrder {
  id: string;
  order_number: string | null;
  customer_id: string;
  customer_name: string;
  delivery_date: string;
  status: string;
  item_count: number;
}

/** Minimal MM doc nested inside a route detail. */
export interface RouteMmDoc {
  id: string;
  document_number: string | null;
  issue_date: string;
  status: string;
}

/** List item — no nested orders, just counts. */
export interface VanRouteListItem {
  id: string;
  date: string;
  driver_name: string;
  van_name: string;
  van_warehouse_id: string;
  van_warehouse_code: string;
  main_warehouse_id: string;
  main_warehouse_code: string;
  status: VanRouteStatus;
  status_display: string;
  order_count: number;
  mm_document_id: string | null;
  mm_document_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationSummaryItem {
  action: 'returned' | 'kept' | 'written_off';
  product_id: string;
  product_name: string;
  quantity: string;
  unit: string;
}

export interface ReconciliationSummary {
  reconciled_at: string;
  mm_return_number: string | null;
  rw_writeoff_number: string | null;
  items: ReconciliationSummaryItem[];
}

/** Full detail — nested orders and MM doc. */
export interface VanRoute extends Omit<VanRouteListItem, 'order_count'> {
  orders: RouteOrder[];
  mm_document: RouteMmDoc | null;
  reconciliation_summary: ReconciliationSummary | null;
}

/** POST /api/van-routes/ body. */
export interface VanRouteCreate {
  date: string;
  driver_name?: string;
  van_name?: string;
  van_warehouse_id: string;
  main_warehouse_id: string;
  order_ids?: string[];
}

/** PATCH /api/van-routes/:id/ body. */
export interface VanRoutePatch {
  date?: string;
  driver_name?: string;
  van_name?: string;
}

/** One item for POST /api/van-routes/:id/start-loading/ */
export interface VanRouteLoadItem {
  product_id: string;
  quantity: string; // decimal string
}

/** POST /api/van-routes/:id/start-loading/ body. */
export interface VanRouteStartLoadingPayload {
  items: VanRouteLoadItem[];
}

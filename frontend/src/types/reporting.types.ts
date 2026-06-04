/** `GET /api/reports/sales-summary/` */
export type SalesSummaryReport = {
  totalOrders: number;
  totalGross: string | number;
  totalNet?: string | number;
  totalVat?: string | number;
  avgOrderValue: string | number;
  byStatus: Record<string, number>;
};

/** `GET /api/reports/top-products/` row */
export type TopProductRow = {
  productName: string;
  totalQuantity: string | number;
  totalGross: string | number;
};

/** `GET /api/reports/top-customers/` row */
export type TopCustomerRow = {
  customerName: string;
  orderCount: number;
  totalGross: string | number;
};

/** Rejected invoice row inside `GET /api/reports/ksef-status/` */
export type ReportingRejectedInvoice = {
  id: string;
  invoice_number: string | null;
  issue_date: string;
  ksef_status: string;
  ksef_error_message: string;
  total_gross: string | number;
  customer_name: string;
};

/** `GET /api/reports/ksef-status/` */
export type KsefStatusReport = {
  notSent: number;
  pending: number;
  sent: number;
  accepted: number;
  rejected: number;
  rejectedInvoices: ReportingRejectedInvoice[];
};

/** Slim invoice row from `GET /api/reports/invoices/` (ReportingInvoiceSerializer). */
export type ReportingInvoiceRow = {
  id: string;
  invoice_number: string | null;
  issue_date: string;
  sale_date: string;
  due_date: string;
  status: string;
  ksef_status: string;
  ksef_sent_at: string | null;
  total_gross: string | number;
  customer_name: string;
  order_id: string;
};

export interface PaginatedReportingInvoices {
  count: number;
  next: string | null;
  previous: string | null;
  results: ReportingInvoiceRow[];
}

/** Van route row inside `GET /api/reports/dashboard/`. */
export type DashboardVanRoute = {
  id: string;
  driver_name: string;
  van_name: string;
  status: string;
};

/** Low-stock alert row inside `GET /api/reports/dashboard/`. */
export type DashboardLowStockAlert = {
  product_id: string;
  product__name: string;
  warehouse__id: string;
  warehouse__name: string;
  quantity_available: string | number;
  product__min_stock_alert: string | number;
};

/** `GET /api/reports/dashboard/` */
export type DashboardSummary = {
  orders_pending_confirmation: number;
  wz_in_transit: number;
  invoices_overdue: {
    count: number;
    total_gross: string;
  };
  van_routes_today: DashboardVanRoute[];
  low_stock_alerts: DashboardLowStockAlert[];
  date: string;
};

/** Row from `GET /api/reports/inventory/`. */
export type InventoryReportRow = {
  productName: string;
  warehouseCode: string;
  quantityAvailable: string | number;
  minStockAlert: string | number;
  belowMinimum: boolean;
};

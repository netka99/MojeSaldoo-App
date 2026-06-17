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
  /** Estimated days of stock at current 90-day sales rate. null = no recent sales. */
  daysOfStock: number | null;
};

/** Row from `GET /api/reports/expiry-alerts/`. */
export type ExpiryAlertRow = {
  batchId: string;
  productId: string;
  productName: string;
  warehouseCode: string;
  batchNumber: string;
  expiryDate: string;
  daysUntilExpiry: number;
  quantityRemaining: string | number;
  unitCost: string | number | null;
  expired: boolean;
};

/** Row from `GET /api/reports/customer-margin/`. */
export type CustomerMarginRow = {
  customerId: string | null;
  customerName: string;
  invoiceCount: number;
  totalRevenue: string | number;
  // Real COGS (from avg_cost)
  cogs: string | number | null;
  grossProfit: string | number | null;
  marginPercent: number | null;
  cogsComplete: boolean;
  // Estimated COGS (recipe fallback — set when any line used recipe estimate)
  estimatedCogs: string | number | null;
  estimatedGrossProfit: string | number | null;
  estimatedMarginPercent: number | null;
  hasEstimate: boolean;
};

export type CustomerMarginMissingProduct = {
  productId: string;
  productName: string;
};

/** `GET /api/reports/customer-margin/` response. */
export type CustomerMarginReport = {
  rows: CustomerMarginRow[];
  productsMissingCost: CustomerMarginMissingProduct[];
};

/** One month row from `GET /api/reports/profit-loss/`. */
export type ProfitLossRow = {
  month: string; // "YYYY-MM"
  revenue: string | number;
  purchaseCosts: string | number;
  grossProfit: string | number;
  marginPercent: number | null;
  invoiceCount: number;
  pzCount: number;
  opex: string | number;
  opexByCategory: Record<string, string | number>;
  operatingProfit: string | number;
  operatingMarginPercent: number | null;
};

/** Invoice summary inside `GET /api/reports/profit-loss/month-detail/`. */
export type ProfitLossMonthInvoice = {
  id: string;
  invoice_number: string;
  issue_date: string;
  customer_name: string;
  total_gross: string | number;
  status: string;
};

/** PZ document summary inside `GET /api/reports/profit-loss/month-detail/`. */
export type ProfitLossMonthPZ = {
  id: string;
  document_number: string;
  issue_date: string;
  supplier_name: string;
  total_cost: string | number;
};

/** OPEX invoice inside `GET /api/reports/profit-loss/month-detail/`. */
export type ProfitLossMonthOpexInvoice = {
  id: string;
  ksef_number: string;
  invoice_number: string;
  issue_date: string;
  seller_name: string;
  gross_amount: string | number;
  opex_category: string;
};

/** `GET /api/reports/profit-loss/month-detail/` response. */
export type ProfitLossMonthDetail = {
  invoices: ProfitLossMonthInvoice[];
  pz_documents: ProfitLossMonthPZ[];
  opex_invoices: ProfitLossMonthOpexInvoice[];
};

/** `GET /api/reports/profit-loss/` response. */
export type ProfitLossReport = {
  rows: ProfitLossRow[];
  totals: {
    revenue: string | number;
    purchaseCosts: string | number;
    grossProfit: string | number;
    marginPercent: number | null;
    opex: string | number;
    operatingProfit: string | number;
    operatingMarginPercent: number | null;
  };
};

/** Invoice line inside product margin drill-down. */
export type ProductMarginInvoiceLine = {
  invoice_id: string;
  invoice_number: string;
  issue_date: string;
  customer_name: string;
  quantity: string | number;
  unit_price_net: string | number;
  line_gross: string | number;
  status: string;
};

/** PZ line inside product margin drill-down. */
export type ProductMarginPZLine = {
  pz_id: string;
  document_number: string;
  issue_date: string;
  supplier_name: string;
  quantity: string | number;
  unit_cost: string | number;
  line_cost: string | number;
};

/** Production order row inside product margin drill-down. */
export type ProductMarginProductionOrder = {
  order_number: string;
  completed_at: string | null;
  quantity_produced: string | number;
  real_unit_cost: string | number | null;
  total_input_cost: string | number | null;
};

/** `GET /api/reports/product-margin/product-detail/` response. */
export type ProductMarginDetail = {
  invoice_lines: ProductMarginInvoiceLine[];
  pz_lines: ProductMarginPZLine[];
  cost_history: ProductMarginPZLine[];
  production_history: ProductMarginProductionOrder[];
  avg_cost: string | number | null;
  last_cost: string | number | null;
  avg_cost_updated_at: string | null;
};

/** One invoice row from `GET /api/reports/payment-aging/`. */
export type PaymentAgingRow = {
  invoice_id: string;
  invoice_number: string;
  issue_date: string | null;
  due_date: string | null;
  days_overdue: number;
  bucket: 'current' | '1_30' | '31_60' | '61_90' | 'over_90';
  customer_name: string;
  total_gross: string | number;
  status: string;
};

/** Bucket totals from `GET /api/reports/payment-aging/`. */
export type PaymentAgingBuckets = {
  current: string | number;
  '1_30': string | number;
  '31_60': string | number;
  '61_90': string | number;
  over_90: string | number;
};

/** `GET /api/reports/payment-aging/` response. */
export type PaymentAgingReport = {
  rows: PaymentAgingRow[];
  buckets: PaymentAgingBuckets;
  total_outstanding: string | number;
  as_of: string;
};

/** One supplier's data from `GET /api/reports/supplier-costs/`. */
export type SupplierCostsRow = {
  supplier_id: string | null;
  supplier_name: string;
  monthly: Record<string, string | number>; // "YYYY-MM" → cost
  total: string | number;
};

/** `GET /api/reports/supplier-costs/` response. */
export type SupplierCostsReport = {
  months: string[]; // ["YYYY-MM", ...]
  suppliers: SupplierCostsRow[];
};

/** One PZ document row from `GET /api/reports/supplier-costs/detail/`. */
export type SupplierCostsPZDoc = {
  pz_id: string;
  document_number: string;
  issue_date: string | null;
  total_cost: string | number;
  item_count: number;
};

/** `GET /api/reports/supplier-costs/detail/` response. */
export type SupplierCostsDetail = {
  documents: SupplierCostsPZDoc[];
};

/** One row from `GET /api/reports/product-margin/`. */
export type ProductMarginRow = {
  productId: string | null;
  productName: string;
  totalQty: string | number;
  totalRevenue: string | number;
  avgCost: string | number | null;
  lastCost: string | number | null;
  costSource: 'pz' | 'production' | 'manual' | 'recipe_estimate' | null;
  // Real COGS (from avg_cost)
  cogs: string | number | null;
  grossProfit: string | number | null;
  marginPercent: number | null;
  // Estimated (recipe fallback — only set when costSource = 'recipe_estimate')
  estimatedCogs: string | number | null;
  estimatedGrossProfit: string | number | null;
  estimatedMarginPercent: number | null;
};

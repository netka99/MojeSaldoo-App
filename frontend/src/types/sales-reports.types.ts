// ---------------------------------------------------------------------------
// Sales Reports — Raporty Kasowe (RK)
// ---------------------------------------------------------------------------

export type SalesReportStatus = 'draft' | 'saved';

export interface SalesReportLine {
  id?: number;
  product: string | null;       // product UUID/PK
  product_name: string;
  unit: string;
  qty: string;
  vat_rate: string;
  unit_price: string;
  unit_cost: string | null;
  line_revenue: string;
  line_cost: string | null;
  sort_order?: number;
}

export interface SalesReportLineWrite {
  product?: string | null;
  product_name: string;
  unit: string;
  qty: string;
  vat_rate?: string;
  unit_price: string;
  unit_cost?: string | null;
}

export interface VatBreakdownRow {
  vat_rate: string;
  net: string;
  vat: string;
  gross: string;
}

export interface DailySalesReport {
  id: number;
  uuid: string;
  report_number: string;
  date: string;
  status: SalesReportStatus;
  notes: string;
  amount: string;
  cost_total: string | null;
  vat_breakdown: VatBreakdownRow[];
  lines: SalesReportLine[];
  created_at: string;
  updated_at: string;
}

export interface DailySalesReportSummary {
  id: number;
  uuid: string;
  report_number: string;
  date: string;
  status: SalesReportStatus;
  notes: string;
  amount: string;
  cost_total: string | null;
  line_count: number;
  created_at: string;
}

export interface DailySalesReportWrite {
  date: string;
  status: SalesReportStatus;
  notes?: string;
  lines: SalesReportLineWrite[];
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export interface TemplateLine {
  product_id: string;
  product_name: string;
  unit: string;
  qty: number;
  unit_price: number;
  unit_cost: number | null;
}

export interface SalesReportTemplate {
  id: number;
  uuid: string;
  name: string;
  is_default: boolean;
  lines: TemplateLine[];
  created_at: string;
  updated_at: string;
}

export interface SalesReportTemplateWrite {
  name: string;
  is_default?: boolean;
  lines: TemplateLine[];
}

// ---------------------------------------------------------------------------
// Paginated list
// ---------------------------------------------------------------------------

export interface PaginatedSalesReports {
  count: number;
  next: string | null;
  previous: string | null;
  results: DailySalesReportSummary[];
}

// ---------------------------------------------------------------------------
// Cash Flow / Kieszonkowy Wynik – TypeScript types
// ---------------------------------------------------------------------------

export type TaxForm = 'kpir_linear' | 'kpir_scale' | 'ryczalt';
export type VatMethod = 'memoriałowa' | 'kasowa';
export type CostType = 'direct' | 'indirect';

export type QuickExpenseCategory =
  | 'raw_materials'
  | 'packaging'
  | 'fuel'
  | 'transport'
  | 'utilities'
  | 'rent'
  | 'services'
  | 'marketing'
  | 'salaries'
  | 'repair'
  | 'other';

export const QUICK_EXPENSE_CATEGORY_LABELS: Record<QuickExpenseCategory, string> = {
  raw_materials: 'Surowce / materiały',
  packaging: 'Opakowania',
  fuel: 'Paliwo',
  transport: 'Transport',
  utilities: 'Media',
  rent: 'Czynsz / leasing',
  services: 'Usługi zewnętrzne',
  marketing: 'Marketing',
  salaries: 'Wynagrodzenia',
  repair: 'Naprawa',
  other: 'Inne',
};

export type DocumentType = 'paragon' | 'faktura_vat' | 'faktura_pdf' | 'faktura_rr' | 'wz' | 'inne';

export const TAX_FORM_LABELS: Record<TaxForm, string> = {
  kpir_linear: 'KPiR – liniowy 19%',
  kpir_scale: 'KPiR – skala',
  ryczalt: 'Ryczałt',
};

// ---------------------------------------------------------------------------
// OPEX Category
// ---------------------------------------------------------------------------

export interface OpexCategory {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CompanyTaxConfig {
  id: string;
  tax_form: TaxForm;
  tax_rate: string;
  vat_payer: boolean;
  vat_method: VatMethod;
  vat_due_day: number;
  zus_due_day: number;
  zus_status: string;
  has_sick_insurance: boolean;
  cash_balance: string;
  bank_balance: string;
  vat_balance: string;
  balance_date: string | null;
  balance_updated_at: string | null;
  updated_at: string;
}

export type CompanyTaxConfigWrite = Partial<
  Omit<CompanyTaxConfig, 'id' | 'updated_at' | 'balance_updated_at'>
>;

// ---------------------------------------------------------------------------
// Quick Expense
// ---------------------------------------------------------------------------

export interface QuickExpenseLine {
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_rate: string;
  line_net: string;
  line_gross: string;
}

export interface QuickExpense {
  id: string;
  date: string;
  amount: string;
  amount_net: string | null;
  vat_rate: string;
  lines: QuickExpenseLine[];
  category: QuickExpenseCategory;
  cost_type: CostType;
  has_vat: boolean;
  vendor: string;
  document_number: string;
  document_type: DocumentType;
  product_name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface QuickExpenseWrite {
  date: string;
  amount: string;
  amount_net?: string | null;
  vat_rate?: string;
  lines?: QuickExpenseLine[];
  category: QuickExpenseCategory;
  cost_type: CostType;
  has_vat: boolean;
  vendor?: string;
  document_number?: string;
  document_type?: DocumentType;
  product_name?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// B2C Revenue
// ---------------------------------------------------------------------------

export type B2CSaleType = 'manual' | 'products';

export interface B2CSaleLine {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;   // price_gross per unit
  unit_cost: number;    // avg_cost per unit
  line_revenue: number; // qty × unit_price
  line_cost: number;    // qty × unit_cost
}

export interface DailyB2CRevenue {
  id: string;
  date: string;
  amount: string;
  vat_included: boolean;
  vat_rate: string;
  notes: string;
  sale_type: B2CSaleType;
  lines: B2CSaleLine[];
  cost_total: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyB2CRevenueWrite {
  date: string;
  amount: string;
  vat_included: boolean;
  vat_rate: string;
  notes?: string;
  sale_type?: B2CSaleType;
  lines?: B2CSaleLine[];
  cost_total?: string | null;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface ObligationBreakdownItem {
  label: string;
  value: string;
}

export interface TaxObligation {
  type: 'vat' | 'zus' | 'zus_health' | 'pit';
  label: string;
  amount: number;
  due_date: string;
  days_until: number;
  breakdown?: ObligationBreakdownItem[];
  note?: string;
}

export interface Receivable {
  id: string;
  invoice_number: string;
  customer_name: string;
  amount: number;
  due_date: string | null;
  days_until: number | null;
}

export interface Payable {
  id: string;
  ksef_number: string;
  invoice_number: string;
  seller_name: string;
  issue_date: string;
  amount: number;
  due_date: string;
  days_until: number;
}

export interface PayablesData {
  total_count: number;
  total_amount: number;
  items: Payable[];
}

export interface CashFlowToday {
  cash_balance: number;
  bank_balance: number;
  vat_balance: number;
  balance_updated_at: string | null;
  total_available: number;
  upcoming_obligations: TaxObligation[];
  total_reserved: number;
  really_yours: number;
  has_config: boolean;
  receivables: Receivable[];
  payables: PayablesData;
}

export interface RecentQuickExpense {
  id: string;
  date: string;
  amount: string;
  category: QuickExpenseCategory;
  category_label: string;
  vendor: string;
  has_vat: boolean;
}

export interface VatInputInvoice {
  id: string;
  vendor: string;
  issue_date: string;
  vat_amount: number;
  gross_amount: number | null;
  opex_category: string;
}

export interface BreakdownItem {
  label: string;
  value: string;
}

export interface RevenueTopItem {
  id: number;
  name: string;
  invoice_number: string;
  amount: number;
  // paid items have `date`; outstanding items have `due_date` + `days_overdue`
  date?: string;
  due_date?: string;
  days_overdue?: number;
}

export interface B2CLineItem {
  name: string;
  qty: number;
  unit_price: number;
  line_revenue: number;
}

export interface B2CTopItem {
  uuid: string;
  date: string;
  amount: number;
  notes: string;
  sale_type: 'manual' | 'products';
  lines: B2CLineItem[];
}

export interface KSeFInvoiceItem {
  id: number;
  seller_name: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  amount: number;
  category_labels: string[];
  is_paid: boolean;
}

export interface QuickExpenseCategorySummary {
  category: string;
  label: string;
  total: number;
  count: number;
}

export interface FixedCostItem {
  description: string;
  category: string;
  amount: number;
}

export interface CashFlowMonth {
  period: string;
  revenue_paid: number;
  revenue_outstanding: number;
  b2c_revenue: number;
  costs_ksef: number;
  costs_quick: number;
  costs_fixed: number;
  vat_output: number;
  vat_input: number;
  vat_to_pay: number;
  vat_surplus: number;
  vat_due_date: string | null;
  vat_input_invoices: VatInputInvoice[];
  pit_estimate: number;
  pit_is_estimate: boolean;
  zus_social: number;
  zus_health: number;
  zus_monthly: number;
  zus_due_date: string;
  really_yours_estimate: number;
  zus_breakdown?: BreakdownItem[];
  health_breakdown?: BreakdownItem[];
  pit_breakdown?: BreakdownItem[];
  result_breakdown?: BreakdownItem[];
  revenue_paid_count?: number;
  revenue_paid_top?: RevenueTopItem[];
  revenue_outstanding_count?: number;
  revenue_outstanding_top?: RevenueTopItem[];
  b2c_entries_count?: number;
  b2c_top?: B2CTopItem[];
  costs_ksef_count?: number;
  costs_ksef_by_category?: QuickExpenseCategorySummary[];
  costs_ksef_items?: KSeFInvoiceItem[];
  costs_quick_by_category?: QuickExpenseCategorySummary[];
  costs_fixed_items?: FixedCostItem[];
  recent_quick_expenses: RecentQuickExpense[];
  uncategorized_ksef_count: number;
  tax_threshold_alert?: TaxThresholdAlert | null;
}

export interface TaxThresholdAlert {
  type: 'warning' | 'crossed';
  title: string;
  message: string;
  ytd: number;
  threshold: number;
  remaining: number;
}

export interface CashFlowDashboard {
  today: CashFlowToday;
  month: CashFlowMonth;
}

// ---------------------------------------------------------------------------
// Period Summary
// ---------------------------------------------------------------------------

export interface CashFlowPeriodSummary {
  date_from: string;
  date_to: string;
  revenue_total: number;
  revenue_b2b_paid: number;
  revenue_b2c: number;
  costs_suppliers: number;
  costs_quick: number;
  costs_fixed_total: number;
  taxes_vat: number;
  taxes_zus_social: number;
  taxes_zus_health: number;
  taxes_pit: number;
  taxes_total: number;
  profit_net: number;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface CashFlowHistoryMonth {
  period: string;          // 'YYYY-MM'
  revenue_total: number;
  costs_total: number;
  really_yours: number;
  is_loss: boolean;
  margin_pct: number | null;
}

// ---------------------------------------------------------------------------
// Expense Chart
// ---------------------------------------------------------------------------

export interface ExpenseChartPeriod {
  period: string;
  total: number;
  [category: string]: number | string; // dynamic category keys
}

// ---------------------------------------------------------------------------
// Harmonogram (Payment Schedule)
// ---------------------------------------------------------------------------

export type HarmonogramEventType =
  | 'b2b_incoming'
  | 'b2c_incoming'
  | 'fixed_cost'
  | 'vat'
  | 'zus_social'
  | 'zus_health'
  | 'supplier_invoice'
  | 'quick_expense';

export type HarmonogramEventStatus = 'paid' | 'expected' | 'overdue';

export interface HarmonogramEvent {
  date: string;
  type: HarmonogramEventType;
  label: string;
  sublabel: string;
  amount: number;
  direction: 'in' | 'out';
  status: HarmonogramEventStatus;
  running_balance: number | null;
  before_anchor: boolean;
}

export interface HarmonogramData {
  period: string;
  opening_balance: number;
  vat_balance: number;
  has_balance: boolean;
  anchor_date: string | null;
  balance_updated_at: string | null;
  total_in: number;
  confirmed_in: number;
  expected_in: number;
  total_out: number;
  closing_balance: number;
  min_balance: number;
  min_balance_date: string | null;
  events: HarmonogramEvent[];
}


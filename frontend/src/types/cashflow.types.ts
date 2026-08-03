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

export type DocumentType = 'paragon' | 'faktura_vat' | 'wz' | 'inne';

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
  cash_balance: string;
  bank_balance: string;
  balance_updated_at: string | null;
  updated_at: string;
}

export type CompanyTaxConfigWrite = Partial<
  Omit<CompanyTaxConfig, 'id' | 'updated_at' | 'balance_updated_at'>
>;

// ---------------------------------------------------------------------------
// Quick Expense
// ---------------------------------------------------------------------------

export interface QuickExpense {
  id: string;
  date: string;
  amount: string;
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

export interface DailyB2CRevenue {
  id: string;
  date: string;
  amount: string;
  vat_included: boolean;
  vat_rate: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface DailyB2CRevenueWrite {
  date: string;
  amount: string;
  vat_included: boolean;
  vat_rate: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface TaxObligation {
  type: 'vat' | 'zus' | 'pit';
  label: string;
  amount: number;
  due_date: string;
  days_until: number;
}

export interface CashFlowToday {
  cash_balance: number;
  bank_balance: number;
  balance_updated_at: string | null;
  total_available: number;
  upcoming_obligations: TaxObligation[];
  total_reserved: number;
  really_yours: number;
  has_config: boolean;
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
  zus_monthly: number;
  zus_due_date: string;
  really_yours_estimate: number;
  recent_quick_expenses: RecentQuickExpense[];
  uncategorized_ksef_count: number;
}

export interface CashFlowDashboard {
  today: CashFlowToday;
  month: CashFlowMonth;
}

// ---------------------------------------------------------------------------
// Expense Chart
// ---------------------------------------------------------------------------

export interface ExpenseChartPeriod {
  period: string;
  total: number;
  [category: string]: number | string; // dynamic category keys
}

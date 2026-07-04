/** Legacy role string — kept for backwards compat; prefer UserPermissions */
export type CompanyRole = 'admin' | 'manager' | 'driver' | 'viewer' | string

export interface UserPermissions {
  can_manage_team: boolean
  can_manage_settings: boolean
  can_see_prices: boolean
  can_manage_products: boolean
  can_manage_warehouses: boolean
  can_manage_inventory: boolean
  can_manage_customers: boolean
  can_manage_orders: boolean
  can_manage_delivery: boolean
  can_access_routes: boolean
  can_manage_invoices: boolean
  can_manage_purchasing: boolean
  can_manage_production: boolean
  can_view_reports: boolean
  can_access_ksef_inbox: boolean
  can_manage_stock_moves: boolean
  can_manage_accounting: boolean
}

export const EMPTY_PERMISSIONS: UserPermissions = {
  can_manage_team: false,
  can_manage_settings: false,
  can_see_prices: false,
  can_manage_products: false,
  can_manage_warehouses: false,
  can_manage_inventory: false,
  can_manage_customers: false,
  can_manage_orders: false,
  can_manage_delivery: false,
  can_access_routes: false,
  can_manage_invoices: false,
  can_manage_purchasing: false,
  can_manage_production: false,
  can_view_reports: false,
  can_access_ksef_inbox: false,
  can_manage_stock_moves: false,
  can_manage_accounting: false,
}

export interface CompanyRoleDefinition {
  id: string
  name: string
  is_admin: boolean
  permissions: UserPermissions
  member_count: number
  created_at: string
  // flat permission fields also returned by the API
  can_manage_team: boolean
  can_manage_settings: boolean
  can_see_prices: boolean
  can_manage_products: boolean
  can_manage_warehouses: boolean
  can_manage_inventory: boolean
  can_manage_customers: boolean
  can_manage_orders: boolean
  can_manage_delivery: boolean
  can_access_routes: boolean
  can_manage_invoices: boolean
  can_manage_purchasing: boolean
  can_manage_production: boolean
  can_view_reports: boolean
  can_access_ksef_inbox: boolean
  can_manage_stock_moves: boolean
  can_manage_accounting: boolean
}

export interface TeamMemberUser {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
}

export interface TeamMember {
  id: string
  user: TeamMemberUser
  company_role: CompanyRoleDefinition | null
  role: string
  is_active: boolean
  joined_at: string
}

export type ModuleName =
  | 'products'
  | 'customers'
  | 'warehouses'
  | 'orders'
  | 'delivery'
  | 'invoicing'
  | 'ksef'
  | 'ksef_inbox'
  | 'reporting'
  | 'cost_allocation'
  | 'purchasing'
  | 'production'
  | 'van_routes'

export interface Company {
  id: string
  name: string
  nip: string
  address: string
  city: string
  postalCode: string
  phone: string
  email: string
  isActive: boolean
  createdAt: string
}

export interface CompanyMembership {
  id: string
  company: Company
  role: CompanyRole
  isActive: boolean
  joinedAt: string
}

export interface CompanyModule {
  module: ModuleName
  isEnabled: boolean
  enabledAt: string | null
}

export interface CompanyWorkflowSettings {
  orders_required: boolean;
  wz_required_before_invoice: boolean;
}

export interface CompanyWrite {
  name: string
  nip?: string
  address?: string
  city?: string
  postalCode?: string
  phone?: string
  email?: string
  taxation_form?: string
  ryczalt_category?: string | null
}

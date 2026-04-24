export type CompanyRole = 'admin' | 'manager' | 'driver' | 'viewer'
export type ModuleName =
  | 'products'
  | 'customers'
  | 'warehouses'
  | 'orders'
  | 'delivery'
  | 'invoicing'
  | 'ksef'
  | 'reporting'

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

export interface CompanyWrite {
  name: string
  nip?: string
  address?: string
  city?: string
  postalCode?: string
  phone?: string
  email?: string
}

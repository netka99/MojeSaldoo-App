/**
 * Customer entity — mirrors `apps.customers.models.Customer` / DRF `CustomerSerializer`.
 */
export interface Customer {
  id: string;
  user: number | null;
  name: string;
  company_name: string | null;
  nip: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  distance_km: number | null;
  delivery_days: string | null;
  payment_terms: number;
  credit_limit: string | number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CustomerWrite = Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'user'> &
  Partial<Pick<Customer, 'id'>>;

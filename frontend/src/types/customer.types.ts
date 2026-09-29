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
  // KSeF / FA-3 Podmiot2 flags
  is_jst: boolean;
  is_gv_member: boolean;
  // KSeF / FA-3 Podmiot3 (trzecia strona faktury)
  podmiot3_role: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | null;
  podmiot3_name: string | null;
  podmiot3_id_wew: string | null;
  podmiot3_street: string | null;
  podmiot3_city: string | null;
  podmiot3_postal_code: string | null;
  created_at: string;
  updated_at: string;
}

export type CustomerWrite = Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'user'> &
  Partial<Pick<Customer, 'id'>>;

export type PriceType = 'net' | 'gross';

export interface CustomerProductPrice {
  id: string;
  customer: string;
  product: string;
  product_name: string;
  product_unit: string;
  product_price_net: string;
  product_vat_rate: string;
  price_net: string;
  price_type: PriceType;
  note: string;
  created_at: string;
  updated_at: string;
}

export type CustomerProductPriceWrite = {
  customer: string;
  product: string;
  price_net: string;
  price_type?: PriceType;
  note?: string;
};

export type CustomerProductPriceUpdate = {
  price_net: string;
  price_type?: PriceType;
  note?: string;
};

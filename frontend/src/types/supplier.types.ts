/**
 * Supplier types — match `apps.suppliers.serializers` (DRF JSON, snake_case).
 */

/** Full supplier as returned from GET /api/suppliers/:id/ */
export interface Supplier {
  id: string;
  company: string;
  name: string;
  nip: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postal_code: string;
  country: string;
  payment_terms: number;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Slim shape returned from GET /api/suppliers/ (list). */
export interface SupplierListItem {
  id: string;
  name: string;
  nip: string;
  city: string;
  is_active: boolean;
}

/** `POST /api/suppliers/` — create a new supplier. */
export interface SupplierCreate {
  name: string;
  nip?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  payment_terms?: number;
  notes?: string;
}

/** `PATCH /api/suppliers/:id/` — partial update. */
export type SupplierPatch = Partial<SupplierCreate> & {
  is_active?: boolean;
};

export interface PaginatedSuppliers {
  count: number;
  next: string | null;
  previous: string | null;
  results: SupplierListItem[];
}

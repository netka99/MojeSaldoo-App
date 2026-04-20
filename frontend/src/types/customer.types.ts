export interface Customer {
  id: string;
  name: string;
  address: string;
  nip?: string;
  phone?: string;
  distance: number; // Distance in km (DZ5)
  createdAt: string;
}

export interface CustomerFormData {
  name: string;
  address: string;
  nip?: string;
  phone?: string;
  distance: number;
}
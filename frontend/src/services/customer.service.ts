import { api } from './api';
import type { Customer, CustomerProductPrice, CustomerProductPriceUpdate, CustomerProductPriceWrite, CustomerWrite } from '../types';

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Query params aligned with `CustomerViewSet` filters, search, ordering, and pagination. */
export type CustomerListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  name?: string;
  nip?: string;
  country?: string;
  is_active?: boolean;
  city?: string;
  distance_km?: number;
};

export const customerService = {
  fetchList: (params?: CustomerListParams) =>
    api.get<PaginatedResponse<Customer>>('/customers/', { params }),

  fetchById: (id: string) => api.get<Customer>(`/customers/${id}/`),

  createItem: (body: CustomerWrite) => api.post<Customer>('/customers/', body),

  updateItem: (id: string, body: CustomerWrite) => api.put<Customer>(`/customers/${id}/`, body),

  deleteItem: (id: string) => api.delete<Record<string, never>>(`/customers/${id}/`),

  partialUpdateItem: (id: string, body: Partial<CustomerWrite>) =>
    api.patch<Customer>(`/customers/${id}/`, body),
};

export const customerPriceService = {
  fetchByCustomer: (customerId: string) =>
    api.get<CustomerProductPrice[]>('/customer-product-prices/', { params: { customer: customerId } }),

  create: (body: CustomerProductPriceWrite) =>
    api.post<CustomerProductPrice>('/customer-product-prices/', body),

  update: (id: string, body: CustomerProductPriceUpdate) =>
    api.patch<CustomerProductPrice>(`/customer-product-prices/${id}/`, body),

  delete: (id: string) =>
    api.delete<Record<string, never>>(`/customer-product-prices/${id}/`),
};

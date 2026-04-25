import type { OrderListParams } from '@/services/order.service';

export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  /** `companyId` isolates cache per active company (after switch / new org). */
  list: (params: { page: number; search: string; companyId: string }) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
};

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params: { page: number; sku: string }) => [...productKeys.lists(), params] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

export const warehouseKeys = {
  all: ['warehouses'] as const,
  lists: () => [...warehouseKeys.all, 'list'] as const,
  list: (params: { page: number }) => [...warehouseKeys.lists(), params] as const,
  details: () => [...warehouseKeys.all, 'detail'] as const,
  detail: (id: string) => [...warehouseKeys.details(), id] as const,
};

export const companyKeys = {
  all: ['companies'] as const,
  me: () => [...companyKeys.all, 'me'] as const,
  modules: (companyId: string) => [...companyKeys.all, 'modules', companyId] as const,
  ksefCertificateStatus: (companyId: string) =>
    [...companyKeys.all, 'ksef-certificate', 'status', companyId] as const,
};

/** List cache key: page + active company + filter fields (after `page` is stripped from `OrderListParams`). */
export type OrderListKeyParams = Omit<OrderListParams, 'page'> & { page: number; companyId: string };

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (params: OrderListKeyParams) => [...orderKeys.lists(), params] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
};

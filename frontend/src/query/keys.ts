import type { DeliveryListParams } from '@/services/delivery.service';
import type { InvoiceListParams } from '@/services/invoice.service';
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

/** List cache key: page + active company + filter fields (after `page` is stripped from `DeliveryListParams`). */
export type DeliveryListKeyParams = Omit<DeliveryListParams, 'page'> & { page: number; companyId: string };

export const deliveryKeys = {
  all: ['delivery-documents'] as const,
  lists: () => [...deliveryKeys.all, 'list'] as const,
  list: (params: DeliveryListKeyParams) => [...deliveryKeys.lists(), params] as const,
  details: () => [...deliveryKeys.all, 'detail'] as const,
  detail: (id: string) => [...deliveryKeys.details(), id] as const,
};

/** List cache key: page + active company (and future filters from `InvoiceListParams`). */
export type InvoiceListKeyParams = Omit<InvoiceListParams, 'page'> & {
  page: number;
  companyId: string;
};

export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: () => [...invoiceKeys.all, 'list'] as const,
  list: (params: InvoiceListKeyParams) => [...invoiceKeys.lists(), params] as const,
  details: () => [...invoiceKeys.all, 'detail'] as const,
  detail: (id: string) => [...invoiceKeys.details(), id] as const,
  previews: () => [...invoiceKeys.all, 'preview'] as const,
  preview: (id: string) => [...invoiceKeys.previews(), id] as const,
};

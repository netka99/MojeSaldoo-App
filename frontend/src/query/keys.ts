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

/** List cache key — include filter fields so main/mobile (and `companyId`) do not clash. */
export type WarehouseListKeyParams = {
  page: number;
  companyId?: string;
  page_size?: number;
  warehouse_type?: string;
  is_active?: boolean;
  ordering?: string;
};

export const warehouseKeys = {
  all: ['warehouses'] as const,
  lists: () => [...warehouseKeys.all, 'list'] as const,
  list: (params: WarehouseListKeyParams) => [...warehouseKeys.lists(), params] as const,
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
  previews: () => [...deliveryKeys.all, 'preview'] as const,
  preview: (id: string) => [...deliveryKeys.previews(), id] as const,
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

export type ReportRangeKeyParams = {
  companyId: string;
  dateFrom: string;
  dateTo: string;
};

/** Cache key for `GET /reports/invoices/` — empty strings mean “no filter” for stable keys. */
export type ReportingInvoicesListKeyParams = {
  companyId: string;
  page: number;
  dateFrom: string;
  dateTo: string;
  status: string;
};

export const reportKeys = {
  all: ['reports'] as const,
  salesSummary: (p: ReportRangeKeyParams) => [...reportKeys.all, 'sales-summary', p] as const,
  topProducts: (p: ReportRangeKeyParams & { limit: number }) =>
    [...reportKeys.all, 'top-products', p] as const,
  topCustomers: (p: ReportRangeKeyParams & { limit: number }) =>
    [...reportKeys.all, 'top-customers', p] as const,
  ksefStatus: (companyId: string) => [...reportKeys.all, 'ksef-status', companyId] as const,
  reportingInvoices: (p: ReportingInvoicesListKeyParams) =>
    [...reportKeys.all, 'invoices', p] as const,
  inventory: (companyId: string) => [...reportKeys.all, 'inventory', companyId] as const,
};

export const stockSnapshotKeys = {
  all: ['stock-snapshot'] as const,
  byWarehouse: (warehouseId: string) => [...stockSnapshotKeys.all, warehouseId] as const,
};

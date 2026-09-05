import { api, API_BASE_URL } from './api';

export type PurchaseDocDocType = 'FZ' | 'PAR' | 'PAR_VAT';
export type PurchaseDocStatus = 'draft' | 'registered' | 'matched';
export type PaymentMethod = 'transfer' | 'cash' | 'card';

export interface PurchaseDocumentItem {
  id: string;
  product: string | null;
  product_display_name: string | null;
  product_name: string;
  unit: string;
  quantity: string;
  unit_price_gross: string;
  vat_rate: string;
  line_gross: string;
  created_at: string;
}

export interface PurchaseDocument {
  id: string;
  doc_type: PurchaseDocDocType;
  status: PurchaseDocStatus;
  pz_id: string | null;
  pz_number: string | null;
  supplier_name: string;
  supplier_nip: string;
  document_number: string;
  issue_date: string | null;
  due_date: string | null;
  payment_method: PaymentMethod;
  is_paid: boolean;
  paid_at: string | null;
  opex_category: string | null;
  accounting_status: 'pending' | 'annotated' | 'booked';
  accounting_notes: string;
  total_net: string;
  total_vat: string;
  total_gross: string;
  notes: string;
  ocr_raw_filename: string;
  items: PurchaseDocumentItem[];
  created_at: string;
  updated_at: string;
}

export interface PurchaseDocumentWrite {
  doc_type?: PurchaseDocDocType;
  status?: PurchaseDocStatus;
  supplier_id?: string | null;
  supplier_name?: string;
  supplier_nip?: string;
  document_number?: string;
  issue_date?: string | null;
  due_date?: string | null;
  payment_method?: PaymentMethod;
  is_paid?: boolean;
  opex_category?: string | null;
  accounting_status?: 'pending' | 'annotated' | 'booked';
  accounting_notes?: string;
  total_net?: string;
  total_vat?: string;
  total_gross?: string;
  notes?: string;
  ocr_raw_filename?: string;
  delivery_document_id?: string | null;
  items_write?: Array<{
    product_id?: string | null;
    product_name: string;
    unit?: string;
    quantity: string;
    unit_price_gross?: string;
    vat_rate?: string;
    line_gross?: string;
  }>;
}

export interface PaginatedPurchaseDocuments {
  count: number;
  next: string | null;
  previous: string | null;
  results: PurchaseDocument[];
}

export type PurchaseDocListParams = {
  page?: number;
  page_size?: number;
  doc_type?: PurchaseDocDocType;
  status?: PurchaseDocStatus;
  payment_method?: PaymentMethod;
  search?: string;
  ordering?: string;
  issue_date__gte?: string;
  issue_date__lte?: string;
};

const basePath = '/purchase-documents/';

export const purchaseDocumentService = {
  fetchList: (params?: PurchaseDocListParams) =>
    api.get<PaginatedPurchaseDocuments>(basePath, { params }),

  fetchById: (id: string) =>
    api.get<PurchaseDocument>(`${basePath}${id}/`),

  create: (data: PurchaseDocumentWrite) =>
    api.post<PurchaseDocument>(basePath, data),

  patch: (id: string, data: PurchaseDocumentWrite) =>
    api.patch<PurchaseDocument>(`${basePath}${id}/`, data),

  markPaid: (id: string, isPaid: boolean) =>
    api.patch<PurchaseDocument>(`${basePath}${id}/mark-paid/`, { is_paid: isPaid }),

  setCategory: (id: string, category: string | null) =>
    api.patch<PurchaseDocument>(`${basePath}${id}/set-category/`, { opex_category: category }),

  delete: (id: string) =>
    api.delete<Record<string, never>>(`${basePath}${id}/`),

  getFileUrl: (id: string) => `${API_BASE_URL}/purchase-documents/${id}/file/`,

  createPz: (id: string, warehouseId: string) =>
    api.post<PurchaseDocument>(`${basePath}${id}/create-pz/`, { to_warehouse_id: warehouseId }),

  linkPz: (id: string, pzId: string) =>
    api.post<PurchaseDocument>(`${basePath}${id}/link-pz/`, { pz_id: pzId }),
};

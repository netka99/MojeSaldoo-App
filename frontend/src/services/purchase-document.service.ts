import { api, API_BASE_URL } from './api';

export type PurchaseDocDocType = 'FZ' | 'PAR' | 'PAR_VAT';
export type PurchaseDocStatus = 'draft' | 'registered' | 'matched';
export type PaymentMethod = 'transfer' | 'cash' | 'card';

export interface ItemCoverage {
  quantity_matched_total: string;
  pz_numbers: string[];
}

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
  coverage: ItemCoverage;
  created_at: string;
}

// ─── 3-way matching types ─────────────────────────────────────────────────────

export interface MatchProposalItem {
  id: string;
  product_name: string;
  product_id: string | null;
  quantity: string;
  quantity_already_matched: string;
  quantity_unmatched: string;
  unit: string;
  unit_price_gross: string;
}

export interface MatchProposalDeliveryItem {
  id: string;
  product_name: string;
  product_id: string;
  quantity_planned: string;
  quantity_already_matched: string;
  quantity_available: string;
  unit_cost: string | null;
}

export interface MatchProposal {
  invoice_item: MatchProposalItem;
  delivery_item: MatchProposalDeliveryItem;
  quantity_matched: string;
  match_type: 'exact' | 'fuzzy';
  confidence: number;
}

export interface MatchProposalsResponse {
  invoice_id: string;
  pz_id: string;
  proposals: MatchProposal[];
  unmatched_invoice_items: MatchProposalItem[];
  unmatched_delivery_items: MatchProposalDeliveryItem[];
}

export interface LineMatchPayload {
  invoice_item_id: string;
  delivery_item_id: string;
  quantity_matched: string;
}

export interface ConfirmLineMatchesPayload {
  pz_id: string;
  matches: LineMatchPayload[];
}

export interface PurchaseDocumentPzRef {
  id: string;
  document_number: string;
  status: string;
  issue_date: string | null;
}

export interface PurchaseDocument {
  id: string;
  doc_type: PurchaseDocDocType;
  status: PurchaseDocStatus;
  /** M:M list of linked PZ documents. */
  pz_documents: PurchaseDocumentPzRef[];
  /** Backward-compat: first linked PZ UUID, or null. */
  pz_id: string | null;
  /** Backward-compat: first linked PZ number, or null. */
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
  line_categories?: Record<string, string>;
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
  line_categories?: Record<string, string>;
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

  unlinkPz: (id: string, pzId: string) =>
    api.post<PurchaseDocument>(`${basePath}${id}/unlink-pz/`, { pz_id: pzId }),

  setLineCategories: (id: string, line_categories: Record<string, string>) =>
    api.patch<PurchaseDocument>(`${basePath}${id}/set-line-categories/`, { line_categories }),

  getMatchProposals: (id: string, pzId: string) =>
    api.get<MatchProposalsResponse>(`${basePath}${id}/match-proposals/`, { params: { pz_id: pzId } }),

  confirmLineMatches: (id: string, payload: ConfirmLineMatchesPayload) =>
    api.post<PurchaseDocument>(`${basePath}${id}/confirm-line-matches/`, payload),
};

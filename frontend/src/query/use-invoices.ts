import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { invoiceService, type InvoiceListParams, type InvoiceSummary } from '@/services/invoice.service';
import { ksefService, type ReceivedInvoicesResult, type ParsedInvoiceResult, type OpexCategory, type PaperScanResult, type KorMatchResult } from '@/services/ksef.service';
import type {
  GenerateInvoiceFromOrderBody,
  Invoice,
  InvoiceCreate,
  InvoicePatch,
} from '@/types';
import { invoiceKeys, orderKeys } from './keys';

export type InvoiceListFilters = Omit<InvoiceListParams, 'page'>;

/**
 * Paginated invoices. Cache key includes `page` and active company.
 */
export function useInvoiceListQuery(page: number, filters: InvoiceListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: invoiceKeys.list({ page, companyId, ...filters }),
    queryFn: () => invoiceService.fetchList({ page, ...filters }),
  });
}

export function useInvoiceQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? invoiceKeys.detail(id) : [...invoiceKeys.details(), 'pending'],
    queryFn: () => invoiceService.fetchById(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useInvoicePreviewQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? invoiceKeys.preview(id) : [...invoiceKeys.previews(), 'pending'],
    queryFn: () => invoiceService.fetchPreview(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateInvoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: InvoiceCreate) => invoiceService.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}

export function usePatchInvoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: InvoicePatch }) =>
      invoiceService.patch(id, data),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.preview(inv.id) });
    },
  });
}

export function useDeleteInvoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoiceService.delete(id),
    onSuccess: (_void, id) => {
      void queryClient.removeQueries({ queryKey: invoiceKeys.detail(id) });
      void queryClient.removeQueries({ queryKey: invoiceKeys.preview(id) });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}

export function useGenerateInvoiceFromOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      body = {},
    }: {
      orderId: string;
      body?: GenerateInvoiceFromOrderBody;
    }) => invoiceService.generateFromOrder(orderId, body),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useIssueInvoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoiceService.issue(id),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.preview(inv.id) });
    },
  });
}

export function useMarkPaidInvoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoiceService.markPaid(id),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.preview(inv.id) });
    },
  });
}

export function useMarkUnpaidInvoiceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoiceService.markUnpaid(id),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.preview(inv.id) });
    },
  });
}

/**
 * Check the company's active KSeF session status on the backend.
 * Runs once on mount (not automatically refetching).
 */
export function useKsefSessionQuery(enabled = true) {
  return useQuery({
    queryKey: ['ksef', 'session'],
    queryFn: () => ksefService.checkSession(),
    enabled,
    staleTime: 30_000,   // Re-check every 30s at most
    retry: false,
  });
}

/**
 * Authenticate with KSeF via SSAPI.
 * On 422, the caller should retry after 2s (auth is in progress on SSAPI side).
 */
export function useKsefAuthenticateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passphrase: string) => ksefService.authenticate(passphrase),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'session'] });
    },
  });
}

export function useKsefClearSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ksefService.clearSession(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'session'] });
    },
  });
}

/** Submit an issued invoice to KSeF via SSAPI. */
export function useSendToKsefMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoiceService.sendToKsef(id),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
    },
  });
}

/** Fetch updated KSeF status from SSAPI for a sent invoice. */
export function useFetchKsefStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoiceService.fetchKsefStatus(id),
    onSuccess: (inv: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(inv.id) });
    },
  });
}

/** Sync received invoices from KSeF into local DB for a date range. */
export function useKsefInboxSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) =>
      ksefService.syncInbox(dateFrom, dateTo),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'inbox'] });
    },
  });
}

/** Parse a received KSeF invoice XML and return structured line items with product suggestions. */
export function useKsefInboxParseQuery(ksefNumber: string, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery<ParsedInvoiceResult>({
    queryKey: ['ksef', 'inbox', 'parse', { companyId, ksefNumber }],
    queryFn: () => ksefService.parseInvoice(ksefNumber),
    enabled: enabled && Boolean(companyId) && Boolean(ksefNumber),
    staleTime: 5 * 60_000, // 5 minutes — XML doesn't change
  });
}

/**
 * For a KOR/KOR_ZAL/KOR_ROZ invoice: fetch the original PZ and its line items
 * to pre-fill the PZ-KOR creation form.
 */
export function useKsefKorMatchQuery(ksefNumber: string, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery<KorMatchResult>({
    queryKey: ['ksef', 'kor-match', { companyId, ksefNumber }],
    queryFn: () => ksefService.getKorMatch(ksefNumber),
    enabled: enabled && Boolean(companyId) && Boolean(ksefNumber),
    staleTime: 60_000,
  });
}

/** Mark a received KSeF invoice as paid or unpaid. */
export function useKsefMarkPaidMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ksefNumber, isPaid, dueDate }: { ksefNumber: string; isPaid: boolean; dueDate?: string }) =>
      ksefService.markInvoicePaid(ksefNumber, isPaid, dueDate),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
    },
  });
}

/** Tag or clear an OPEX category on a received KSeF invoice. */
export function useKsefTagOpexMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ksefNumber, opex_category }: { ksefNumber: string; opex_category: OpexCategory | null }) =>
      ksefService.tagOpexCategory(ksefNumber, opex_category),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'inbox'] });
    },
  });
}

/** Fetch per-line opex categories for a single received invoice. */
export function useKsefOpexLinesQuery(ksefNumber: string, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: ['ksef', 'opex-lines', companyId, ksefNumber],
    queryFn: () => ksefService.getOpexLines(ksefNumber),
    enabled: enabled && Boolean(companyId) && Boolean(ksefNumber),
    staleTime: 30_000,
  });
}

/** Assign opex category to one or more invoice lines (no cost_allocation module needed). */
export function useKsefLineOpexMutation(ksefNumber: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (line_categories: Record<string, string | null>) =>
      ksefService.tagOpexLines(ksefNumber, line_categories),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'opex-lines', companyId, ksefNumber] });
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'inbox'] });
    },
  });
}

/** Query received invoices from local DB (syncs new ones from KSeF on each call). */
export function useKsefInboxQuery(
  dateFrom: string,
  dateTo: string,
  page: number,
  enabled = true,
  isPaid?: boolean,
) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery<ReceivedInvoicesResult>({
    queryKey: ['ksef', 'inbox', { companyId, dateFrom, dateTo, page, isPaid }],
    queryFn: () => ksefService.queryReceivedInvoices(dateFrom, dateTo, page, 20, isPaid),
    enabled: enabled && Boolean(companyId),
  });
}

/** Upload a paper invoice image for OCR extraction. */
export function useKsefScanPaperMutation() {
  return useMutation<PaperScanResult, Error, File>({
    mutationFn: (image: File) => ksefService.scanPaperInvoice(image),
  });
}

export function useInvoiceSummaryQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery<InvoiceSummary>({
    queryKey: invoiceKeys.summary(companyId),
    queryFn: () => invoiceService.fetchSummary(),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

/** Create a draft FV-KOR correction for an issued or paid invoice. */
export function useCreateCorrectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: import('@/types').CreateCorrectionBody }) =>
      invoiceService.createCorrection(id, body),
    onSuccess: (correction: Invoice) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(correction.corrects_invoice_id ?? '') });
    },
  });
}

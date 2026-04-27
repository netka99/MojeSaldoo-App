import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { invoiceService, type InvoiceListParams } from '@/services/invoice.service';
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

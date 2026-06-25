import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { deliveryService, type DeliveryListParams } from '@/services/delivery.service';
import type {
  DeliveryCompletePayload,
  DeliveryDocument,
  DeliveryDocumentCreate,
  DeliveryDocumentPatch,
  DeliveryUpdateLinesPayload,
  PendingReturnItem,
  PzCompleteItemRow,
  PzCreatePayload,
  PzKorPayload,
  RwCreatePayload,
  StandaloneWzCreate,
  VanLoadingPayload,
  VanReconciliationPayload,
  WzKorPayload,
} from '@/types';
import { deliveryKeys, orderKeys, vanRouteKeys, stockSnapshotKeys, warehouseStockKeys } from './keys';

/** Filters for `useDeliveryListQuery` (excludes `page` — pass page as the first argument). */
export type DeliveryListFilters = Omit<DeliveryListParams, 'page'>;

/**
 * Paginated delivery documents. Cache key includes `page`, active company, and filter fields.
 */
export function useDeliveryListQuery(page: number, filters: DeliveryListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: deliveryKeys.list({ page, companyId, ...filters }),
    queryFn: () => deliveryService.fetchList({ page, ...filters }),
  });
}

/**
 * All WZ/ZW delivery documents linked to a specific order.
 * Returns the results array directly (no pagination — orders rarely exceed 20 WZ).
 */
export function useDeliveryByOrderQuery(orderId: string | undefined, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({ page: 1, companyId, order: orderId, include_items: true }),
    queryFn: () => deliveryService.fetchList({ page: 1, order: orderId, include_items: true }),
    enabled: Boolean(orderId) && Boolean(companyId) && enabled,
    select: (data) => data.results,
  });
}

/**
 * All WZ/ZW delivery documents for a list of orders in one request.
 * Pass an array of order IDs; returns all docs whose order is in that list.
 */
export function useDeliveryByOrdersQuery(orderIds: string[], enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const orderIdsKey = orderIds.slice().sort().join(',');
  return useQuery({
    queryKey: deliveryKeys.list({ page: 1, companyId, order_ids: orderIdsKey, include_items: true }),
    queryFn: () => deliveryService.fetchList({ page: 1, order_ids: orderIdsKey, ordering: '-issue_date', include_items: true }),
    enabled: orderIds.length > 0 && Boolean(companyId) && enabled,
    select: (data) => data.results,
  });
}

/**
 * All WZ/ZW delivery documents for a specific customer (via to_customer filter).
 * Returns the results array directly.
 */
export function useDeliveryByCustomerQuery(customerId: string | undefined, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({ page: 1, companyId, to_customer: customerId, include_items: true }),
    queryFn: () => deliveryService.fetchList({ page: 1, to_customer: customerId, include_items: true }),
    enabled: Boolean(customerId) && Boolean(companyId) && enabled,
    select: (data) => data.results,
  });
}

/**
 * All WZ+ZW documents for a single issue_date day — used by the "Wg sklepu" grouped view.
 * Fetches up to 200 docs (more than enough for one day's deliveries).
 */
export function useDeliveryByDayQuery(date: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({
      page: 1,
      companyId,
      issue_date_after: date,
      issue_date_before: date,
      page_size: 200,
      include_items: true,
      ordering: '-document_number',
    }),
    queryFn: () =>
      deliveryService.fetchList({
        page: 1,
        page_size: 200,
        issue_date_after: date,
        issue_date_before: date,
        ordering: '-document_number',
        include_items: true,
      }),
    enabled: Boolean(date) && Boolean(companyId),
  });
}

/**
 * All WZ+ZW documents for a date range — used by the "Wg sklepu" grouped view.
 * Fetches up to 500 docs (enough for a week/month of deliveries).
 */
export function useDeliveryByRangeQuery(dateFrom: string, dateTo: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({
      page: 1,
      companyId,
      issue_date_after: dateFrom,
      issue_date_before: dateTo,
      page_size: 500,
      include_items: true,
      ordering: '-document_number',
    }),
    queryFn: () =>
      deliveryService.fetchList({
        page: 1,
        page_size: 500,
        issue_date_after: dateFrom,
        issue_date_before: dateTo,
        ordering: '-document_number',
        include_items: true,
      }),
    enabled: Boolean(dateFrom) && Boolean(dateTo) && Boolean(companyId),
  });
}

export function useDeliveryQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? deliveryKeys.detail(id) : [...deliveryKeys.details(), 'pending'],
    queryFn: () => deliveryService.fetchById(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useDeliveryPreviewQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? deliveryKeys.preview(id) : [...deliveryKeys.previews(), 'pending'],
    queryFn: () => deliveryService.fetchPreview(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeliveryDocumentCreate) => deliveryService.createDocument(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

export function useAddReturnsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, returnItems }: { id: string; returnItems: PendingReturnItem[] }) =>
      deliveryService.addReturns(id, returnItems),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
    },
  });
}

export function useCreateStandaloneWzMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StandaloneWzCreate) => deliveryService.createStandaloneWz(body),
    onSuccess: (doc: DeliveryDocument, body: StandaloneWzCreate) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      // Invalidate the van route WZ list so the new doc shows up on the dashboard
      if (body.van_route_id) {
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const key = q.queryKey;
            return Array.isArray(key) && key.some((k) => typeof k === 'object' && k !== null && 'van_route' in k && (k as Record<string, unknown>).van_route === body.van_route_id);
          },
        });
      }
    },
  });
}

export function usePatchDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DeliveryDocumentPatch }) =>
      deliveryService.patchDocument(id, data),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
    },
  });
}

export function useDeleteDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deliveryService.deleteDocument(id),
    onSuccess: (_void, id) => {
      void queryClient.removeQueries({ queryKey: deliveryKeys.detail(id) });
      void queryClient.removeQueries({ queryKey: deliveryKeys.preview(id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

export function useSaveDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, returnItems }: { id: string; returnItems?: PendingReturnItem[] }) =>
      deliveryService.saveDocument(id, returnItems),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
    },
  });
}

export function useStartDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deliveryService.startDelivery(id),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
    },
  });
}

export function useCompleteDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: DeliveryCompletePayload }) =>
      deliveryService.completeDelivery(id, data),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.all });
    },
  });
}

export function useUpdateDeliveryLinesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DeliveryUpdateLinesPayload }) =>
      deliveryService.updateLines(id, data),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

/**
 * Sync an existing draft/saved WZ's items from the current order state.
 */
export function useSyncWzFromOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (wzId: string) => deliveryService.syncFromOrder(wzId),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
    },
  });
}

/**
 * Imperative `GET` that creates a draft WZ; invalidates delivery + order lists so remaining qty stays fresh.
 */
export function useGenerateDeliveryForOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      vanWarehouseId,
      vanRouteId,
      issueDate,
    }: {
      orderId: string;
      vanWarehouseId?: string;
      vanRouteId?: string;
      issueDate?: string;
    }) => deliveryService.generateForOrder(orderId, { vanWarehouseId, vanRouteId, issueDate }),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },
  });
}

export function useBatchGenerateDeliveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderIds: string[]) => deliveryService.generateForOrders(orderIds),
    onSuccess: (data: { documents: DeliveryDocument[] }) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      for (const doc of data.documents) {
        void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
        void queryClient.invalidateQueries({ queryKey: deliveryKeys.preview(doc.id) });
      }
    },
  });
}

/**
 * WZ documents linked to a van route (trip).
 * Used by VanRouteDashboardPage and VanReconciliationPage.
 */
export function useVanRouteWZListQuery(routeId: string | undefined) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({
      page: 1,
      companyId,
      document_type: 'WZ',
      van_route: routeId,
      page_size: 100,
    }),
    queryFn: () =>
      deliveryService.fetchList({
        page: 1,
        document_type: 'WZ',
        van_route: routeId,
        page_size: 100,
        include_items: true,
      }),
    enabled: Boolean(routeId) && Boolean(companyId),
    select: (data) => data.results,
    refetchInterval: 30_000,
  });
}

/** All documents (any type) tagged to a van route — for the route document trail. */
export function useVanRouteAllDocsQuery(routeId: string | undefined) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({
      page: 1,
      companyId,
      van_route: routeId,
      page_size: 200,
    }),
    queryFn: () =>
      deliveryService.fetchList({
        page: 1,
        van_route: routeId,
        page_size: 200,
      }),
    enabled: Boolean(routeId) && Boolean(companyId),
    select: (data) => data.results,
  });
}

/** @deprecated Prefer useVanRouteWZListQuery — warehouse+date pulls unrelated WZ. */
export function useVanWZListQuery(vanWarehouseId: string | undefined, date: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({
      page: 1,
      companyId,
      document_type: 'WZ',
      from_warehouse_id: vanWarehouseId,
      issue_date_after: date,
      issue_date_before: date,
      page_size: 100,
    }),
    queryFn: () =>
      deliveryService.fetchList({
        page: 1,
        document_type: 'WZ',
        from_warehouse_id: vanWarehouseId,
        issue_date_after: date,
        issue_date_before: date,
        page_size: 100,
        include_items: true,
      }),
    enabled: Boolean(vanWarehouseId) && Boolean(date) && Boolean(companyId),
    select: (data) => data.results,
    refetchInterval: 30_000,
  });
}

/** Create a draft PZ with items in one call. Invalidates delivery list. */
export function useCreatePzMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PzCreatePayload) => deliveryService.createPz(body),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
    },
  });
}

/** Complete a PZ (receipt goods into warehouse). Invalidates delivery + product stock. */
export function useCompletePzMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items?: PzCompleteItemRow[] }) =>
      deliveryService.completePz(id, items),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      // Stock changed — refresh product stock and warehouse stock cache
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
    },
  });
}

/** Cancel a PZ and reverse its stock impact. Invalidates delivery + product stock. */
/** Create a manual RW write-off document (immediately posted, stock deducted). */
export function useCreateRwMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RwCreatePayload) => deliveryService.createRw(body),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Fetch PZ documents not yet linked to any KSeF invoice, optionally filtered by supplier. */
export function useUnmatchedPzQuery(supplierId?: string | null, enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: deliveryKeys.list({ page: 1, companyId, document_type: 'PZ', ksef_unlinked: true, from_supplier: supplierId ?? undefined }),
    queryFn: () =>
      deliveryService.fetchList({
        document_type: 'PZ',
        ksef_unlinked: true,
        from_supplier: supplierId ?? undefined,
        page_size: 50,
      }),
    enabled: Boolean(companyId) && enabled,
    select: (data) => data.results,
  });
}

/** Link a KSeF invoice (by its UUID from ReceivedKSeFInvoice) to an existing PZ. */
export function useLinkInvoiceToPzMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pzId, ksefInvoiceId }: { pzId: string; ksefInvoiceId: string }) =>
      deliveryService.patchDocument(pzId, { ksef_invoice_id: ksefInvoiceId }),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: ['ksef'] });
    },
  });
}

export function useCreatePzKorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PzKorPayload }) =>
      deliveryService.createPzKor(id, data),
    onSuccess: (kor: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
      if (kor.corrects_pz_id) {
        void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(kor.corrects_pz_id) });
      }
    },
  });
}

export function useCreateWzKorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: WzKorPayload }) =>
      deliveryService.createWzKor(id, data),
    onSuccess: (kor: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
      if (kor.corrects_wz_id) {
        void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(kor.corrects_wz_id) });
      }
    },
  });
}

export function useCancelPzMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deliveryService.cancelPz(id),
    onSuccess: (doc: DeliveryDocument) => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: warehouseStockKeys.all });
      // Refresh KSeF inbox so PZ badges update
      void queryClient.invalidateQueries({ queryKey: ['ksef'] });
    },
  });
}

export function useVanLoadingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VanLoadingPayload) => deliveryService.vanLoading(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    },
  });
}

export function useVanReconciliationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      warehouseId,
      data,
      routeId,
    }: {
      warehouseId: string;
      data: VanReconciliationPayload;
      routeId?: string;
    }) => deliveryService.vanReconciliation(warehouseId, data, routeId),
    onSuccess: () => {
      // Invalidate delivery docs, product stock, and van routes after reconciliation
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.all });
      // Invalidate stock snapshot so Stan Van shows 0 immediately after reconciliation
      void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.all });
    },
  });
}

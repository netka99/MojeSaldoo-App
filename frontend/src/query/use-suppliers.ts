import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supplierService, type SupplierListParams } from '@/services/supplier.service';
import type { SupplierCreate, SupplierPatch } from '@/types';
import { supplierKeys } from './keys';

export type SupplierListFilters = Omit<SupplierListParams, 'page'>;

/** Paginated supplier list. */
export function useSupplierListQuery(page = 1, filters: SupplierListFilters = {}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: supplierKeys.list({ page, companyId, ...filters }),
    queryFn: () => supplierService.fetchList({ page, ...filters }),
    enabled: Boolean(companyId),
  });
}

/**
 * All active suppliers — intended for dropdown / select inputs.
 * Fetches up to 500 in a single request; result is stable while company doesn't change.
 */
export function useAllSuppliersQuery(enabled = true) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: supplierKeys.all_active(companyId),
    queryFn: () => supplierService.fetchAll(),
    enabled: Boolean(companyId) && enabled,
    select: (data) => data.results,
    staleTime: 5 * 60 * 1000, // 5 min — supplier list changes rarely
  });
}

/** Single supplier detail. */
export function useSupplierDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: supplierKeys.detail(id ?? ''),
    queryFn: () => supplierService.fetchById(id!),
    enabled: Boolean(id),
  });
}

/** Create a new supplier. Invalidates list cache on success. */
export function useCreateSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierCreate) => supplierService.createItem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplierKeys.lists() });
    },
  });
}

/** Full update (PUT) — replaces all writable fields. Invalidates list + detail. */
export function useUpdateSupplierMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierCreate) => supplierService.updateItem(id, body),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: supplierKeys.lists() });
      qc.setQueryData(supplierKeys.detail(updated.id), updated);
    },
  });
}

/** Partial update (PATCH). Invalidates list + detail. */
export function usePatchSupplierMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierPatch) => supplierService.patchItem(id, body),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: supplierKeys.lists() });
      qc.setQueryData(supplierKeys.detail(updated.id), updated);
    },
  });
}

/** Soft-delete (deactivate) a supplier by PATCHing `is_active: false`. */
export function useDeactivateSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => supplierService.patchItem(id, { is_active: false }),
    onSuccess: (_updated, id) => {
      qc.invalidateQueries({ queryKey: supplierKeys.lists() });
      qc.invalidateQueries({ queryKey: supplierKeys.detail(id) });
    },
  });
}

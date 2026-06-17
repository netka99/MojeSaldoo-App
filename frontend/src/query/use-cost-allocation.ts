import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCostProject,
  deleteCostProject,
  fetchCostProjects,
  fetchInvoiceAnnotation,
  saveInvoiceAnnotation,
  updateCostProject,
} from '@/services/cost-allocation.service';
import type { CostProjectWrite, InvoiceAnnotationWrite } from '@/types/cost-allocation.types';
import { useAuth } from '@/context/AuthContext';

// ---- Query keys -------------------------------------------------------------

export const costAllocationKeys = {
  all: ['cost-allocation'] as const,
  projects: (companyId: string) => [...costAllocationKeys.all, 'projects', companyId] as const,
  annotation: (ksefNumber: string) =>
    [...costAllocationKeys.all, 'annotation', ksefNumber] as const,
};

// ---- Projects ---------------------------------------------------------------

export function useCostProjectsQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: costAllocationKeys.projects(companyId),
    queryFn: fetchCostProjects,
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCostProjectMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CostProjectWrite) => createCostProject(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: costAllocationKeys.projects(companyId) });
    },
  });
}

export function useUpdateCostProjectMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CostProjectWrite> }) =>
      updateCostProject(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: costAllocationKeys.projects(companyId) });
    },
  });
}

export function useDeleteCostProjectMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCostProject(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: costAllocationKeys.projects(companyId) });
    },
  });
}

// ---- Invoice annotations ----------------------------------------------------

/** Only fires when `enabled` is true — pass `expanded && hasCostAllocation` from the inbox row. */
export function useInvoiceAnnotationQuery(ksefNumber: string, enabled: boolean) {
  return useQuery({
    queryKey: costAllocationKeys.annotation(ksefNumber),
    queryFn: () => fetchInvoiceAnnotation(ksefNumber),
    enabled: !!ksefNumber && enabled,
    staleTime: 60 * 1000,
  });
}

export function useSaveInvoiceAnnotationMutation(ksefNumber: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InvoiceAnnotationWrite) => saveInvoiceAnnotation(ksefNumber, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(costAllocationKeys.annotation(ksefNumber), updated);
      void queryClient.invalidateQueries({ queryKey: ['ksef', 'inbox'] });
    },
  });
}

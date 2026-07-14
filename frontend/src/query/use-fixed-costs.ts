import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFixedCost,
  deleteFixedCost,
  fetchFixedCosts,
  updateFixedCost,
} from '@/services/fixed-costs.service';
import type { FixedCostWrite } from '@/types/fixed-costs.types';
import { useAuth } from '@/context/AuthContext';

export const fixedCostsKeys = {
  all: ['fixed-costs'] as const,
  list: (companyId: string) => [...fixedCostsKeys.all, 'list', companyId] as const,
};

export function useFixedCostsQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: fixedCostsKeys.list(companyId),
    queryFn: fetchFixedCosts,
    enabled: !!companyId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateFixedCostMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FixedCostWrite) => createFixedCost(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fixedCostsKeys.list(companyId) });
    },
  });
}

export function useUpdateFixedCostMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FixedCostWrite> }) =>
      updateFixedCost(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fixedCostsKeys.list(companyId) });
    },
  });
}

export function useDeleteFixedCostMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteFixedCost(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fixedCostsKeys.list(companyId) });
    },
  });
}

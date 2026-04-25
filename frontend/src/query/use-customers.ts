import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { customerService } from '@/services/customer.service';
import type { CustomerWrite } from '@/types';
import { customerKeys } from './keys';

export function useCustomerListQuery(page: number, search: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: customerKeys.list({ page, search, companyId }),
    queryFn: () =>
      customerService.fetchList({
        page,
        search: search || undefined,
        ordering: '-created_at',
      }),
  });
}

export function useCustomerQuery(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? customerKeys.detail(id) : [...customerKeys.details(), 'pending'],
    queryFn: () => customerService.fetchById(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerWrite) => customerService.createItem(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useUpdateCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CustomerWrite }) => customerService.updateItem(id, body),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) });
    },
  });
}

export function usePatchCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CustomerWrite> }) =>
      customerService.partialUpdateItem(id, body),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) });
    },
  });
}

export function useDeleteCustomerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customerService.deleteItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { vanRouteService } from '@/services/van-route.service';
import type {
  VanRoute,
  VanRouteCreate,
  VanRoutePatch,
  VanRouteStartLoadingPayload,
} from '@/types';
import { vanRouteKeys, orderKeys, stockSnapshotKeys } from './keys';

export function useVanRouteListQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: vanRouteKeys.list(companyId),
    queryFn: () => vanRouteService.fetchList(),
    enabled: Boolean(companyId),
  });
}

export function useVanRouteQuery(id: string | undefined) {
  return useQuery({
    queryKey: id ? vanRouteKeys.detail(id) : [...vanRouteKeys.details(), 'pending'],
    queryFn: () => vanRouteService.fetchById(id!),
    enabled: Boolean(id),
  });
}

export function useCreateVanRouteMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: (body: VanRouteCreate) => vanRouteService.create(body),
    onSuccess: (route: VanRoute) => {
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
      queryClient.setQueryData(vanRouteKeys.detail(route.id), route);
    },
  });
}

export function usePatchVanRouteMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: VanRoutePatch }) =>
      vanRouteService.patch(id, data),
    onSuccess: (route: VanRoute) => {
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
      queryClient.setQueryData(vanRouteKeys.detail(route.id), route);
    },
  });
}

export function useDeleteVanRouteMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: (id: string) => vanRouteService.delete(id),
    onSuccess: (_void, id) => {
      void queryClient.removeQueries({ queryKey: vanRouteKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
    },
  });
}

export function useStartLoadingMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: VanRouteStartLoadingPayload }) =>
      vanRouteService.startLoading(id, payload),
    onSuccess: (route: VanRoute) => {
      queryClient.setQueryData(vanRouteKeys.detail(route.id), route);
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
      // Invalidate delivery docs so the new MM shows up
      void queryClient.invalidateQueries({ queryKey: ['delivery-documents'] });
      // Invalidate product stock so van stock shows up immediately in dashboard
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      // Invalidate stock snapshot so Stan Van updates immediately after MM is issued
      void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.all });
    },
  });
}

export function useConfirmLoadingMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: (id: string) => vanRouteService.confirmLoading(id),
    onSuccess: (route: VanRoute) => {
      queryClient.setQueryData(vanRouteKeys.detail(route.id), route);
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
    },
  });
}

export function useAddOrdersToRouteMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: ({ id, orderIds }: { id: string; orderIds: string[] }) =>
      vanRouteService.addOrders(id, orderIds),
    onSuccess: (route: VanRoute) => {
      queryClient.setQueryData(vanRouteKeys.detail(route.id), route);
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
    },
  });
}

export function useCloseVanRouteMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useMutation({
    mutationFn: (id: string) => vanRouteService.close(id),
    onSuccess: (route: VanRoute) => {
      queryClient.setQueryData(vanRouteKeys.detail(route.id), route);
      void queryClient.invalidateQueries({ queryKey: vanRouteKeys.list(companyId) });
      // Refresh orders so status changes are reflected
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      // Invalidate stock snapshot so Stan Van reflects post-close state
      void queryClient.invalidateQueries({ queryKey: stockSnapshotKeys.all });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companyService } from '@/services/company.service';
import { authStorage } from '@/services/api';
import type { CompanyWorkflowSettings, CompanyWrite, ModuleName } from '@/types';
import { companyKeys } from './keys';

export function useMyCompaniesQuery() {
  return useQuery({
    queryKey: companyKeys.me(),
    queryFn: () => companyService.getMyCompanies(),
    // Skip when there is no access token to avoid a 401 on every unauthenticated page load.
    enabled: Boolean(authStorage.getAccessToken()),
  });
}

export function useCompanyModulesQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: companyId
      ? companyKeys.modules(companyId)
      : ([...companyKeys.all, 'modules', 'pending'] as const),
    queryFn: () => companyService.getModules(companyId!),
    enabled: Boolean(companyId) && enabled,
  });
}

export function useCreateCompanyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CompanyWrite) => companyService.createCompany(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}

export function useSwitchCompanyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => companyService.switchCompany(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}

export function useToggleModuleMutation(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ module, enabled }: { module: ModuleName; enabled: boolean }) =>
      companyService.toggleModule(companyId, module, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.modules(companyId) });
    },
  });
}

export function useWorkflowSettingsQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: companyId ? companyKeys.workflowSettings(companyId) : ([...companyKeys.all, 'workflow-settings', 'pending'] as const),
    queryFn: () => companyService.getWorkflowSettings(companyId!),
    enabled: Boolean(companyId),
  });
}

export function useUpdateWorkflowSettingsMutation(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CompanyWorkflowSettings>) =>
      companyService.updateWorkflowSettings(companyId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.workflowSettings(companyId) });
    },
  });
}

export function useUpdateCompanyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: CompanyWrite }) =>
      companyService.updateCompany(companyId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}

export function useDeleteCompanyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, confirmName }: { companyId: string; confirmName: string }) =>
      companyService.deleteCompany(companyId, confirmName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}

export function useLeaveCompanyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => companyService.leaveCompany(companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
    },
  });
}

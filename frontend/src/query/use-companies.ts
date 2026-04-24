import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companyService } from '@/services/company.service';
import type { CompanyWrite, ModuleName } from '@/types';
import { companyKeys } from './keys';

export function useMyCompaniesQuery() {
  return useQuery({
    queryKey: companyKeys.me(),
    queryFn: () => companyService.getMyCompanies(),
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

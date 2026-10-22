import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { certificateService } from '@/services/certificate.service';
import { companyKeys } from './keys';

export function useKsefCertificateStatusQuery(companyId: string | undefined, environment: string, enabled = true) {
  return useQuery({
    queryKey: companyId ? companyKeys.ksefCertificateStatus(companyId, environment) : ['companies', 'ksef-certificate', 'pending'],
    queryFn: () => certificateService.getStatus(companyId!, environment),
    enabled: Boolean(companyId) && enabled,
  });
}

export function useKsefCertificateUploadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, formData, environment }: { companyId: string; formData: FormData; environment: string }) =>
      certificateService.upload(companyId, formData),
    onSuccess: (_, { companyId, environment }) => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.ksefCertificateStatus(companyId, environment) });
    },
  });
}

export function useKsefCertificateDeleteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, environment }: { companyId: string; environment: string }) =>
      certificateService.delete(companyId, environment),
    onSuccess: (_, { companyId, environment }) => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.ksefCertificateStatus(companyId, environment) });
    },
  });
}

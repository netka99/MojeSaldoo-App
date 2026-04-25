import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { certificateService } from '@/services/certificate.service';
import { companyKeys } from './keys';

export function useKsefCertificateStatusQuery(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: companyId ? companyKeys.ksefCertificateStatus(companyId) : ['companies', 'ksef-certificate', 'pending'],
    queryFn: () => certificateService.getStatus(companyId!),
    enabled: Boolean(companyId) && enabled,
  });
}

export function useKsefCertificateUploadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, formData }: { companyId: string; formData: FormData }) =>
      certificateService.upload(companyId, formData),
    onSuccess: (_, { companyId }) => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.ksefCertificateStatus(companyId) });
    },
  });
}

export function useKsefCertificateDeleteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => certificateService.delete(companyId),
    onSuccess: (_, companyId) => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.ksefCertificateStatus(companyId) });
    },
  });
}

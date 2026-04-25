import { api } from './api';

export type KsefCertificateStatus = {
  uploaded: boolean;
  valid: boolean;
  expired: boolean;
  not_yet_valid: boolean;
  is_active: boolean;
  subject_name: string | null;
  valid_from: string | null;
  valid_until: string | null;
  uploaded_at: string | null;
};

export type KsefCertificateMetadata = {
  id: string;
  subject_name: string;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  uploaded_at: string | null;
};

export const certificateService = {
  getStatus: (companyId: string) =>
    api.get<KsefCertificateStatus>(`/companies/${companyId}/certificate/status/`),

  upload: (companyId: string, formData: FormData) =>
    api.postForm<KsefCertificateMetadata>(`/companies/${companyId}/certificate/`, formData),

  delete: (companyId: string) =>
    api.delete<{ ok: boolean; deleted: boolean }>(`/companies/${companyId}/certificate/`),
};

import { api } from './api';

export type KsefCertificateStatus = {
  uploaded: boolean;
  valid: boolean;
  expired: boolean;
  not_yet_valid: boolean;
  is_active: boolean;
  subject_name: string | null;
  certificate_filename: string | null;
  key_filename: string | null;
  valid_from: string | null;
  valid_until: string | null;
  uploaded_at: string | null;
};

export type KsefCertificateMetadata = {
  id: string;
  subject_name: string;
  certificate_filename: string | null;
  key_filename: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  uploaded_at: string | null;
};

export const certificateService = {
  getStatus: (companyId: string, environment: string) =>
    api.get<KsefCertificateStatus>(`/companies/${companyId}/certificate/status/?environment=${environment}`),

  upload: (companyId: string, formData: FormData) =>
    api.postForm<KsefCertificateMetadata>(`/companies/${companyId}/certificate/`, formData),

  delete: (companyId: string, environment: string) =>
    api.delete<{ ok: boolean; deleted: boolean }>(`/companies/${companyId}/certificate/?environment=${environment}`),
};

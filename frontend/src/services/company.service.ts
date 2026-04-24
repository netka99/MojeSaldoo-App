import { api, type AuthUser } from './api';
import type { Company, CompanyModule, CompanyWrite, ModuleName } from '../types';

type CompanyModuleApi = {
  id: string;
  company: string;
  module: ModuleName;
  is_enabled: boolean;
  enabled_at: string | null;
};

function mapCompanyModule(row: CompanyModuleApi): CompanyModule {
  return {
    module: row.module,
    isEnabled: row.is_enabled,
    enabledAt: row.enabled_at,
  };
}

/**
 * DRF `CompanySerializer` (POST /api/companies/) — send snake_case to match the API.
 * Optional fields are omitted when undefined.
 */
function toCreateCompanyBody(data: CompanyWrite): Record<string, unknown> {
  const body: Record<string, unknown> = { name: data.name };
  if (data.nip !== undefined) body.nip = data.nip;
  if (data.address !== undefined) body.address = data.address;
  if (data.city !== undefined) body.city = data.city;
  if (data.postalCode !== undefined) body.postal_code = data.postalCode;
  if (data.phone !== undefined) body.phone = data.phone;
  if (data.email !== undefined) body.email = data.email;
  return body;
}

export const companyService = {
  getMyCompanies: () => api.get<Company[]>('/companies/me/'),

  createCompany: (data: CompanyWrite) =>
    api.post<Company>('/companies/', toCreateCompanyBody(data)),

  switchCompany: (companyId: string) =>
    api.post<{ user: AuthUser }>('/companies/switch/', { company: companyId }),

  getModules: async (companyId: string) => {
    const rows = await api.get<CompanyModuleApi[]>(`/companies/${companyId}/modules/`);
    return rows.map(mapCompanyModule);
  },

  toggleModule: async (companyId: string, module: ModuleName, enabled: boolean) => {
    const row = await api.patch<CompanyModuleApi>(`/companies/${companyId}/modules/${module}/`, {
      is_enabled: enabled,
    });
    return mapCompanyModule(row);
  },
};

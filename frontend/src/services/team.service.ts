import { api } from './api';
import type { CompanyRoleDefinition, TeamMember, UserPermissions } from '@/types';

export interface CreateRolePayload extends Partial<UserPermissions> {
  name: string;
}

export interface AddMemberPayload {
  username: string;
  email?: string;
  first_name: string;
  last_name?: string;
  password: string;
  company_role_id: string;
}

export const teamService = {
  // --- Roles ---

  getRoles(companyId: string): Promise<CompanyRoleDefinition[]> {
    return api.get<CompanyRoleDefinition[]>(`/companies/${companyId}/roles/`);
  },

  createRole(companyId: string, data: CreateRolePayload): Promise<CompanyRoleDefinition> {
    return api.post<CompanyRoleDefinition>(`/companies/${companyId}/roles/`, data);
  },

  updateRole(
    companyId: string,
    roleId: string,
    data: Partial<CreateRolePayload>,
  ): Promise<CompanyRoleDefinition> {
    return api.patch<CompanyRoleDefinition>(`/companies/${companyId}/roles/${roleId}/`, data);
  },

  deleteRole(companyId: string, roleId: string): Promise<void> {
    return api.delete(`/companies/${companyId}/roles/${roleId}/`);
  },

  // --- Members ---

  getMembers(companyId: string): Promise<TeamMember[]> {
    return api.get<TeamMember[]>(`/companies/${companyId}/members/`);
  },

  addMember(companyId: string, data: AddMemberPayload): Promise<TeamMember> {
    return api.post<TeamMember>(`/companies/${companyId}/members/`, data);
  },

  updateMember(
    companyId: string,
    membershipId: string,
    data: { company_role_id?: string; is_active?: boolean; first_name?: string; last_name?: string; email?: string | null; password?: string },
  ): Promise<TeamMember> {
    return api.patch<TeamMember>(`/companies/${companyId}/members/${membershipId}/`, data);
  },

  removeMember(companyId: string, membershipId: string): Promise<void> {
    return api.delete(`/companies/${companyId}/members/${membershipId}/`);
  },
};

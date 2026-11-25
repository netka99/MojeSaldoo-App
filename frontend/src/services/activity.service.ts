import { api, apiClient } from './api';
import type { ActivityLogResponse, ActivityStatus, AuditLogResponse, AuditLogListParams, AuditLogListResponse } from '@/types/activity.types';

export interface ActivityLogParams {
  status?: ActivityStatus;
  page?: number;
  page_size?: number;
}

function buildAuditListQuery(params: AuditLogListParams): string {
  const query = new URLSearchParams();
  if (params.object_type) query.set('object_type', params.object_type);
  if (params.date_from) query.set('date_from', params.date_from);
  if (params.date_to) query.set('date_to', params.date_to);
  if (params.page) query.set('page', String(params.page));
  return query.toString();
}

export const activityService = {
  getLogs(params: ActivityLogParams = {}): Promise<ActivityLogResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', String(params.page));
    if (params.page_size) query.set('page_size', String(params.page_size));
    const qs = query.toString();
    return api.get<ActivityLogResponse>(`/activity/${qs ? `?${qs}` : ''}`);
  },

  getAuditLog(objectType: string, objectId: string): Promise<AuditLogResponse> {
    return api.get<AuditLogResponse>(
      `/activity/audit/?object_type=${encodeURIComponent(objectType)}&object_id=${encodeURIComponent(objectId)}`,
    );
  },

  getAuditLogList(params: AuditLogListParams = {}): Promise<AuditLogListResponse> {
    const qs = buildAuditListQuery(params);
    return api.get<AuditLogListResponse>(`/activity/audit/${qs ? `?${qs}` : ''}`);
  },

  async exportAuditLogCsv(params: AuditLogListParams = {}): Promise<Blob> {
    const qs = buildAuditListQuery(params);
    const response = await apiClient.get(`/activity/audit/export/${qs ? `?${qs}` : ''}`, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },
};

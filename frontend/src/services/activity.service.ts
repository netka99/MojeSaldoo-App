import { api } from './api';
import type { ActivityLogResponse, ActivityStatus } from '@/types/activity.types';

export interface ActivityLogParams {
  status?: ActivityStatus;
  page?: number;
  page_size?: number;
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
};

import { useQuery } from '@tanstack/react-query';
import { activityService, type ActivityLogParams } from '@/services/activity.service';

export const activityKeys = {
  all: ['activity'] as const,
  list: (params: ActivityLogParams) => [...activityKeys.all, params] as const,
};

export function useActivityLogQuery(params: ActivityLogParams = {}) {
  return useQuery({
    queryKey: activityKeys.list(params),
    queryFn: () => activityService.getLogs(params),
  });
}

import { useQuery } from '@tanstack/react-query';
import { activityService, type ActivityLogParams } from '@/services/activity.service';
import type { AuditLogListParams } from '@/types/activity.types';

export const activityKeys = {
  all: ['activity'] as const,
  list: (params: ActivityLogParams) => [...activityKeys.all, params] as const,
  audit: (objectType: string, objectId: string) => ['audit', objectType, objectId] as const,
  auditList: (params: AuditLogListParams) => ['auditList', params] as const,
};

export function useActivityLogQuery(params: ActivityLogParams = {}) {
  return useQuery({
    queryKey: activityKeys.list(params),
    queryFn: () => activityService.getLogs(params),
  });
}

export function useAuditLogQuery(objectType: string, objectId: string | undefined) {
  return useQuery({
    queryKey: activityKeys.audit(objectType, objectId ?? ''),
    queryFn: () => activityService.getAuditLog(objectType, objectId!),
    enabled: Boolean(objectId),
    staleTime: 30_000,
  });
}

export function useAuditLogListQuery(params: AuditLogListParams = {}) {
  return useQuery({
    queryKey: activityKeys.auditList(params),
    queryFn: () => activityService.getAuditLogList(params),
    staleTime: 0,
  });
}

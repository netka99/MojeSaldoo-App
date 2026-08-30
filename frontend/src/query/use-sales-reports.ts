import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { salesReportsService } from '@/services/sales-reports.service';
import type { DailySalesReportWrite, SalesReportTemplateWrite } from '@/types/sales-reports.types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const salesReportKeys = {
  all: ['sales-reports'] as const,
  reports: (companyId: string) => [...salesReportKeys.all, 'reports', companyId] as const,
  report: (companyId: string, id: number) => [...salesReportKeys.all, 'report', companyId, id] as const,
  yesterday: (companyId: string) => [...salesReportKeys.all, 'yesterday', companyId] as const,
  templates: (companyId: string) => [...salesReportKeys.all, 'templates', companyId] as const,
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function useSalesReportsQuery(params?: { date_from?: string; date_to?: string; status?: string; page?: number }) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: [...salesReportKeys.reports(companyId), JSON.stringify(params ?? {})],
    queryFn: () => salesReportsService.listReports(params),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

export function useSalesReportQuery(id: number) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: salesReportKeys.report(companyId, id),
    queryFn: () => salesReportsService.getReport(id),
    enabled: Boolean(companyId) && Boolean(id),
    staleTime: 30_000,
  });
}

export function useYesterdayReportQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: salesReportKeys.yesterday(companyId),
    queryFn: () => salesReportsService.getYesterday(),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}

export function useCreateSalesReportMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DailySalesReportWrite) => salesReportsService.createReport(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.reports(companyId) });
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.yesterday(companyId) });
      // Also refresh cash-flow dashboard since b2c_revenue includes RK
      void queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
    },
  });
}

export function useUpdateSalesReportMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DailySalesReportWrite> }) =>
      salesReportsService.updateReport(id, data),
    onSuccess: (_, { id }) => {
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.reports(companyId) });
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.report(companyId, id) });
      void queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
    },
  });
}

export function useDeleteSalesReportMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => salesReportsService.deleteReport(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.reports(companyId) });
      void queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function useSalesTemplatesQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: salesReportKeys.templates(companyId),
    queryFn: () => salesReportsService.listTemplates(),
    enabled: Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateSalesTemplateMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SalesReportTemplateWrite) => salesReportsService.createTemplate(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.templates(companyId) });
    },
  });
}

export function useUpdateSalesTemplateMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SalesReportTemplateWrite> }) =>
      salesReportsService.updateTemplate(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.templates(companyId) });
    },
  });
}

export function useDeleteSalesTemplateMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => salesReportsService.deleteTemplate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: salesReportKeys.templates(companyId) });
    },
  });
}

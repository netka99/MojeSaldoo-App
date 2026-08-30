import { api } from './api';
import type {
  DailySalesReport,
  DailySalesReportWrite,
  PaginatedSalesReports,
  SalesReportTemplate,
  SalesReportTemplateWrite,
} from '@/types/sales-reports.types';

const BASE = '/sales';

export const salesReportsService = {
  // Reports
  listReports: (params?: { date_from?: string; date_to?: string; status?: string; page?: number }) =>
    api.get<PaginatedSalesReports>(`${BASE}/reports/`, { params }),

  getReport: (id: number) =>
    api.get<DailySalesReport>(`${BASE}/reports/${id}/`),

  createReport: (data: DailySalesReportWrite) =>
    api.post<DailySalesReport>(`${BASE}/reports/`, data),

  updateReport: (id: number, data: Partial<DailySalesReportWrite>) =>
    api.patch<DailySalesReport>(`${BASE}/reports/${id}/`, data),

  deleteReport: (id: number) =>
    api.delete(`${BASE}/reports/${id}/`),

  getYesterday: () =>
    api.get<DailySalesReport | null>(`${BASE}/reports/yesterday/`),

  // Templates
  listTemplates: () =>
    api.get<SalesReportTemplate[]>(`${BASE}/templates/`),

  createTemplate: (data: SalesReportTemplateWrite) =>
    api.post<SalesReportTemplate>(`${BASE}/templates/`, data),

  updateTemplate: (id: number, data: Partial<SalesReportTemplateWrite>) =>
    api.patch<SalesReportTemplate>(`${BASE}/templates/${id}/`, data),

  deleteTemplate: (id: number) =>
    api.delete(`${BASE}/templates/${id}/`),
};

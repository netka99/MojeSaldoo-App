import { api } from './api';
import type {
  CashFlowDashboard,
  CashFlowHistoryMonth,
  CashFlowPeriodSummary,
  CompanyTaxConfig,
  CompanyTaxConfigWrite,
  DailyB2CRevenue,
  DailyB2CRevenueWrite,
  ExpenseChartPeriod,
  HarmonogramData,
  OpexCategory,
  QuickExpense,
  QuickExpenseWrite,
} from '@/types/cashflow.types';

const BASE = '/cash-flow';

export const cashFlowService = {
  fetchDashboard: (month?: string) =>
    api.get<CashFlowDashboard>(`${BASE}/dashboard/`, {
      params: month ? { month } : undefined,
    }),

  fetchTaxConfig: () => api.get<CompanyTaxConfig>(`${BASE}/tax-config/`),

  updateTaxConfig: (data: CompanyTaxConfigWrite) =>
    api.patch<CompanyTaxConfig>(`${BASE}/tax-config/`, data),

  listQuickExpenses: (params?: { date_from?: string; date_to?: string }) =>
    api.get<QuickExpense[]>(`${BASE}/quick-expenses/`, { params }),

  createQuickExpense: (data: QuickExpenseWrite) =>
    api.post<QuickExpense>(`${BASE}/quick-expenses/`, data),

  updateQuickExpense: (id: string, data: Partial<QuickExpenseWrite>) =>
    api.patch<QuickExpense>(`${BASE}/quick-expenses/${id}/`, data),

  deleteQuickExpense: (id: string) => api.delete(`${BASE}/quick-expenses/${id}/`),

  listB2CRevenue: (params?: { date_from?: string; date_to?: string }) =>
    api.get<DailyB2CRevenue[]>(`${BASE}/b2c-revenue/`, { params }),

  createB2CRevenue: (data: DailyB2CRevenueWrite) =>
    api.post<DailyB2CRevenue>(`${BASE}/b2c-revenue/`, data),

  deleteB2CRevenue: (id: string) => api.delete(`${BASE}/b2c-revenue/${id}/`),

  listOpexCategories: (all?: boolean) =>
    api.get<OpexCategory[]>(`${BASE}/opex-categories/`, { params: all ? { all: 'true' } : undefined }),

  createOpexCategory: (data: { name: string; slug?: string }) =>
    api.post<OpexCategory>(`${BASE}/opex-categories/`, data),

  updateOpexCategory: (id: string, data: { name?: string; is_active?: boolean; sort_order?: number }) =>
    api.patch<OpexCategory>(`${BASE}/opex-categories/${id}/`, data),

  deleteOpexCategory: (id: string) =>
    api.delete(`${BASE}/opex-categories/${id}/`),

  fetchExpenseChart: (params: { months?: number; date_from?: string; date_to?: string }) =>
    api.get<ExpenseChartPeriod[]>(`${BASE}/expense-chart/`, { params }),

  fetchPeriodSummary: (params: { date_from: string; date_to: string }) =>
    api.get<CashFlowPeriodSummary>(`${BASE}/period-summary/`, { params }),

  fetchHistory: () =>
    api.get<CashFlowHistoryMonth[]>(`${BASE}/history/`),

  fetchHarmonogram: (month?: string) =>
    api.get<HarmonogramData>(`${BASE}/harmonogram/`, {
      params: month ? { month } : undefined,
    }),
};

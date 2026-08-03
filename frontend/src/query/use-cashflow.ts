import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { cashFlowService } from '@/services/cashflow.service';
import type { CompanyTaxConfigWrite, DailyB2CRevenueWrite, QuickExpenseWrite } from '@/types/cashflow.types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const cashFlowKeys = {
  all: ['cash-flow'] as const,
  dashboard: (companyId: string, month?: string) =>
    [...cashFlowKeys.all, 'dashboard', companyId, month ?? 'current'] as const,
  taxConfig: (companyId: string) =>
    [...cashFlowKeys.all, 'tax-config', companyId] as const,
  quickExpenses: (companyId: string) =>
    [...cashFlowKeys.all, 'quick-expenses', companyId] as const,
  b2cRevenue: (companyId: string) =>
    [...cashFlowKeys.all, 'b2c-revenue', companyId] as const,
  opexCategories: (companyId: string) =>
    [...cashFlowKeys.all, 'opex-categories', companyId] as const,
  expenseChart: (companyId: string, params: string) =>
    [...cashFlowKeys.all, 'expense-chart', companyId, params] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCashFlowDashboardQuery(month?: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: cashFlowKeys.dashboard(companyId, month),
    queryFn: () => cashFlowService.fetchDashboard(month),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

export function useTaxConfigQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: cashFlowKeys.taxConfig(companyId),
    queryFn: () => cashFlowService.fetchTaxConfig(),
    enabled: Boolean(companyId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateTaxConfigMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CompanyTaxConfigWrite) => cashFlowService.updateTaxConfig(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.taxConfig(companyId) });
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.all });
    },
  });
}

export function useCreateQuickExpenseMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: QuickExpenseWrite) => cashFlowService.createQuickExpense(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.dashboard(companyId) });
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.quickExpenses(companyId) });
    },
  });
}

export function useUpdateQuickExpenseMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<QuickExpenseWrite> }) =>
      cashFlowService.updateQuickExpense(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.dashboard(companyId) });
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.quickExpenses(companyId) });
    },
  });
}

export function useDeleteQuickExpenseMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cashFlowService.deleteQuickExpense(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.dashboard(companyId) });
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.quickExpenses(companyId) });
    },
  });
}

export function useQuickExpensesQuery(month?: string) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  const dateFrom = month ? `${month}-01` : undefined;
  const dateTo = month
    ? (() => {
        const [y, m] = month.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        return `${month}-${String(lastDay).padStart(2, '0')}`;
      })()
    : undefined;

  return useQuery({
    queryKey: [...cashFlowKeys.quickExpenses(companyId), month ?? 'all'],
    queryFn: () =>
      cashFlowService.listQuickExpenses(
        dateFrom ? { date_from: dateFrom, date_to: dateTo } : undefined,
      ),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

export function useCreateB2CRevenueMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DailyB2CRevenueWrite) => cashFlowService.createB2CRevenue(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.dashboard(companyId) });
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.b2cRevenue(companyId) });
    },
  });
}

export function useOpexCategoriesQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: cashFlowKeys.opexCategories(companyId),
    queryFn: () => cashFlowService.listOpexCategories(),
    enabled: Boolean(companyId),
    staleTime: 10 * 60 * 1000,
  });
}

/** Includes hidden (is_active=false) categories — for the manager UI only. */
export function useAllOpexCategoriesQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  return useQuery({
    queryKey: [...cashFlowKeys.opexCategories(companyId), 'all'],
    queryFn: () => cashFlowService.listOpexCategories(true),
    enabled: Boolean(companyId),
    staleTime: 0, // always fresh in manager
  });
}

export function useCreateOpexCategoryMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug?: string }) =>
      cashFlowService.createOpexCategory(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: cashFlowKeys.opexCategories(companyId),
      });
    },
  });
}

export function useUpdateOpexCategoryMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; is_active?: boolean; sort_order?: number } }) =>
      cashFlowService.updateOpexCategory(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.opexCategories(companyId) });
    },
  });
}

export function useDeleteOpexCategoryMutation() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cashFlowService.deleteOpexCategory(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cashFlowKeys.opexCategories(companyId) });
    },
  });
}

export function useExpenseChartQuery(params: { months?: number; date_from?: string; date_to?: string }) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const paramsKey = JSON.stringify(params);
  return useQuery({
    queryKey: cashFlowKeys.expenseChart(companyId, paramsKey),
    queryFn: () => cashFlowService.fetchExpenseChart(params),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}

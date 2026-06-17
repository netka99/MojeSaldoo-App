import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { productionService } from '@/services/production.service';
import type { ProductionOrderCreate, RecipeCreate } from '@/types/production.types';

// ── Cache keys ────────────────────────────────────────────────────────────────

const recipeKeys = {
  all: ['production', 'recipes'] as const,
  lists: () => [...recipeKeys.all, 'list'] as const,
  list: (companyId: string) => [...recipeKeys.lists(), companyId] as const,
  detail: (id: string) => [...recipeKeys.all, 'detail', id] as const,
};

const orderKeys = {
  all: ['production', 'orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (companyId: string, page: number) => [...orderKeys.lists(), companyId, page] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
};

// ── Recipe queries ────────────────────────────────────────────────────────────

export function useRecipesQuery() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: recipeKeys.list(companyId),
    queryFn: () => productionService.fetchRecipes(),
    enabled: Boolean(companyId),
  });
}

export function useRecipeQuery(id: string | undefined) {
  return useQuery({
    queryKey: recipeKeys.detail(id ?? ''),
    queryFn: () => productionService.fetchRecipeById(id!),
    enabled: Boolean(id),
  });
}

export function useCreateRecipeMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useMutation({
    mutationFn: (data: RecipeCreate) => productionService.createRecipe(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.list(companyId) });
    },
  });
}

export function useUpdateRecipeMutation(id: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useMutation({
    mutationFn: (data: Partial<RecipeCreate>) => productionService.updateRecipe(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.list(companyId) });
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(id) });
    },
  });
}

export function useDeleteRecipeMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useMutation({
    mutationFn: (id: string) => productionService.deleteRecipe(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.list(companyId) });
    },
  });
}

// ── Production Order queries ──────────────────────────────────────────────────

export function useProductionOrdersQuery(page = 1) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return useQuery({
    queryKey: orderKeys.list(companyId, page),
    queryFn: () => productionService.fetchOrders({ page }),
    enabled: Boolean(companyId),
  });
}

export function useProductionOrderQuery(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => productionService.fetchOrderById(id!),
    enabled: Boolean(id),
  });
}

export function useCreateProductionOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProductionOrderCreate) => productionService.createOrder(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    },
  });
}

export function useCompleteProductionOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => productionService.completeOrder(id),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: orderKeys.detail(data.id) });
      // Invalidate product list so avg_cost refreshes
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProductionOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => productionService.deleteOrder(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    },
  });
}

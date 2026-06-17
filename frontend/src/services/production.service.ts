import { api } from './api';
import type {
  PaginatedProductionOrders,
  ProductionOrder,
  ProductionOrderCreate,
  Recipe,
  RecipeCreate,
} from '../types/production.types';

const recipesPath = '/production/recipes/';
const ordersPath = '/production/orders/';

export const productionService = {
  // ── Recipes ──────────────────────────────────────────────────────────────
  fetchRecipes: () => api.get<Recipe[]>(recipesPath),

  fetchRecipeById: (id: string) => api.get<Recipe>(`${recipesPath}${id}/`),

  createRecipe: (data: RecipeCreate) => api.post<Recipe>(recipesPath, data),

  updateRecipe: (id: string, data: Partial<RecipeCreate>) =>
    api.put<Recipe>(`${recipesPath}${id}/`, data),

  deleteRecipe: (id: string) => api.delete<Record<string, never>>(`${recipesPath}${id}/`),

  // ── Production Orders ─────────────────────────────────────────────────────
  fetchOrders: (params?: { page?: number }) =>
    api.get<PaginatedProductionOrders>(ordersPath, { params }),

  fetchOrderById: (id: string) => api.get<ProductionOrder>(`${ordersPath}${id}/`),

  createOrder: (data: ProductionOrderCreate) => api.post<ProductionOrder>(ordersPath, data),

  deleteOrder: (id: string) => api.delete<Record<string, never>>(`${ordersPath}${id}/`),

  /** Finalize a draft order: consume FIFO stock, create RW+PW, update avg_cost. */
  completeOrder: (id: string) =>
    api.post<ProductionOrder>(`${ordersPath}${id}/complete/`, {}),
};

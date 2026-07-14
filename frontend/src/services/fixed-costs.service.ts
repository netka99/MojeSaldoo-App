import { api } from './api';
import type { FixedCost, FixedCostWrite } from '@/types/fixed-costs.types';

export async function fetchFixedCosts(): Promise<FixedCost[]> {
  return api.get<FixedCost[]>('/fixed-costs/');
}

export async function createFixedCost(data: FixedCostWrite): Promise<FixedCost> {
  return api.post<FixedCost>('/fixed-costs/', data);
}

export async function updateFixedCost(id: string, data: Partial<FixedCostWrite>): Promise<FixedCost> {
  return api.patch<FixedCost>(`/fixed-costs/${id}/`, data);
}

export async function deleteFixedCost(id: string): Promise<void> {
  await api.delete(`/fixed-costs/${id}/`);
}

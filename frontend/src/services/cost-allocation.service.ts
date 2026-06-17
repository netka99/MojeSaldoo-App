import { api } from './api';
import type {
  CostProject,
  CostProjectWrite,
  InvoiceAnnotation,
  InvoiceAnnotationWrite,
} from '@/types/cost-allocation.types';

// ---- Projects ---------------------------------------------------------------

export async function fetchCostProjects(): Promise<CostProject[]> {
  const data = await api.get<Record<string, unknown>[]>('/cost-allocation/projects/');
  return data.map(mapProject);
}

export async function createCostProject(data: CostProjectWrite): Promise<CostProject> {
  const raw = await api.post<Record<string, unknown>>('/cost-allocation/projects/', data);
  return mapProject(raw);
}

export async function updateCostProject(id: string, data: Partial<CostProjectWrite>): Promise<CostProject> {
  const raw = await api.patch<Record<string, unknown>>(`/cost-allocation/projects/${id}/`, data);
  return mapProject(raw);
}

export async function deleteCostProject(id: string): Promise<void> {
  await api.delete(`/cost-allocation/projects/${id}/`);
}

function mapProject(raw: Record<string, unknown>): CostProject {
  return {
    id: raw.id as string,
    name: raw.name as string,
    code: (raw.code as string) ?? '',
    color: (raw.color as string) ?? '',
    isActive: raw.is_active as boolean,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  };
}

// ---- Invoice annotations ----------------------------------------------------

/**
 * Fetch invoice annotation (including per-line annotations).
 * Returns null if no annotation exists yet (backend returns {}).
 */
export async function fetchInvoiceAnnotation(ksefNumber: string): Promise<InvoiceAnnotation | null> {
  const raw = await api.get<Record<string, unknown>>(
    `/cost-allocation/invoices/${encodeURIComponent(ksefNumber)}/annotation/`,
  );
  if (!raw || !raw.id) return null;
  return raw as unknown as InvoiceAnnotation;
}

/** Upsert invoice annotation (and optionally line annotations). */
export async function saveInvoiceAnnotation(
  ksefNumber: string,
  body: InvoiceAnnotationWrite,
): Promise<InvoiceAnnotation> {
  return api.patch<InvoiceAnnotation>(
    `/cost-allocation/invoices/${encodeURIComponent(ksefNumber)}/annotation/`,
    body,
  );
}

// ---- Export -----------------------------------------------------------------

/** Build the export URL with optional date range filters and format. */
export function buildExportUrl(dateFrom?: string, dateTo?: string, fmt: 'xlsx' | 'csv' = 'xlsx'): string {
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  params.set('fmt', fmt);
  return `/api/cost-allocation/export/?${params.toString()}`;
}

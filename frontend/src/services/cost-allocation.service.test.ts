import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchCostProjects,
  createCostProject,
  updateCostProject,
  deleteCostProject,
  fetchInvoiceAnnotation,
  saveInvoiceAnnotation,
  buildExportUrl,
} from './cost-allocation.service';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const rawProject = {
  id: 'uuid-1',
  name: 'Projekt A',
  code: 'PA',
  color: '#3B82F6',
  is_active: true,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const mappedProject = {
  id: 'uuid-1',
  name: 'Projekt A',
  code: 'PA',
  color: '#3B82F6',
  isActive: true,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('fetchCostProjects', () => {
  it('maps snake_case fields to camelCase', async () => {
    mockApi.get.mockResolvedValue({ data: [rawProject] });
    const result = await fetchCostProjects();
    expect(result).toEqual([mappedProject]);
    expect(mockApi.get).toHaveBeenCalledWith('/cost-allocation/projects/');
  });
});

describe('createCostProject', () => {
  it('posts and maps result', async () => {
    mockApi.post.mockResolvedValue({ data: rawProject });
    const result = await createCostProject({ name: 'Projekt A', code: 'PA' });
    expect(result).toEqual(mappedProject);
    expect(mockApi.post).toHaveBeenCalledWith('/cost-allocation/projects/', {
      name: 'Projekt A',
      code: 'PA',
    });
  });
});

describe('updateCostProject', () => {
  it('patches and maps result', async () => {
    mockApi.patch.mockResolvedValue({ data: rawProject });
    const result = await updateCostProject('uuid-1', { name: 'Updated' });
    expect(result).toEqual(mappedProject);
    expect(mockApi.patch).toHaveBeenCalledWith('/cost-allocation/projects/uuid-1/', { name: 'Updated' });
  });
});

describe('deleteCostProject', () => {
  it('calls delete endpoint', async () => {
    mockApi.delete.mockResolvedValue({});
    await deleteCostProject('uuid-1');
    expect(mockApi.delete).toHaveBeenCalledWith('/cost-allocation/projects/uuid-1/');
  });
});

describe('fetchInvoiceAnnotation', () => {
  it('returns null when backend returns empty object', async () => {
    mockApi.get.mockResolvedValue({ data: {} });
    const result = await fetchInvoiceAnnotation('KSEF-001');
    expect(result).toBeNull();
  });

  it('returns annotation when it exists', async () => {
    const ann = { id: 'ann-1', accounting_status: 'pending', accounting_notes: '', exported_at: null, updated_at: '', line_annotations: {} };
    mockApi.get.mockResolvedValue({ data: ann });
    const result = await fetchInvoiceAnnotation('KSEF-001');
    expect(result).toEqual(ann);
  });

  it('encodes ksef number in URL', async () => {
    mockApi.get.mockResolvedValue({ data: {} });
    await fetchInvoiceAnnotation('KSEF/2026/001');
    expect(mockApi.get).toHaveBeenCalledWith(
      '/cost-allocation/invoices/KSEF%2F2026%2F001/annotation/',
    );
  });
});

describe('saveInvoiceAnnotation', () => {
  it('patches and returns annotation', async () => {
    const ann = { id: 'ann-1', accounting_status: 'annotated', accounting_notes: 'note', exported_at: null, updated_at: '', line_annotations: {} };
    mockApi.patch.mockResolvedValue({ data: ann });
    const result = await saveInvoiceAnnotation('KSEF-001', { accountingStatus: 'annotated' });
    expect(result).toEqual(ann);
  });
});

describe('buildExportUrl', () => {
  it('builds URL without dates', () => {
    expect(buildExportUrl()).toBe('/api/cost-allocation/export/');
  });

  it('builds URL with both dates', () => {
    const url = buildExportUrl('2026-01-01', '2026-06-30');
    expect(url).toContain('date_from=2026-01-01');
    expect(url).toContain('date_to=2026-06-30');
  });

  it('builds URL with only date_from', () => {
    expect(buildExportUrl('2026-01-01')).toContain('date_from=2026-01-01');
  });
});

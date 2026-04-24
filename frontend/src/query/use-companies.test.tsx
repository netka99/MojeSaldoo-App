/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { companyKeys } from './keys';
import {
  useCompanyModulesQuery,
  useCreateCompanyMutation,
  useMyCompaniesQuery,
  useSwitchCompanyMutation,
  useToggleModuleMutation,
  useUpdateCompanyMutation,
} from './use-companies';

const companyServiceMock = vi.hoisted(() => ({
  getMyCompanies: vi.fn(),
  getModules: vi.fn(),
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  switchCompany: vi.fn(),
  toggleModule: vi.fn(),
}));

vi.mock('@/services/company.service', () => ({
  companyService: companyServiceMock,
}));

describe('use-companies hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useMyCompaniesQuery loads data and uses companyKeys.me', async () => {
    const data = [{ id: 'c1', name: 'A' }];
    companyServiceMock.getMyCompanies.mockResolvedValue(data);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useMyCompaniesQuery(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(companyServiceMock.getMyCompanies).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(companyKeys.me())).toEqual(data);
  });

  it('useCompanyModulesQuery is disabled without companyId', () => {
    const { result } = renderHook(() => useCompanyModulesQuery(undefined), {
      wrapper: ({ children }) => <TestQueryProvider>{children}</TestQueryProvider>,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
    expect(companyServiceMock.getModules).not.toHaveBeenCalled();
  });

  it('useCompanyModulesQuery fetches when companyId is set', async () => {
    const rows = [{ module: 'products' as const, isEnabled: true, enabledAt: null }];
    companyServiceMock.getModules.mockResolvedValue(rows);

    const { result } = renderHook(() => useCompanyModulesQuery('cid-1'), {
      wrapper: ({ children }) => <TestQueryProvider>{children}</TestQueryProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(companyServiceMock.getModules).toHaveBeenCalledWith('cid-1');
  });

  it('useCreateCompanyMutation calls service and invalidates company tree', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const created = { id: 'new', name: 'B' };
    companyServiceMock.createCompany.mockResolvedValue(created);

    const { result } = renderHook(() => useCreateCompanyMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({ name: 'B' });

    expect(companyServiceMock.createCompany).toHaveBeenCalledWith({ name: 'B' });
    expect(spy).toHaveBeenCalledWith({ queryKey: companyKeys.all });
  });

  it('useSwitchCompanyMutation calls service and invalidates company tree', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const id = '550e8400-e29b-41d4-a716-446655440000';
    companyServiceMock.switchCompany.mockResolvedValue({ user: { id: 1, username: 'u', email: '', first_name: '', last_name: '', is_active: true } });

    const { result } = renderHook(() => useSwitchCompanyMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync(id);

    expect(companyServiceMock.switchCompany).toHaveBeenCalledWith(id);
    expect(spy).toHaveBeenCalledWith({ queryKey: companyKeys.all });
  });

  it('useToggleModuleMutation calls service and invalidates modules for company', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const companyId = 'c9';
    companyServiceMock.toggleModule.mockResolvedValue({
      module: 'ksef',
      isEnabled: true,
      enabledAt: '2024-01-01T00:00:00Z',
    });

    const { result } = renderHook(() => useToggleModuleMutation(companyId), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({ module: 'ksef', enabled: true });

    expect(companyServiceMock.toggleModule).toHaveBeenCalledWith(companyId, 'ksef', true);
    expect(spy).toHaveBeenCalledWith({ queryKey: companyKeys.modules(companyId) });
  });

  it('useUpdateCompanyMutation calls service and invalidates company tree', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    companyServiceMock.updateCompany.mockResolvedValue({ id: 'c1', name: 'X' });

    const { result } = renderHook(() => useUpdateCompanyMutation(), {
      wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>,
    });

    await result.current.mutateAsync({
      companyId: 'c1',
      data: { name: 'X', city: 'W' },
    });

    expect(companyServiceMock.updateCompany).toHaveBeenCalledWith('c1', { name: 'X', city: 'W' });
    expect(spy).toHaveBeenCalledWith({ queryKey: companyKeys.all });
  });
});

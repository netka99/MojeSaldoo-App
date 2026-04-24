/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { useModuleGuard } from './useModuleGuard';

const companyServiceMock = vi.hoisted(() => ({
  getMyCompanies: vi.fn(),
  getModules: vi.fn(),
  createCompany: vi.fn(),
  switchCompany: vi.fn(),
  toggleModule: vi.fn(),
}));

const baseUser = {
  id: 1,
  username: 'u',
  email: 'u@t.dev',
  first_name: 'U',
  last_name: 'T',
  is_active: true,
};

const authState = vi.hoisted(() => ({
  user: null as (typeof baseUser & { current_company?: string | null }) | null,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: Boolean(authState.user),
  }),
}));

vi.mock('@/services/company.service', () => ({
  companyService: companyServiceMock,
}));

function wrapperFor(client = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestQueryProvider client={client}>{children}</TestQueryProvider>;
  };
}

describe('useModuleGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = null;
  });

  it('returns false when the user is not signed in', () => {
    authState.user = null;

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    expect(result.current).toBe(false);
    expect(companyServiceMock.getModules).not.toHaveBeenCalled();
  });

  it('returns false when there is no current company on the user', () => {
    authState.user = { ...baseUser, current_company: null };

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    expect(result.current).toBe(false);
    expect(companyServiceMock.getModules).not.toHaveBeenCalled();
  });

  it('returns false while modules are not loaded', () => {
    authState.user = { ...baseUser, current_company: 'c-1' };
    companyServiceMock.getModules.mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    expect(result.current).toBe(false);
  });

  it('returns true when the module row is enabled', async () => {
    const companyId = '550e8400-e29b-41d4-a716-446655440000';
    authState.user = { ...baseUser, current_company: companyId };
    companyServiceMock.getModules.mockResolvedValue([
      { module: 'products', isEnabled: true, enabledAt: '2024-01-01T00:00:00Z' },
      { module: 'orders', isEnabled: false, enabledAt: null },
    ]);

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    await waitFor(() => expect(result.current).toBe(true));
    expect(companyServiceMock.getModules).toHaveBeenCalledWith(companyId);
  });

  it('returns false when the module row is disabled', async () => {
    authState.user = { ...baseUser, current_company: 'c-1' };
    companyServiceMock.getModules.mockResolvedValue([
      { module: 'products', isEnabled: false, enabledAt: null },
    ]);

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('returns false when the module is missing from the list', async () => {
    authState.user = { ...baseUser, current_company: 'c-1' };
    companyServiceMock.getModules.mockResolvedValue([
      { module: 'orders', isEnabled: true, enabledAt: '2024-01-01T00:00:00Z' },
    ]);

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('returns false when the API returns an empty module list', async () => {
    authState.user = { ...baseUser, current_company: 'c-1' };
    companyServiceMock.getModules.mockResolvedValue([]);

    const { result } = renderHook(() => useModuleGuard('products'), {
      wrapper: wrapperFor(),
    });

    await waitFor(() => expect(companyServiceMock.getModules).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});

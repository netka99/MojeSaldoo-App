/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { ModuleRouteGate } from './ModuleRoute';

const useAuthMock = vi.hoisted(() => vi.fn());
const useCompanyModulesQueryMock = vi.hoisted(() => vi.fn());
const useModuleGuardMock = vi.hoisted(() => vi.fn());

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/query/use-companies', () => ({
  useCompanyModulesQuery: (companyId: string | undefined) =>
    useCompanyModulesQueryMock(companyId),
}));

vi.mock('@/hooks/useModuleGuard', () => ({
  useModuleGuard: (module: string) => useModuleGuardMock(module),
}));

/** Same structure as `App.tsx`: `/reports` → `ModuleRouteGate module="reporting"` → page. */
function renderReportsRoute() {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route
            path="/reports"
            element={
              <ModuleRouteGate module="reporting">
                <div data-testid="reports-page-content">Raporty</div>
              </ModuleRouteGate>
            }
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('ModuleRouteGate reporting (/reports)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      user: { current_company: '550e8400-e29b-41d4-a716-446655440000' },
    });
    useCompanyModulesQueryMock.mockReturnValue({ isPending: false, data: [] });
    useModuleGuardMock.mockReturnValue(true);
  });

  it('passes module="reporting" to the guard and renders children when allowed', () => {
    renderReportsRoute();
    expect(useModuleGuardMock).toHaveBeenCalledWith('reporting');
    expect(screen.getByTestId('reports-page-content')).toHaveTextContent('Raporty');
  });

  it('shows not-enabled UI when reporting is off', () => {
    useModuleGuardMock.mockReturnValue(false);
    renderReportsRoute();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Module not enabled')).toBeInTheDocument();
    expect(screen.queryByTestId('reports-page-content')).not.toBeInTheDocument();
  });

  it('shows loading state while company modules query is pending', () => {
    useCompanyModulesQueryMock.mockReturnValue({ isPending: true, data: undefined });
    renderReportsRoute();
    expect(screen.getByText('Loading company modules…')).toBeInTheDocument();
  });

  it('blocks content when current_company is missing', () => {
    useAuthMock.mockReturnValue({ user: { current_company: null } });
    renderReportsRoute();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('reports-page-content')).not.toBeInTheDocument();
  });
});

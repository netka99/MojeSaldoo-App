import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CostProjectsPage } from './CostProjectsPage';
import * as costAllocationQuery from '@/query/use-cost-allocation';
import type { CostProject } from '@/types/cost-allocation.types';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { current_company: 'company-1' } }),
}));

vi.mock('@/services/api', () => ({
  authStorage: { getAccessToken: () => 'token' },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockProject: CostProject = {
  id: 'proj-1',
  name: 'Projekt Alpha',
  code: 'PA',
  color: '#3B82F6',
  isActive: true,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('CostProjectsPage', () => {
  it('shows loading state', () => {
    vi.spyOn(costAllocationQuery, 'useCostProjectsQuery').mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useCostProjectsQuery>);

    render(<CostProjectsPage />, { wrapper });
    expect(screen.getByText('Ładowanie…')).toBeTruthy();
  });

  it('shows empty state when no projects', () => {
    vi.spyOn(costAllocationQuery, 'useCostProjectsQuery').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useCostProjectsQuery>);

    render(<CostProjectsPage />, { wrapper });
    expect(screen.getByText(/Brak projektów/)).toBeTruthy();
  });

  it('renders project list', () => {
    vi.spyOn(costAllocationQuery, 'useCostProjectsQuery').mockReturnValue({
      data: [mockProject],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useCostProjectsQuery>);

    render(<CostProjectsPage />, { wrapper });
    expect(screen.getByText('Projekt Alpha')).toBeTruthy();
    expect(screen.getByText('PA')).toBeTruthy();
  });

  it('shows new project form when button clicked', () => {
    vi.spyOn(costAllocationQuery, 'useCostProjectsQuery').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useCostProjectsQuery>);

    render(<CostProjectsPage />, { wrapper });
    fireEvent.click(screen.getByText('+ Nowy projekt'));
    expect(screen.getByText('Nowy projekt')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Projekt budowlany/)).toBeTruthy();
  });

  it('shows validation error when form submitted empty', async () => {
    vi.spyOn(costAllocationQuery, 'useCostProjectsQuery').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useCostProjectsQuery>);
    vi.spyOn(costAllocationQuery, 'useCreateCostProjectMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useCreateCostProjectMutation>);
    vi.spyOn(costAllocationQuery, 'useUpdateCostProjectMutation').mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof costAllocationQuery.useUpdateCostProjectMutation>);

    render(<CostProjectsPage />, { wrapper });
    fireEvent.click(screen.getByText('+ Nowy projekt'));
    fireEvent.click(screen.getByText('Dodaj projekt'));

    await waitFor(() => {
      expect(screen.getByText('Nazwa projektu jest wymagana.')).toBeTruthy();
    });
  });

  it('shows error state', () => {
    vi.spyOn(costAllocationQuery, 'useCostProjectsQuery').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof costAllocationQuery.useCostProjectsQuery>);

    render(<CostProjectsPage />, { wrapper });
    expect(screen.getByText('Błąd pobierania projektów.')).toBeTruthy();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { DemoBanner } from './DemoBanner';

// Mock useAuth
const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({
  useAuth: mockUseAuth,
}));

// Mock company hooks
const mockUseMyCompaniesQuery = vi.hoisted(() => vi.fn());
const mockUseDeleteDemoCompanyMutation = vi.hoisted(() => vi.fn());
const mockUseSwitchCompanyMutation = vi.hoisted(() => vi.fn());

vi.mock('@/query/use-companies', () => ({
  useMyCompaniesQuery: mockUseMyCompaniesQuery,
  useDeleteDemoCompanyMutation: mockUseDeleteDemoCompanyMutation,
  useSwitchCompanyMutation: mockUseSwitchCompanyMutation,
}));

const realCompany = { id: 'real-1', name: 'Moja Firma', is_demo: false };
const demoCompany = { id: 'demo-1', name: 'MojeSaldoo Demo', is_demo: true };

function setup(currentId: string, companiesList = [realCompany, demoCompany]) {
  const refreshUser = vi.fn().mockResolvedValue(undefined);
  const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
  const switchMutateAsync = vi.fn().mockResolvedValue(undefined);

  mockUseAuth.mockReturnValue({
    user: { current_company: currentId },
    refreshUser,
    isLoading: false,
  });
  mockUseMyCompaniesQuery.mockReturnValue({ data: companiesList });
  mockUseDeleteDemoCompanyMutation.mockReturnValue({
    mutateAsync: deleteMutateAsync,
    isPending: false,
  });
  mockUseSwitchCompanyMutation.mockReturnValue({
    mutateAsync: switchMutateAsync,
    isPending: false,
  });

  return { refreshUser, deleteMutateAsync, switchMutateAsync };
}

function renderBanner() {
  return render(
    <TestQueryProvider>
      <DemoBanner />
    </TestQueryProvider>,
  );
}

describe('DemoBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders banner when active company is demo', () => {
    setup(demoCompany.id);
    renderBanner();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Przeglądasz przykładowe dane/)).toBeInTheDocument();
  });

  it('does not render when active company is not demo', () => {
    setup(realCompany.id);
    renderBanner();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows switch button when real company exists', () => {
    setup(demoCompany.id);
    renderBanner();
    expect(screen.getByText(/Przełącz na swoją firmę/)).toBeInTheDocument();
  });

  it('calls deleteDemoCompany + switchCompany + refreshUser on delete click', async () => {
    const { deleteMutateAsync, switchMutateAsync, refreshUser } = setup(demoCompany.id);
    renderBanner();

    fireEvent.click(screen.getByText('Usuń dane demo'));

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledTimes(1);
      expect(switchMutateAsync).toHaveBeenCalledWith(realCompany.id);
      expect(refreshUser).toHaveBeenCalledTimes(1);
    });
  });

  it('calls switchCompany + refreshUser on switch click', async () => {
    const { switchMutateAsync, refreshUser } = setup(demoCompany.id);
    renderBanner();

    fireEvent.click(screen.getByText(/Przełącz na swoją firmę/));

    await waitFor(() => {
      expect(switchMutateAsync).toHaveBeenCalledWith(realCompany.id);
      expect(refreshUser).toHaveBeenCalledTimes(1);
    });
  });
});

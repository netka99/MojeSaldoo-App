/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanySettingsPage } from './CompanySettingsPage';

const refreshUser = vi.fn();
const toggleMutateAsync = vi.fn().mockResolvedValue({});

const authState = vi.hoisted(() => ({
  user: {
    id: 1,
    current_company: '550e8400-e29b-41d4-a716-446655440000' as string | null,
    current_company_role: 'admin' as 'admin' | 'manager' | 'driver' | 'viewer' | null,
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    refreshUser,
  }),
}));

vi.mock('@/query/use-companies', () => ({
  useMyCompaniesQuery: () => ({
    data: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'ACME Sp. z o.o.',
        nip: '5260250274',
        address: 'ul. Przykładowa 1',
        city: 'Kraków',
        postal_code: '30-001',
        email: 'biuro@acme.test',
        phone: '+48111222333',
      },
    ],
    isPending: false,
  }),
  useCompanyModulesQuery: () => ({
    data: [
      { module: 'products' as const, isEnabled: true, enabledAt: '2020-01-15T10:00:00.000Z' },
      { module: 'warehouses' as const, isEnabled: false, enabledAt: null },
    ],
    isPending: false,
    isError: false,
  }),
  useToggleModuleMutation: () => ({
    mutateAsync: toggleMutateAsync,
    isPending: false,
  }),
}));

describe('CompanySettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: 1,
      current_company: '550e8400-e29b-41d4-a716-446655440000',
      current_company_role: 'admin',
    };
  });

  it('shows company data and module cards', async () => {
    render(<CompanySettingsPage />);

    expect(await screen.findByRole('heading', { name: 'Ustawienia firmy' })).toBeInTheDocument();
    expect(screen.getByText('ACME Sp. z o.o.')).toBeInTheDocument();
    expect(screen.getByText('5260250274')).toBeInTheDocument();
    const roleGroup = screen.getByText('Twoja rola').parentElement;
    expect(roleGroup).toBeTruthy();
    expect(within(roleGroup as HTMLElement).getByText('admin', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Produkty i magazyn')).toBeInTheDocument();
    expect(screen.getByText('Moduł aktywny')).toBeInTheDocument();
  });

  it('toggles a module for admin and refreshes the user', async () => {
    const user = userEvent.setup();
    render(<CompanySettingsPage />);

    const warehousesCard = screen.getByText('Magazyny').closest('li');
    expect(warehousesCard).toBeTruthy();
    const whSwitch = within(warehousesCard!).getByRole('switch');
    await user.click(whSwitch);

    await waitFor(() => {
      expect(toggleMutateAsync).toHaveBeenCalledWith({ module: 'warehouses', enabled: true });
    });
    expect(refreshUser).toHaveBeenCalled();
  });

  it('disables module switches for non-admin roles', () => {
    authState.user.current_company_role = 'viewer';
    render(<CompanySettingsPage />);

    const switches = screen.getAllByRole('switch');
    for (const sw of switches) {
      expect(sw).toBeDisabled();
    }
    expect(
      screen.getByText(
        /Tylko administrator może zmieniać moduły/,
      ),
    ).toBeInTheDocument();
  });

  it('asks to refresh when no current company is set', () => {
    authState.user.current_company = null;
    render(<CompanySettingsPage />);

    expect(screen.getByText(/Nie wybrano aktywnej firmy/)).toBeInTheDocument();
  });
});

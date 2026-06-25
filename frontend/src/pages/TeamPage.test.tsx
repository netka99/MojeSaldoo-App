/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { TeamPage } from './TeamPage';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440000';

// ---------------------------------------------------------------------------
// vi.hoisted state — must not reference module-level consts
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({
  user: {
    id: 1,
    username: 'admin',
    email: 'admin@co.pl',
    first_name: 'Anna',
    last_name: 'Admin',
    is_active: true,
    current_company: '550e8400-e29b-41d4-a716-446655440000' as string | null,
    is_company_admin: true as boolean,
    permissions: {
      can_manage_team: true, can_manage_settings: true, can_see_prices: true,
      can_manage_products: true, can_manage_customers: true, can_manage_orders: true,
      can_manage_delivery: true, can_access_routes: true, can_manage_invoices: true,
      can_manage_purchasing: true, can_manage_production: true, can_view_reports: true,
    },
  },
}));

const mutationMocks = vi.hoisted(() => ({
  createRoleMutateAsync: vi.fn().mockResolvedValue({ id: 'new-role-id', name: 'Magazynier', is_admin: false, member_count: 0, created_at: '', permissions: {} }),
  updateRoleMutateAsync: vi.fn().mockResolvedValue({}),
  deleteRoleMutateAsync: vi.fn().mockResolvedValue(undefined),
  addMemberMutateAsync: vi.fn().mockResolvedValue({}),
  updateMemberMutateAsync: vi.fn().mockResolvedValue({}),
  removeMemberMutateAsync: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('@/hooks/useResolvedCompanyId', () => ({
  useResolvedCompanyId: () => ({
    state: 'ready',
    companyId: '550e8400-e29b-41d4-a716-446655440000',
    company: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'TestCo' },
    isUnsynced: false,
  }),
}));

vi.mock('@/query/use-companies', () => ({
  useMyCompaniesQuery: () => ({ data: [], isPending: false }),
}));

vi.mock('@/query/use-team', () => ({
  useRolesQuery: () => ({
    data: [
      {
        id: 'role-admin-id', name: 'Administrator', is_admin: true, member_count: 1,
        created_at: '2024-01-01T00:00:00Z',
        permissions: {
          can_manage_team: true, can_manage_settings: true, can_see_prices: true,
          can_manage_products: true, can_manage_customers: true, can_manage_orders: true,
          can_manage_delivery: true, can_access_routes: true, can_manage_invoices: true,
          can_manage_purchasing: true, can_manage_production: true, can_view_reports: true,
        },
        can_manage_team: true, can_manage_settings: true, can_see_prices: true,
        can_manage_products: true, can_manage_customers: true, can_manage_orders: true,
        can_manage_delivery: true, can_access_routes: true, can_manage_invoices: true,
        can_manage_purchasing: true, can_manage_production: true, can_view_reports: true,
      },
      {
        id: 'role-driver-id', name: 'Kierowca', is_admin: false, member_count: 1,
        created_at: '2024-01-02T00:00:00Z',
        permissions: {
          can_manage_team: false, can_manage_settings: false, can_see_prices: false,
          can_manage_products: false, can_manage_customers: false, can_manage_orders: false,
          can_manage_delivery: true, can_access_routes: true, can_manage_invoices: false,
          can_manage_purchasing: false, can_manage_production: false, can_view_reports: false,
        },
        can_manage_team: false, can_manage_settings: false, can_see_prices: false,
        can_manage_products: false, can_manage_customers: false, can_manage_orders: false,
        can_manage_delivery: true, can_access_routes: true, can_manage_invoices: false,
        can_manage_purchasing: false, can_manage_production: false, can_view_reports: false,
      },
    ],
    isPending: false,
    isError: false,
  }),
  useCreateRoleMutation: () => ({ mutateAsync: mutationMocks.createRoleMutateAsync, isPending: false }),
  useUpdateRoleMutation: () => ({ mutateAsync: mutationMocks.updateRoleMutateAsync, isPending: false }),
  useDeleteRoleMutation: () => ({ mutateAsync: mutationMocks.deleteRoleMutateAsync, isPending: false }),
  useMembersQuery: () => ({
    data: [
      {
        id: 'mem-admin-id',
        user: { id: 1, username: 'admin', email: 'admin@co.pl', first_name: 'Anna', last_name: 'Admin', is_active: true },
        company_role: {
          id: 'role-admin-id', name: 'Administrator', is_admin: true,
          permissions: { can_manage_team: true, can_manage_settings: true, can_see_prices: true, can_manage_products: true, can_manage_customers: true, can_manage_orders: true, can_manage_delivery: true, can_access_routes: true, can_manage_invoices: true, can_manage_purchasing: true, can_manage_production: true, can_view_reports: true },
          member_count: 1, created_at: '',
          can_manage_team: true, can_manage_settings: true, can_see_prices: true, can_manage_products: true, can_manage_customers: true, can_manage_orders: true, can_manage_delivery: true, can_access_routes: true, can_manage_invoices: true, can_manage_purchasing: true, can_manage_production: true, can_view_reports: true,
        },
        role: 'admin', is_active: true, joined_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'mem-driver-id',
        user: { id: 2, username: 'jan.k', email: 'jan@co.pl', first_name: 'Jan', last_name: 'Kowalski', is_active: true },
        company_role: {
          id: 'role-driver-id', name: 'Kierowca', is_admin: false,
          permissions: { can_manage_team: false, can_manage_settings: false, can_see_prices: false, can_manage_products: false, can_manage_customers: false, can_manage_orders: false, can_manage_delivery: true, can_access_routes: true, can_manage_invoices: false, can_manage_purchasing: false, can_manage_production: false, can_view_reports: false },
          member_count: 1, created_at: '',
          can_manage_team: false, can_manage_settings: false, can_see_prices: false, can_manage_products: false, can_manage_customers: false, can_manage_orders: false, can_manage_delivery: true, can_access_routes: true, can_manage_invoices: false, can_manage_purchasing: false, can_manage_production: false, can_view_reports: false,
        },
        role: 'viewer', is_active: true, joined_at: '2024-01-03T00:00:00Z',
      },
    ],
    isPending: false,
    isError: false,
  }),
  useAddMemberMutation: () => ({ mutateAsync: mutationMocks.addMemberMutateAsync, isPending: false }),
  useUpdateMemberMutation: () => ({ mutateAsync: mutationMocks.updateMemberMutateAsync, isPending: false }),
  useRemoveMemberMutation: () => ({ mutateAsync: mutationMocks.removeMemberMutateAsync, isPending: false }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <TeamPage />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: 1,
      username: 'admin',
      email: 'admin@co.pl',
      first_name: 'Anna',
      last_name: 'Admin',
      is_active: true,
      current_company: COMPANY_ID,
      is_company_admin: true,
      permissions: {
        can_manage_team: true, can_manage_settings: true, can_see_prices: true,
        can_manage_products: true, can_manage_customers: true, can_manage_orders: true,
        can_manage_delivery: true, can_access_routes: true, can_manage_invoices: true,
        can_manage_purchasing: true, can_manage_production: true, can_view_reports: true,
      },
    };
  });

  it('renders heading and tabs', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Zespół/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pracownicy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Role$/i })).toBeInTheDocument();
  });

  it('shows access-denied message for non-admin users', () => {
    authState.user = { ...authState.user, is_company_admin: false };
    renderPage();
    expect(screen.getByText(/Tylko administrator firmy/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pracownicy/i })).not.toBeInTheDocument();
  });

  it('shows member list on the members tab (default)', async () => {
    renderPage();
    expect(await screen.findByText('Jan Kowalski')).toBeInTheDocument();
    expect(screen.getByText(/jan@co\.pl/)).toBeInTheDocument();
  });

  it('marks self with "Ty" badge', async () => {
    renderPage();
    expect(await screen.findByText('Ty')).toBeInTheDocument();
  });

  it('switches to roles tab and shows roles', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Role$/i }));
    expect(await screen.findByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Kierowca')).toBeInTheDocument();
  });

  it('creates a new role when form is submitted', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Role$/i }));
    await user.click(screen.getByRole('button', { name: /\+ Nowa rola/i }));
    await user.type(screen.getByLabelText(/Nazwa roli/i), 'Magazynier');
    await user.click(screen.getByRole('button', { name: /^Utwórz$/i }));
    await waitFor(() =>
      expect(mutationMocks.createRoleMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Magazynier' }),
      ),
    );
  });

  it('shows add-member form when "Dodaj pracownika" is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /\+ Dodaj pracownika/i }));
    expect(screen.getByLabelText(/Imię/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Login/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Hasło tymczasowe/i)).toBeInTheDocument();
  });

  it('calls addMember mutation on form submission', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /\+ Dodaj pracownika/i }));
    await user.type(screen.getByLabelText(/Imię/i), 'Piotr');
    await user.type(screen.getByLabelText(/Nazwisko/i), 'Nowak');
    await user.type(screen.getByLabelText(/Login/i), 'piotr.nowak');
    await user.type(screen.getByLabelText(/E-mail/i), 'piotr@co.pl');
    await user.type(screen.getByLabelText(/Hasło tymczasowe/i), 'haslo12345');
    await user.click(screen.getByRole('button', { name: /^Dodaj pracownika$/i }));
    await waitFor(() =>
      expect(mutationMocks.addMemberMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'piotr.nowak',
          email: 'piotr@co.pl',
          first_name: 'Piotr',
          last_name: 'Nowak',
        }),
      ),
    );
  });

  it('omits email from payload when left blank', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /\+ Dodaj pracownika/i }));
    await user.type(screen.getByLabelText(/Imię/i), 'Ewa');
    await user.type(screen.getByLabelText(/Nazwisko/i), 'Wolna');
    await user.type(screen.getByLabelText(/Login/i), 'ewa.wolna');
    // intentionally skip email
    await user.type(screen.getByLabelText(/Hasło tymczasowe/i), 'haslo12345');
    await user.click(screen.getByRole('button', { name: /^Dodaj pracownika$/i }));
    await waitFor(() =>
      expect(mutationMocks.addMemberMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'ewa.wolna',
          first_name: 'Ewa',
          last_name: 'Wolna',
          email: undefined,
        }),
      ),
    );
  });

  it('opens edit panel for a member and calls updateMember with changed fields', async () => {
    const user = userEvent.setup();
    renderPage();
    // Jan Kowalski is not self, so should have an Edytuj button
    const memberRow = (await screen.findByText('Jan Kowalski')).closest('li')!;
    await user.click(within(memberRow).getByRole('button', { name: /Edytuj/i }));

    // Panel appears — clear first_name and type new value
    const firstNameInput = within(memberRow).getByLabelText(/Imię/i);
    await user.clear(firstNameInput);
    await user.type(firstNameInput, 'Janusz');

    await user.click(within(memberRow).getByRole('button', { name: /^Zapisz$/i }));
    await waitFor(() =>
      expect(mutationMocks.updateMemberMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipId: 'mem-driver-id',
          data: expect.objectContaining({ first_name: 'Janusz' }),
        }),
      ),
    );
  });
});

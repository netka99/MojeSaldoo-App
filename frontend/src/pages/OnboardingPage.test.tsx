/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { buildEnabledModules, OnboardingPage } from './OnboardingPage';
import { authStorage } from '@/services/api';

const VALID_NIP = '5260250274';
const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440000';

const companyMocks = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  switchMutateAsync: vi.fn(),
  toggleMutateAsync: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  refreshUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/query/use-companies', () => ({
  useCreateCompanyMutation: () => ({
    mutateAsync: companyMocks.createMutateAsync,
    isPending: false,
  }),
  useMyCompaniesQuery: () => ({
    data: [] as { id: string; name: string }[],
    isPending: false,
    isSuccess: true,
    isError: false,
  }),
  useSwitchCompanyMutation: () => ({
    mutateAsync: companyMocks.switchMutateAsync,
    isPending: false,
  }),
  useToggleModuleMutation: () => ({
    mutateAsync: companyMocks.toggleMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1 },
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: authMocks.refreshUser,
  }),
}));

function renderOnboarding(initialPath = '/onboarding') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
        <Route path="/login" element={<div data-testid="login-page">Logowanie</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('buildEnabledModules', () => {
  it('returns base modules when all optional flags are off', () => {
    expect(
      buildEnabledModules({
        orders: false,
        delivery: false,
        invoicing: false,
        ksef: false,
        reporting: false,
      }),
    ).toEqual(['products', 'warehouses', 'customers']);
  });

  it('appends orders and dependent modules in dependency order', () => {
    expect(
      buildEnabledModules({
        orders: true,
        delivery: true,
        invoicing: true,
        ksef: true,
        reporting: true,
      }),
    ).toEqual([
      'products',
      'warehouses',
      'customers',
      'orders',
      'delivery',
      'invoicing',
      'ksef',
      'reporting',
    ]);
  });

  it('includes reporting without orders', () => {
    expect(
      buildEnabledModules({
        orders: false,
        delivery: false,
        invoicing: false,
        ksef: false,
        reporting: true,
      }),
    ).toEqual(['products', 'warehouses', 'customers', 'reporting']);
  });

  it('omits delivery when orders on but delivery off', () => {
    expect(
      buildEnabledModules({
        orders: true,
        delivery: false,
        invoicing: true,
        ksef: false,
        reporting: false,
      }),
    ).toEqual(['products', 'warehouses', 'customers', 'orders', 'invoicing']);
  });
});

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStorage.setTokens('access-test', 'refresh-test');
    companyMocks.createMutateAsync.mockResolvedValue({ id: COMPANY_ID, name: 'ACME' });
    companyMocks.switchMutateAsync.mockResolvedValue({ user: { id: 1, username: 'u' } });
    companyMocks.toggleMutateAsync.mockResolvedValue({
      module: 'products' as const,
      isEnabled: true,
      enabledAt: null,
    });
  });

  afterEach(() => {
    authStorage.clear();
  });

  it('redirects to login when there is no access token', async () => {
    authStorage.clear();
    renderOnboarding();
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
  });

  it('shows step 1 and required field validation', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    expect(screen.getByRole('heading', { name: 'Utwórz firmę' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(await screen.findByText('Nazwa firmy jest wymagana')).toBeInTheDocument();
    expect(await screen.findByText('NIP jest wymagany')).toBeInTheDocument();
    expect(await screen.findByText('Miasto jest wymagane')).toBeInTheDocument();
  });

  it('submits step 1, calls create + switch + refreshUser, then shows module step', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.type(screen.getByLabelText('Nazwa firmy'), 'Firma Sp. z o.o.');
    await user.type(screen.getByLabelText('NIP'), VALID_NIP);
    await user.type(screen.getByLabelText('Miasto'), 'Kraków');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => {
      expect(companyMocks.createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Firma Sp. z o.o.',
          nip: VALID_NIP,
          city: 'Kraków',
        }) as Record<string, unknown>,
      );
    });
    expect(companyMocks.switchMutateAsync).toHaveBeenCalledWith(COMPANY_ID);
    expect(authMocks.refreshUser).toHaveBeenCalled();

    expect(await screen.findByRole('heading', { name: 'Włącz moduły' })).toBeInTheDocument();
  });

  it('shows step 1 error when create fails', async () => {
    const user = userEvent.setup();
    companyMocks.createMutateAsync.mockRejectedValueOnce(new Error('NIP already taken'));
    renderOnboarding();

    await user.type(screen.getByLabelText('Nazwa firmy'), 'X');
    await user.type(screen.getByLabelText('NIP'), VALID_NIP);
    await user.type(screen.getByLabelText('Miasto'), 'Y');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('NIP already taken');
    expect(companyMocks.switchMutateAsync).not.toHaveBeenCalled();
  });

  it('step 2: toggles only base modules, then step 3 and navigate home', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.type(screen.getByLabelText('Nazwa firmy'), 'ACME');
    await user.type(screen.getByLabelText('NIP'), VALID_NIP);
    await user.type(screen.getByLabelText('Miasto'), 'Warszawa');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await screen.findByRole('heading', { name: 'Włącz moduły' });
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await waitFor(() => {
      expect(companyMocks.toggleMutateAsync).toHaveBeenCalledTimes(3);
    });
    expect(companyMocks.toggleMutateAsync).toHaveBeenCalledWith({ module: 'products', enabled: true });
    expect(companyMocks.toggleMutateAsync).toHaveBeenCalledWith({ module: 'warehouses', enabled: true });
    expect(companyMocks.toggleMutateAsync).toHaveBeenCalledWith({ module: 'customers', enabled: true });

    expect(await screen.findByRole('heading', { name: 'Gotowe!' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Przejdź do aplikacji' }));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
  });

  it('step 2: enables optional chain and patches extra modules', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.type(screen.getByLabelText('Nazwa firmy'), 'ACME');
    await user.type(screen.getByLabelText('NIP'), VALID_NIP);
    await user.type(screen.getByLabelText('Miasto'), 'Warszawa');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    await screen.findByRole('heading', { name: 'Włącz moduły' });
    const orders = screen.getByRole('checkbox', { name: /Zamówienia/ });
    await user.click(orders);
    const delivery = screen.getByRole('checkbox', { name: /Dostawa/ });
    await user.click(delivery);
    const invoicing = screen.getByRole('checkbox', { name: /Fakturowanie/ });
    await user.click(invoicing);
    const ksef = screen.getByRole('checkbox', { name: /KSeF/ });
    await user.click(ksef);
    const reporting = screen.getByRole('checkbox', { name: /Raporty/ });
    await user.click(reporting);

    companyMocks.toggleMutateAsync.mockClear();
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    const expected = buildEnabledModules({
      orders: true,
      delivery: true,
      invoicing: true,
      ksef: true,
      reporting: true,
    });
    await waitFor(() => {
      expect(companyMocks.toggleMutateAsync).toHaveBeenCalledTimes(expected.length);
    });
    for (const mod of expected) {
      expect(companyMocks.toggleMutateAsync).toHaveBeenCalledWith({ module: mod, enabled: true });
    }
  });

  it('step 2: Wstecz returns to company form with prior values still visible (step back)', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.type(screen.getByLabelText('Nazwa firmy'), 'ACME S.A.');
    await user.type(screen.getByLabelText('NIP'), VALID_NIP);
    await user.type(screen.getByLabelText('Miasto'), 'Gdańsk');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    await screen.findByRole('heading', { name: 'Włącz moduły' });
    await user.click(screen.getByRole('button', { name: 'Wstecz' }));

    expect(await screen.findByRole('heading', { name: 'Utwórz firmę' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nazwa firmy')).toHaveValue('ACME S.A.');
  });

  it('step 2: shows error when a module toggle fails', async () => {
    const user = userEvent.setup();
    companyMocks.toggleMutateAsync.mockRejectedValueOnce(new Error('forbidden modules'));
    renderOnboarding();

    await user.type(screen.getByLabelText('Nazwa firmy'), 'ACME');
    await user.type(screen.getByLabelText('NIP'), VALID_NIP);
    await user.type(screen.getByLabelText('Miasto'), 'Warszawa');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    await screen.findByRole('heading', { name: 'Włącz moduły' });
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('forbidden modules');
    expect(screen.getByRole('heading', { name: 'Włącz moduły' })).toBeInTheDocument();
  });
});

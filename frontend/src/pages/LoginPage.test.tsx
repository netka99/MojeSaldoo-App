/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '@/context/AuthContext';
import { companyService } from '@/services/company.service';
import { authApi, authStorage, type AuthUser } from '@/services/api';
import { TestQueryProvider } from '@/test/TestQueryProvider';

vi.mock('@/services/company.service', () => ({
  companyService: {
    getMyCompanies: vi.fn(),
  },
}));

const sampleUser: AuthUser = {
  id: 3,
  username: 'carol',
  email: 'carol@test.dev',
  first_name: 'Carol',
  last_name: 'Login',
  is_active: true,
};

describe('LoginPage', () => {
  beforeEach(() => {
    vi.spyOn(authApi, 'me').mockReset();
    vi.spyOn(authApi, 'login').mockReset();
    vi.mocked(companyService.getMyCompanies).mockReset();
    vi.mocked(companyService.getMyCompanies).mockResolvedValue([{ id: 'c-1', name: 'ACME' } as never]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderLogin(initialPath = '/login') {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <TestQueryProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<div data-testid="dashboard">Dashboard</div>} />
              <Route path="/onboarding" element={<div data-testid="onboarding">Onboarding</div>} />
              <Route path="/customers" element={<div data-testid="customers">Customers</div>} />
            </Routes>
          </AuthProvider>
        </TestQueryProvider>
      </MemoryRouter>,
    );
  }

  it('submits username and password through auth context', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      access: 'new-a',
      refresh: 'new-r',
      user: sampleUser,
    });

    renderLogin();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/username/i), 'carol');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(authApi.login).toHaveBeenCalledWith('carol', 'secret-pass'));
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });

  it('redirects to state.from after login when provided', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      access: 'new-a',
      refresh: 'new-r',
      user: sampleUser,
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/customers' } }]}>
        <TestQueryProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/customers" element={<div data-testid="customers">Customers</div>} />
            </Routes>
          </AuthProvider>
        </TestQueryProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/username/i), 'carol');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByTestId('customers')).toBeInTheDocument());
  });

  it('redirects to /onboarding after login when user has no companies', async () => {
    vi.mocked(companyService.getMyCompanies).mockResolvedValue([]);
    vi.spyOn(authApi, 'login').mockResolvedValue({
      access: 'new-a',
      refresh: 'new-r',
      user: sampleUser,
    });

    renderLogin();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/username/i), 'carol');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(companyService.getMyCompanies).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument());
  });

  it('skips login form when already authenticated', async () => {
    authStorage.setTokens('a', 'r');
    vi.spyOn(authApi, 'me').mockResolvedValue({ user: sampleUser });

    renderLogin('/login');

    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

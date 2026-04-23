/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { authApi, authStorage, type AuthUser } from '@/services/api';

const sampleUser: AuthUser = {
  id: 2,
  username: 'bob',
  email: 'bob@test.dev',
  first_name: 'Bob',
  last_name: 'User',
  is_active: true,
};

function SecretPage() {
  return <div data-testid="secret">Protected</div>;
}

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.spyOn(authApi, 'me').mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderHarness(initialPath: string) {
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login page</div>} />
            <Route element={<RequireAuth />}>
              <Route path="/secret" element={<SecretPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('shows loading until auth bootstrap completes', async () => {
    authStorage.setTokens('a', 'r');
    vi.spyOn(authApi, 'me').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );

    renderHarness('/secret');

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('secret')).not.toBeInTheDocument();
  });

  it('redirects to login with state.from when not authenticated', async () => {
    renderHarness('/secret');

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
    expect(screen.queryByTestId('secret')).not.toBeInTheDocument();
  });

  it('renders protected route when authenticated', async () => {
    authStorage.setTokens('access', 'refresh');
    vi.spyOn(authApi, 'me').mockResolvedValue({ user: sampleUser });

    renderHarness('/secret');

    await waitFor(() => expect(screen.getByTestId('secret')).toHaveTextContent('Protected'));
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });
});

describe('RequireAuth integration with useAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates away from protected content after logout', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ user: sampleUser });
    authStorage.setTokens('access', 'refresh');

    function ToggleAuth() {
      const { logout, isAuthenticated } = useAuth();
      return (
        <div>
          <span data-testid="flag">{isAuthenticated ? 'in' : 'out'}</span>
          <button type="button" onClick={logout}>
            signout
          </button>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/secret']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login page</div>} />
            <Route element={<RequireAuth />}>
              <Route
                path="/secret"
                element={
                  <div>
                    <SecretPage />
                    <ToggleAuth />
                  </div>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument());

    screen.getByRole('button', { name: 'signout' }).click();

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
  });
});

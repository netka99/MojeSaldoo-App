/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi, authStorage, AUTH_SESSION_EXPIRED_EVENT, type AuthUser } from '@/services/api';

const sampleUser: AuthUser = {
  id: 1,
  username: 'alice',
  email: 'alice@test.dev',
  first_name: 'Alice',
  last_name: 'Tester',
  is_active: true,
};

function TestConsumer() {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{isLoading ? 'loading' : 'ready'}</span>
      <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid="username">{user?.username ?? 'none'}</span>
      <button type="button" onClick={() => void login('alice', 'secret')}>
        login
      </button>
      <button type="button" onClick={logout}>
        logout
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.spyOn(authApi, 'me').mockReset();
    vi.spyOn(authApi, 'login').mockReset();
    vi.spyOn(authApi, 'logout').mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function withProviders(node: ReactNode) {
    return (
      <TestQueryProvider>
        <AuthProvider>{node}</AuthProvider>
      </TestQueryProvider>
    );
  }

  it('finishes bootstrap with no token as unauthenticated', async () => {
    render(
      withProviders(<TestConsumer />),
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'));
    expect(screen.getByTestId('auth')).toHaveTextContent('no');
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('bootstrap loads user when access token exists and /me succeeds', async () => {
    authStorage.setTokens('access-jwt', 'refresh-jwt');
    vi.spyOn(authApi, 'me').mockResolvedValue({ user: sampleUser });

    render(withProviders(<TestConsumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'));
    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auth')).toHaveTextContent('yes');
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
  });

  it('bootstrap clears storage and user when /me fails', async () => {
    authStorage.setTokens('bad-access', 'refresh-jwt');
    vi.spyOn(authApi, 'me').mockRejectedValue(new Error('unauthorized'));

    render(withProviders(<TestConsumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'));
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(screen.getByTestId('auth')).toHaveTextContent('no');
  });

  it('login calls authApi.login and sets user', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      access: 'a',
      refresh: 'r',
      user: sampleUser,
    });

    render(withProviders(<TestConsumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'));
    await userEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('yes'));
    expect(authApi.login).toHaveBeenCalledWith('alice', 'secret');
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
  });

  it('logout calls authApi.logout and clears user', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      access: 'a',
      refresh: 'r',
      user: sampleUser,
    });

    render(withProviders(<TestConsumer />));

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'));
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));

    await userEvent.click(screen.getByRole('button', { name: 'logout' }));

    expect(authApi.logout).toHaveBeenCalled();
    expect(screen.getByTestId('auth')).toHaveTextContent('no');
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });

  it('clears user when AUTH_SESSION_EXPIRED_EVENT fires', async () => {
    authStorage.setTokens('access-jwt', 'refresh-jwt');
    vi.spyOn(authApi, 'me').mockResolvedValue({ user: sampleUser });

    render(withProviders(<TestConsumer />));

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));

    window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('none'));
    expect(screen.getByTestId('auth')).toHaveTextContent('no');
  });

  it('useAuth throws outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<TestConsumer />)).toThrow(/useAuth must be used within an AuthProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});

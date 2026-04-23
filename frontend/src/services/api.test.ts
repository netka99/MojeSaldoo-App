import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import nock from 'nock';
import { api, authApi, authStorage, AUTH_SESSION_EXPIRED_EVENT } from './api';

const HOST = 'http://localhost:8000';

describe('api (axios client)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('authApi.login stores tokens and returns payload', async () => {
    const payload = {
      access: 'access-jwt',
      refresh: 'refresh-jwt',
      user: {
        id: 1,
        username: 'u1',
        email: 'u1@test.dev',
        first_name: 'U',
        last_name: 'One',
        is_active: true,
      },
    };

    nock(HOST).post('/api/auth/login/', { username: 'u1', password: 'secret' }).reply(200, payload);

    const result = await authApi.login('u1', 'secret');

    expect(result).toEqual(payload);
    expect(localStorage.getItem('access_token')).toBe('access-jwt');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-jwt');
  });

  it('authApi.logout clears tokens', () => {
    authStorage.setTokens('a', 'b');
    authApi.logout();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('api.get sends Authorization when access token is set', async () => {
    authStorage.setTokens('my-token', 'refresh');

    nock(HOST)
      .get('/api/auth/me/')
      .matchHeader('authorization', 'Bearer my-token')
      .reply(200, { user: { id: 1, username: 'x', email: '', first_name: '', last_name: '', is_active: true } });

    const data = await api.get<{ user: { id: number; username: string } }>('/auth/me/');
    expect(data.user.username).toBe('x');
  });

  it('maps Axios 400 errors to Error with DRF detail', async () => {
    authStorage.setTokens('t', 'r');
    nock(HOST).get('/api/products/').reply(400, { detail: 'Invalid query.' });

    await expect(api.get('/products/')).rejects.toThrow('Invalid query.');
  });

  it('maps Axios 400 field errors when detail is absent', async () => {
    authStorage.setTokens('t', 'r');
    nock(HOST).post('/api/warehouses/', {}).reply(400, { code: ['warehouse with this code already exists.'] });

    await expect(api.post('/warehouses/', {})).rejects.toThrow(/code:/i);
  });

  it('on 401 refreshes session and retries the request', async () => {
    authStorage.setTokens('old-access', 'refresh-token');

    nock(HOST)
      .get('/api/products/')
      .matchHeader('authorization', 'Bearer old-access')
      .reply(401, { detail: 'Given token not valid for any token type' })
      .post('/api/auth/refresh/', { refresh: 'refresh-token' })
      .reply(200, { access: 'new-access', refresh: 'new-refresh' })
      .get('/api/products/')
      .matchHeader('authorization', 'Bearer new-access')
      .reply(200, {
        count: 0,
        next: null,
        previous: null,
        results: [],
      });

    const data = await api.get<{ count: number; results: unknown[] }>('/products/');

    expect(data.results).toEqual([]);
    expect(localStorage.getItem('access_token')).toBe('new-access');
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
  });

  it('does not refresh on 401 for login', async () => {
    nock(HOST).post('/api/auth/login/', { username: 'bad', password: 'bad' }).reply(401, { detail: 'Bad creds' });

    let refreshCalled = false;
    nock(HOST).post('/api/auth/refresh/').reply(() => {
      refreshCalled = true;
      return [200, { access: 'x', refresh: 'y' }];
    });

    await expect(authApi.login('bad', 'bad')).rejects.toThrow();
    expect(refreshCalled).toBe(false);
  });

  it('clears tokens when refresh fails after 401', async () => {
    authStorage.setTokens('expired', 'bad-refresh');

    nock(HOST).get('/api/products/').reply(401, {}).post('/api/auth/refresh/', { refresh: 'bad-refresh' }).reply(401, {});

    await expect(api.get('/products/')).rejects.toThrow();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('dispatches AUTH_SESSION_EXPIRED_EVENT when refresh fails after 401', async () => {
    const handler = vi.fn();
    const prev = globalThis.dispatchEvent;
    globalThis.dispatchEvent = (event: Event) => {
      handler(event.type);
      return true;
    };

    try {
      authStorage.setTokens('expired', 'bad-refresh');

      nock(HOST).get('/api/products/').reply(401, {}).post('/api/auth/refresh/', { refresh: 'bad-refresh' }).reply(401, {});

      await expect(api.get('/products/')).rejects.toThrow();
      expect(handler).toHaveBeenCalledWith(AUTH_SESSION_EXPIRED_EVENT);
    } finally {
      globalThis.dispatchEvent = prev;
    }
  });
});

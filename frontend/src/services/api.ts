/**
 * API Service - Frontend HTTP Client
 *
 * IMPORTANT: This handles ONLY JWT authentication for user login.
 * KSeF tokens, certificates, and encryption are handled ENTIRELY on the backend (ssapi).
 *
 * The 'token' stored here is a JWT for user authentication, NOT a KSeF token.
 */

import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

import type { CompanyRole } from '@/types';

/**
 * Backend API root (must include `/api` if your Django routes are mounted there).
 * Set `VITE_API_BASE_URL` in `.env` to override (e.g. full URL in production).
 *
 * In the browser during `npm run dev`, default is `/api` so requests use the Vite
 * dev proxy (`vite.config.ts` → `localhost:8000`) and avoid cross-origin "Network Error".
 */
function resolveApiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV && typeof window !== 'undefined') return '/api';
  return 'http://localhost:8000/api';
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Dispatched when tokens are cleared after refresh failure so AuthContext can reset user state. */
export const AUTH_SESSION_EXPIRED_EVENT = 'mojesaldoo:auth-session-expired';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

/** Prefix for `Authorization` — swap scheme if the API expects something other than RFC 6750 Bearer JWT. */
const JWT_AUTH_SCHEME = 'Bearer';

/**
 * Attach JWT (access token) to outgoing requests.
 * Placeholder / extension point: add `X-Request-ID`, tenant headers, alternate `Authorization` schemes, etc.
 */
function applyJwtAuthHeaders(config: InternalAxiosRequestConfig): void {
  const token = authStorage.getAccessToken();
  if (!token) {
    return;
  }
  // Example placeholder for additional auth context:
  // config.headers['X-Your-Tenant-Id'] = resolveTenantId();
  config.headers.Authorization = `${JWT_AUTH_SCHEME} ${token}`;
}

type ApiErrorResponse = { detail?: string | string[]; message?: string };

function drfFieldMessages(body: Record<string, unknown>): string | null {
  const messages: string[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (key === 'detail' || key === 'message' || val == null) continue;
    if (typeof val === 'string') messages.push(`${key}: ${val}`);
    else if (key === 'stock' && Array.isArray(val) && val.length > 0) {
      const rows = val.filter((v): v is Record<string, unknown> => v != null && typeof v === 'object');
      if (rows.length) {
        const parts = rows.map((row) => {
          const name = row.product_name ?? row.product_id;
          return `${name}: dostępne ${row.quantity_available}, wymagane ${row.quantity_requested}`;
        });
        messages.push(`Niewystarczający stan: ${parts.join('; ')}`);
      }
    } else if (Array.isArray(val)) {
      const strs = val.filter((v): v is string => typeof v === 'string');
      if (strs.length) messages.push(`${key}: ${strs.join(', ')}`);
    }
  }
  return messages.length ? messages.join(' · ') : null;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  is_active: boolean;
  /** Active tenant from `POST /api/companies/switch/`; drives module guards. */
  current_company?: string | null;
  /** Role in `current_company`; from `GET /auth/me/`. */
  current_company_role?: CompanyRole | null;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: AuthUser;
}

export interface RegisterPayload {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  password2: string;
}

export const authStorage = {
  getAccessToken: (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),
  setTokens: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refresh = authStorage.getRefreshToken();
  if (!refresh) {
    throw new Error('Missing refresh token');
  }

  const { data } = await axios.post<{ access: string; refresh?: string }>(
    `${API_BASE_URL}/auth/refresh/`,
    { refresh },
    { headers: { 'Content-Type': 'application/json' } },
  );

  authStorage.setTokens(data.access, data.refresh ?? refresh);
  return data.access;
}

function toAppError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<ApiErrorResponse & Record<string, unknown>>;
    const body = ax.response?.data;
    const detail = body?.detail;
    const detailStr =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail) && detail.every((d): d is string => typeof d === 'string')
          ? detail.join(' · ')
          : null;
    const fieldStr =
      body && typeof body === 'object' && !Array.isArray(body) ? drfFieldMessages(body as Record<string, unknown>) : null;
    const msg =
      detailStr ||
      (typeof body?.message === 'string' ? body.message : null) ||
      fieldStr ||
      ax.message ||
      'Request failed';
    return new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return error instanceof Error ? error : new Error('Request failed');
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  // timeout: 30_000,
});

apiClient.interceptors.request.use((config) => {
  applyJwtAuthHeaders(config);
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;

    if (!originalRequest || status !== 401 || originalRequest._retry) {
      return Promise.reject(toAppError(error));
    }

    const path = `${originalRequest.baseURL ?? ''}${originalRequest.url ?? ''}`;
    if (path.includes('/auth/login/') || path.includes('/auth/register/') || path.includes('/auth/refresh/')) {
      return Promise.reject(toAppError(error));
    }

    if (!authStorage.getAccessToken()) {
      return Promise.reject(toAppError(error));
    }

    originalRequest._retry = true;
    refreshPromise = refreshPromise ?? refreshAccessToken();
    try {
      const access = await refreshPromise;
      originalRequest.headers.Authorization = `${JWT_AUTH_SCHEME} ${access}`;
      return apiClient(originalRequest);
    } catch {
      authStorage.clear();
      globalThis.dispatchEvent?.(new Event(AUTH_SESSION_EXPIRED_EVENT));
      return Promise.reject(toAppError(error));
    } finally {
      refreshPromise = null;
    }
  },
);

async function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  try {
    const { data } = await p;
    return data;
  } catch (e) {
    throw toAppError(e);
  }
}

/** Multipart upload: FormData must not use `application/json` (browser sets boundary). */
function postFormData<T>(url: string, data: FormData) {
  return unwrap<T>(
    apiClient.post<T>(url, data, {
      transformRequest: [
        (body, headers) => {
          if (headers && typeof headers === 'object' && 'Content-Type' in headers) {
            delete (headers as Record<string, string | undefined>)['Content-Type'];
          }
          return body;
        },
      ],
    }),
  );
}

/** Typed helpers returning response bodies (DRF JSON / empty object for 204). */
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) => unwrap<T>(apiClient.get<T>(url, config)),

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    unwrap<T>(apiClient.post<T>(url, data, config)),

  postForm: <T>(url: string, data: FormData) => postFormData<T>(url, data),

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    unwrap<T>(apiClient.put<T>(url, data, config)),

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    unwrap<T>(apiClient.patch<T>(url, data, config)),

  delete: <T>(url: string, config?: AxiosRequestConfig) => unwrap<T>(apiClient.delete<T>(url, config)),
};

export const authApi = {
  login: async (username: string, password: string): Promise<AuthResponse> => {
    const data = await api.post<AuthResponse>('/auth/login/', { username, password });
    authStorage.setTokens(data.access, data.refresh);
    return data;
  },
  register: (payload: RegisterPayload) => api.post<{ user: AuthUser }>('/auth/register/', payload),
  me: () => api.get<{ user: AuthUser }>('/auth/me/'),
  logout: () => authStorage.clear(),
};

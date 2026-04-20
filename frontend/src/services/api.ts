/**
 * API Service - Frontend HTTP Client
 *
 * IMPORTANT: This handles ONLY JWT authentication for user login.
 * KSeF tokens, certificates, and encryption are handled ENTIRELY on the backend (ssapi).
 *
 * The 'token' stored here is a JWT for user authentication, NOT a KSeF token.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

type ApiErrorResponse = { detail?: string; message?: string };

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  is_active: boolean;
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

const getAccessToken = (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY);
const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY);

export const authStorage = {
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
  const refresh = getRefreshToken();
  if (!refresh) {
    throw new Error('Missing refresh token');
  }

  const response = await fetch(`${API_BASE_URL}/auth/refresh/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh }),
  });

  if (!response.ok) {
    authStorage.clear();
    throw new Error('Session expired');
  }

  const data = (await response.json()) as { access: string; refresh?: string };
  authStorage.setTokens(data.access, data.refresh ?? refresh);
  return data.access;
}

// Base fetch wrapper
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  retried = false
): Promise<T> {
  const token = getAccessToken();

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (response.status === 401 && token && !retried) {
    refreshPromise = refreshPromise ?? refreshAccessToken();
    try {
      await refreshPromise;
      return fetchApi<T>(endpoint, options, true);
    } finally {
      refreshPromise = null;
    }
  }

  // Handle errors
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ message: 'Unknown error' }))) as ApiErrorResponse;
    throw new Error(error.detail || error.message || 'Request failed');
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// Export API methods
export const api = {
  get: <T>(url: string) => fetchApi<T>(url, { method: 'GET' }),
  
  post: <T>(url: string, data?: unknown) =>
    fetchApi<T>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  put: <T>(url: string, data?: unknown) =>
    fetchApi<T>(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  patch: <T>(url: string, data?: unknown) =>
    fetchApi<T>(url, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  
  delete: <T>(url: string) => fetchApi<T>(url, { method: 'DELETE' }),
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
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  authApi,
  authStorage,
  AUTH_SESSION_EXPIRED_EVENT,
  type AuthUser,
} from '@/services/api';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Reload user from `GET /auth/me/` (e.g. after company switch or onboarding). */
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const onSessionExpired = () => setUser(null);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!authStorage.getAccessToken()) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      try {
        const { user: me } = await authApi.me();
        if (!cancelled) setUser(me);
      } catch {
        authStorage.clear();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const data = await authApi.login(username, password);
    setUser(data.user);
  }, []);

  const logout = useCallback((): void => {
    authApi.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    if (!authStorage.getAccessToken()) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await authApi.me();
      setUser(me);
    } catch {
      authStorage.clear();
      setUser(null);
    }
  }, []);

  const isAuthenticated = Boolean(user);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, refreshUser, isAuthenticated }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

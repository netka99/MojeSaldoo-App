import { type FormEvent, useState } from 'react';
import { isAxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { companyKeys } from '@/query/keys';
import { useMyCompaniesQuery } from '@/query/use-companies';
import { API_BASE_URL } from '@/services/api';
import { companyService } from '@/services/company.service';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

function resolvePostLoginTarget(from: string, hasCompanies: boolean): string {
  if (!hasCompanies) return '/onboarding';
  if (!from.startsWith('/')) return '/';
  if (from === '/login' || from === '/onboarding') return '/';
  return from;
}

/**
 * When session exists but the user opened `/login`, send them to onboarding or the app based on company membership.
 */
function PostAuthLoginRedirect({ from }: { from: string }) {
  const { data, isPending, isSuccess, isError } = useMyCompaniesQuery();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  if (isError) {
    // Could not load companies (network/401/5xx). Prefer onboarding so new users are not dropped on `/` with a broken shell.
    return <Navigate to="/onboarding" replace />;
  }

  const hasCompanies = isSuccess && data.length > 0;
  return <Navigate to={resolvePostLoginTarget(from, hasCompanies)} replace />;
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isLoading } = useAuth();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  if (isAuthenticated) {
    return <PostAuthLoginRedirect from={from.startsWith('/') ? from : '/'} />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      const companies = await queryClient.fetchQuery({
        queryKey: companyKeys.me(),
        queryFn: () => companyService.getMyCompanies(),
      });
      const target = resolvePostLoginTarget(from, companies.length > 0);
      navigate(target, { replace: true });
    } catch (err) {
      if (isAxiosError(err) && err.message === 'Network Error') {
        setError(
          `Brak połączenia z API (${API_BASE_URL}). Uruchom Django na porcie 8000 i otwórz aplikację z Vite (http://localhost:3000). Usuń VITE_API_BASE_URL z pliku .env w dev, chyba że skonfigurowałeś CORS dla tego hosta.`,
        );
        return;
      }
      setError(err instanceof Error ? err.message : 'Logowanie nie powiodło się');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Logowanie</CardTitle>
          <p className="text-sm text-muted-foreground">
            Użyj danych użytkownika Django (tak jak przy <code className="text-xs">createsuperuser</code>).
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Input
              label="Nazwa użytkownika"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              required
            />
            <Input
              label="Hasło"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
            />
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" loading={loading}>
                Zaloguj się
              </Button>
              <Link
                to="/"
                className={cn(
                  'inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  loading && 'pointer-events-none opacity-50',
                )}
              >
                Anuluj
              </Link>
            </div>
            <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-primary hover:underline">
              Nie pamiętasz hasła?
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

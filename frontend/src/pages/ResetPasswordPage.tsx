import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function ResetPasswordPage() {
  const { uid, token } = useParams<{ uid: string; token: string }>();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError('Hasła nie są identyczne.');
      return;
    }
    if (password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/password-reset/confirm/', { uid, token, new_password: password });
      setDone(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Link wygasł lub jest nieprawidłowy.');
    } finally {
      setLoading(false);
    }
  };

  if (!uid || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <p className="text-sm text-destructive">Nieprawidłowy link resetowania hasła.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Nowe hasło</CardTitle>
          <p className="text-sm text-muted-foreground">Ustaw nowe hasło dla swojego konta.</p>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
                Hasło zostało zmienione. Możesz się teraz zalogować.
              </p>
              <Link to="/login" className="text-sm font-medium text-primary hover:underline">
                Przejdź do logowania
              </Link>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={onSubmit}>
              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Input
                label="Nowe hasło"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Input
                label="Powtórz hasło"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
              />
              <Button type="submit" loading={loading}>
                Zmień hasło
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

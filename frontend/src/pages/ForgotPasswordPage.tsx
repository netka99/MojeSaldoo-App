import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/password-reset/', { email });
      setDone(true);
    } catch {
      setError('Wystąpił błąd. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Reset hasła</CardTitle>
          <p className="text-sm text-muted-foreground">
            Podaj adres e-mail powiązany z kontem.
          </p>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
                Jeśli konto istnieje, link do resetu hasła został wysłany. Sprawdź terminal Django (tryb dev).
              </p>
              <Link to="/login" className="text-sm font-medium text-primary hover:underline">
                Wróć do logowania
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
                label="Adres e-mail"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" loading={loading}>
                  Wyślij link
                </Button>
                <Link
                  to="/login"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Anuluj
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

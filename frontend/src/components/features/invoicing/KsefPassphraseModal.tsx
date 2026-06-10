import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface KsefPassphraseModalProps {
  /** Company name to display in the prompt. */
  companyName: string;
  /** Called when user confirms — receives the entered passphrase. */
  onConfirm: (passphrase: string) => void;
  /** Called when user cancels. */
  onCancel: () => void;
  /** Show a loading/spinner state while authentication is in progress. */
  loading?: boolean;
  /** Error message to display (e.g. wrong passphrase). */
  error?: string | null;
}

/**
 * Modal that prompts the user for their KSeF certificate passphrase.
 * The passphrase is used only in-flight — it is never stored.
 */
export function KsefPassphraseModal({
  companyName,
  onConfirm,
  onCancel,
  loading = false,
  error = null,
}: KsefPassphraseModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input when modal opens
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim() || loading) return;
    onConfirm(passphrase);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ksef-modal-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl">
        <h2 id="ksef-modal-title" className="text-base font-semibold text-foreground">
          Uwierzytelnienie KSeF
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Podaj hasło do certyfikatu KSeF dla firmy{' '}
          <span className="font-medium text-foreground">{companyName}</span>.
          Hasło nie jest zapisywane.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="ksef-passphrase"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Hasło do certyfikatu
            </label>
            <input
              id="ksef-passphrase"
              ref={inputRef}
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              className={cn(
                'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary',
                'disabled:opacity-50',
              )}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              Anuluj
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!passphrase.trim() || loading}
              loading={loading}
            >
              {loading ? 'Uwierzytelnianie…' : 'Zaloguj do KSeF'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

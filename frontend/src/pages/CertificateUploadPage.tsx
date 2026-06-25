import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { usePermission } from '@/hooks/usePermission';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import {
  useKsefCertificateDeleteMutation,
  useKsefCertificateStatusQuery,
  useKsefCertificateUploadMutation,
} from '@/query/use-certificate';
import {
  useKsefSessionQuery,
  useKsefAuthenticateMutation,
  useKsefClearSessionMutation,
} from '@/query/use-invoices';
import { KsefPassphraseModal } from '@/components/features/invoicing/KsefPassphraseModal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

function formatPlDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pl-PL', { dateStyle: 'long' });
}

function statusSummaryPl(status: { uploaded: boolean; valid: boolean; expired: boolean; not_yet_valid: boolean }) {
  if (!status.uploaded) {
    return 'Brak wgranego certyfikatu';
  }
  if (status.not_yet_valid) {
    return 'Certyfikat jeszcze nieważny (przed okresem ważności)';
  }
  if (status.expired) {
    return 'Certyfikat wygasł';
  }
  if (status.valid) {
    return 'Certyfikat wgrany i ważny w bieżącym okresie';
  }
  return 'Certyfikat wgrany, ale nieważny (sprawdź status aktywności w systemie)';
}

export function CertificateUploadPage() {
  const { user } = useAuth();
  const canManageInvoices = usePermission('can_manage_invoices');
  const resolved = useResolvedCompanyId();
  const titleId = useId();
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [ksefModalOpen, setKsefModalOpen] = useState(false);
  const [ksefError, setKsefError] = useState<string | null>(null);

  const companyId = resolved.state === 'ready' ? resolved.companyId : undefined;
  const { data: status, isPending, isError, error, refetch } = useKsefCertificateStatusQuery(companyId);
  const uploadMut = useKsefCertificateUploadMutation();
  const deleteMut = useKsefCertificateDeleteMutation();

  const { data: ksefSession, refetch: refetchSession } = useKsefSessionQuery(Boolean(companyId));
  const ksefAuthM = useKsefAuthenticateMutation();
  const ksefClearM = useKsefClearSessionMutation();

  const companyName = resolved.state === 'ready' ? (resolved.company?.name ?? '') : '';

  const onKsefAuthenticate = async (passphrase: string) => {
    setKsefError(null);
    try {
      await ksefAuthM.mutateAsync(passphrase);
      setKsefModalOpen(false);
    } catch (err) {
      setKsefError(err instanceof Error ? err.message : 'Uwierzytelnianie nie powiodło się.');
    }
  };

  const onKsefClear = async () => {
    try {
      await ksefClearM.mutateAsync();
      void refetchSession();
    } catch {
      // ignore
    }
  };

  const canManage =
    canManageInvoices &&
    companyId &&
    user?.current_company === companyId;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!companyId) return;
    const cert = certInputRef.current?.files?.[0];
    const key = keyInputRef.current?.files?.[0];
    if (!cert || !key) {
      setFeedback({ type: 'err', text: 'Wybierz plik certyfikatu i plik klucza prywatnego.' });
      return;
    }
    const formData = new FormData();
    formData.append('certificate_file', cert);
    formData.append('key_file', key);
    try {
      await uploadMut.mutateAsync({ companyId, formData });
      setFeedback({ type: 'ok', text: 'Certyfikat został zapisany pomyślnie.' });
      if (certInputRef.current) certInputRef.current.value = '';
      if (keyInputRef.current) keyInputRef.current.value = '';
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Nie udało się wgrać certyfikatu.' });
    }
  };

  const onConfirmDelete = async () => {
    if (!companyId) return;
    setFeedback(null);
    try {
      await deleteMut.mutateAsync(companyId);
      setFeedback({ type: 'ok', text: 'Certyfikat został usunięty.' });
      setDeleteOpen(false);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Nie udało się usunąć certyfikatu.' });
      setDeleteOpen(false);
    }
  };

  const closeDelete = useCallback(() => {
    if (deleteMut.isPending) return;
    setDeleteOpen(false);
  }, [deleteMut.isPending]);

  useEffect(() => {
    if (!deleteOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteMut.isPending) {
        setDeleteOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteOpen, deleteMut.isPending]);

  useEffect(() => {
    if (!deleteOpen) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [deleteOpen]);

  if (resolved.state === 'loading' || (companyId && isPending)) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      </div>
    );
  }

  if (resolved.state === 'no_companies' || !companyId) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-muted-foreground">Brak firmy do konfiguracji certyfikatu.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-4">
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : 'Nie udało się pobrać statusu certyfikatu.'}
        </p>
        <Button type="button" variant="outline" onClick={() => void refetch()}>
          Spróbuj ponownie
        </Button>
      </div>
    );
  }

  const busy = uploadMut.isPending || deleteMut.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Certyfikat KSeF</h1>
        <p className="text-sm text-muted-foreground">
          Wgraj plik .pem i klucz prywatny w celu integracji z KSeF.{' '}
          <Link to="/settings/company" className="font-medium text-primary underline-offset-4 hover:underline">
            Ustawienia firmy
          </Link>
        </p>
        {user?.current_company && user.current_company !== companyId && (
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-200" role="status">
            Wybrana firma na liście różni się od bieżącej w profilu. Użyj przełącznika firmy, aby wgrać certyfikat dla
            właściwej organizacji.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Status certyfikatu</CardTitle>
          <CardDescription>Informacje o wgranym certyfikacie (klucz prywatny nigdy nie jest wyświetlany).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">{status ? statusSummaryPl(status) : '—'}</p>
          {status?.uploaded && (
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Podmiot (subject)</dt>
                <dd className="font-mono text-xs break-all">{status.subject_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ważny do</dt>
                <dd>{formatPlDate(status.valid_until)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ważny od</dt>
                <dd>{formatPlDate(status.valid_from)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Wgrano</dt>
                <dd>
                  {status.uploaded_at
                    ? new Date(status.uploaded_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sesja KSeF</CardTitle>
          <CardDescription>
            Po wgraniu certyfikatu uwierzytelnij się w KSeF podając hasło do klucza prywatnego.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                'inline-block h-2.5 w-2.5 rounded-full',
                ksefSession?.active ? 'bg-emerald-500' : 'bg-slate-300',
              )}
              aria-hidden
            />
            {ksefSession?.active ? (
              <span>
                Sesja aktywna
                {ksefSession.access_valid_until && (
                  <span className="ml-1 text-muted-foreground">
                    · ważna do{' '}
                    {new Date(ksefSession.access_valid_until).toLocaleString('pl-PL', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Brak aktywnej sesji KSeF</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!status?.valid || ksefAuthM.isPending || ksefClearM.isPending}
              onClick={() => {
                setKsefError(null);
                setKsefModalOpen(true);
              }}
            >
              Uwierzytelnij KSeF
            </Button>
            {ksefSession?.active && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ksefClearM.isPending}
                loading={ksefClearM.isPending}
                onClick={() => void onKsefClear()}
              >
                Wyczyść sesję
              </Button>
            )}
          </div>
          {!status?.valid && status?.uploaded && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Certyfikat wgrany, ale nieważny — uwierzytelnianie KSeF wyłączone.
            </p>
          )}
          {!status?.uploaded && (
            <p className="text-xs text-muted-foreground">
              Najpierw wgraj certyfikat poniżej.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Wgraj certyfikat</CardTitle>
          <CardDescription>
            Oba pliki muszą należeć do tej samej pary (klucz musi odpowiadać certyfikatowi).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {feedback && (
            <p
              className={cn(
                'mb-4 rounded-md border px-3 py-2 text-sm',
                feedback.type === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100'
                  : 'border-destructive/40 bg-destructive/5 text-destructive',
              )}
              role="status"
            >
              {feedback.text}
            </p>
          )}

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <Input
              ref={certInputRef}
              type="file"
              accept=".pem,.crt,.cer,application/x-x509-ca-cert"
              label="Certyfikat (.pem)"
              required
              disabled={!canManage || busy}
            />
            <Input
              ref={keyInputRef}
              type="file"
              accept=".key,.pem,application/x-pem-file,application/pkix-key"
              label="Klucz prywatny (.key / .pem)"
              required
              disabled={!canManage || busy}
            />
            {!canManage && (
              <p className="text-sm text-muted-foreground">
                Nie masz uprawnień do zarządzania certyfikatem KSeF. Wymagane uprawnienie: Faktury.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!canManage || busy} loading={uploadMut.isPending}>
                Wyślij certyfikat
              </Button>
              {status?.uploaded && canManage && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFeedback(null);
                    setDeleteOpen(true);
                  }}
                  disabled={busy}
                >
                  Usuń certyfikat
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {ksefModalOpen &&
        createPortal(
          <KsefPassphraseModal
            companyName={companyName}
            onConfirm={(passphrase) => void onKsefAuthenticate(passphrase)}
            onCancel={() => {
              if (!ksefAuthM.isPending) {
                setKsefModalOpen(false);
                setKsefError(null);
              }
            }}
            loading={ksefAuthM.isPending}
            error={ksefError}
          />,
          document.body,
        )}

      {deleteOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeDelete();
            }}
          >
            <div
              className="w-full max-w-md rounded-xl border border-border bg-background p-0 shadow-lg"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5">
                <h2 id={titleId} className="text-lg font-semibold text-foreground">
                  Usunąć certyfikat KSeF?
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Tej operacji nie można cofnąć. Aby ponownie korzystać z KSeF, będziesz musiał wgrać certyfikat ponownie.
                </p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeDelete} disabled={deleteMut.isPending}>
                    Anuluj
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void onConfirmDelete()}
                    loading={deleteMut.isPending}
                  >
                    Usuń
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

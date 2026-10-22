import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
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
import { useUpdateCompanyMutation } from '@/query/use-companies';
import { KsefPassphraseModal } from '@/components/features/invoicing/KsefPassphraseModal';
import { cn } from '@/lib/utils';

const cardCls = 'rounded-2xl border border-slate-200 bg-white md:rounded-3xl';
const primaryBtnCls =
  'rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50';
const quietBtnCls =
  'rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const dangerBtnCls =
  'rounded-2xl px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';

type KsefEnvironment = 'test' | 'demo' | 'production';

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

function savedFileLabel(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Zapisany w systemie';
}

function FilePick({
  label,
  accept,
  file,
  onChange,
  disabled,
}: {
  label: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-800">{label}</p>
      <button
        type="button"
        className="field-ios flex w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <span className={cn('min-w-0 truncate', file ? 'font-medium text-slate-900' : 'text-slate-500')}>
          {file ? file.name : 'Nie wybrano pliku'}
        </span>
        <span className="shrink-0 text-xs font-semibold text-primary">Wybierz</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

export function CertificateUploadPage() {
  const { user, refreshUser } = useAuth();
  const canManageInvoices = usePermission('can_manage_invoices');
  const resolved = useResolvedCompanyId();
  const titleId = useId();

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [ksefModalOpen, setKsefModalOpen] = useState(false);
  const [ksefError, setKsefError] = useState<string | null>(null);
  const [envSaving, setEnvSaving] = useState(false);

  const companyId = resolved.state === 'ready' ? resolved.companyId : undefined;
  const currentEnv: KsefEnvironment = (user?.ksef_environment as KsefEnvironment) ?? 'demo';
  const { data: status, isPending, isError, error, refetch } = useKsefCertificateStatusQuery(companyId, currentEnv);
  const uploadMut = useKsefCertificateUploadMutation();
  const deleteMut = useKsefCertificateDeleteMutation();

  const { data: ksefSession, refetch: refetchSession } = useKsefSessionQuery(Boolean(companyId));
  const ksefAuthM = useKsefAuthenticateMutation();
  const ksefClearM = useKsefClearSessionMutation();
  const updateCompany = useUpdateCompanyMutation();

  const isStaff = Boolean(user?.is_staff);

  const envOptions: { value: KsefEnvironment; label: string; hint: string; url: string }[] = [
    ...(isStaff ? [{ value: 'test' as KsefEnvironment, label: 'Testowe', hint: 'Fikcyjne dane — tylko dla programistów', url: 'https://ap-test.ksef.mf.gov.pl/web/' }] : []),
    { value: 'demo', label: 'Demo', hint: 'Prawdziwe dane firmowe, fikcyjne faktury', url: 'https://ap-demo.ksef.mf.gov.pl/web/' },
    { value: 'production', label: 'Produkcja', hint: 'Realne faktury w KSeF', url: 'https://ap.ksef.mf.gov.pl/web/' },
  ];
  const currentEnvLabel = envOptions.find((o) => o.value === currentEnv)?.label ?? currentEnv;

  const onEnvChange = async (env: KsefEnvironment) => {
    if (!companyId || envSaving) return;
    setEnvSaving(true);
    try {
      await updateCompany.mutateAsync({ companyId, data: { name: '', ksef_environment: env } });
      await refreshUser?.();
    } finally {
      setEnvSaving(false);
    }
  };

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
    if (!certFile || !keyFile) {
      setFeedback({ type: 'err', text: 'Wybierz plik certyfikatu i plik klucza prywatnego.' });
      return;
    }
    const formData = new FormData();
    formData.append('certificate_file', certFile);
    formData.append('key_file', keyFile);
    formData.append('environment', currentEnv);
    try {
      await uploadMut.mutateAsync({ companyId, formData, environment: currentEnv });
      setFeedback({ type: 'ok', text: 'Certyfikat został zapisany pomyślnie.' });
      setCertFile(null);
      setKeyFile(null);
      setReplacing(false);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Nie udało się wgrać certyfikatu.' });
    }
  };

  useEffect(() => {
    setReplacing(false);
    setCertFile(null);
    setKeyFile(null);
    setFeedback(null);
  }, [currentEnv]);

  const onConfirmDelete = async () => {
    if (!companyId) return;
    setFeedback(null);
    try {
      await deleteMut.mutateAsync({ companyId, environment: currentEnv });
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
      <div className="min-h-full bg-[#F2F2F7] px-4 pt-8">
        <p className="mx-auto max-w-2xl text-sm text-slate-500">Ładowanie…</p>
      </div>
    );
  }

  if (resolved.state === 'no_companies' || !companyId) {
    return (
      <div className="min-h-full bg-[#F2F2F7] px-4 pt-8">
        <p className="mx-auto max-w-2xl text-sm text-slate-600">Brak firmy do konfiguracji certyfikatu.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-full bg-[#F2F2F7] px-4 pt-8">
        <div className="mx-auto flex max-w-2xl flex-col items-start gap-3">
          <p className="text-sm text-red-600" role="alert">
            {error instanceof Error ? error.message : 'Nie udało się pobrać statusu certyfikatu.'}
          </p>
          <button type="button" className={quietBtnCls} onClick={() => void refetch()}>
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }

  const busy = uploadMut.isPending || deleteMut.isPending;
  const showUploadForm = !status?.uploaded || replacing;

  return (
    <div className="min-h-full bg-[#F2F2F7]">
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-10 pt-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Certyfikat KSeF</h1>
        <p className="mt-1 text-xs text-slate-500">
          Certyfikat do uwierzytelniania w KSeF — osobny dla każdego środowiska.
        </p>
        {user?.current_company && user.current_company !== companyId && (
          <p className="mt-2 text-sm text-amber-800" role="status">
            Wybrana firma różni się od bieżącej w profilu.
          </p>
        )}
      </div>

      {/* ── Środowisko ── */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        <div className="px-4 py-3 md:px-6">
          <p className="text-sm font-semibold text-slate-900">Środowisko KSeF</p>
          <p className="text-xs text-slate-500">Demo i Produkcja wymagają certyfikatu kwalifikowanego.</p>
        </div>
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {envOptions.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 md:px-6',
                envSaving && 'pointer-events-none opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">{opt.label}</p>
                  <p className="text-xs text-slate-400">{opt.hint}</p>
                </div>
                <div className="relative group/tip">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 cursor-default select-none">i</span>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-1.5 opacity-0 transition-opacity group-hover/tip:pointer-events-auto group-hover/tip:opacity-100">
                    <div className="whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-white shadow-apple-md">
                      <a href={opt.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-200" onClick={(e) => e.stopPropagation()}>{opt.url}</a>
                    </div>
                  </div>
                </div>
              </div>
              <input
                type="radio"
                name="ksef_environment"
                value={opt.value}
                checked={currentEnv === opt.value}
                disabled={envSaving || !canManageInvoices}
                onChange={() => void onEnvChange(opt.value)}
                className="h-4 w-4 accent-primary"
              />
            </label>
          ))}
        </div>
      </section>

      {/* ── Certyfikat + Sesja dla wybranego środowiska ── */}
      <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
        {/* Nagłówek z chipem środowiska */}
        <div className="flex items-center gap-2.5 px-4 py-3 md:px-6">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Certyfikat i sesja
              <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {currentEnvLabel}
              </span>
            </p>
            <p className="text-xs text-slate-500">Klucz prywatny nigdy nie jest wyświetlany.</p>
          </div>
        </div>

        {/* Status certyfikatu */}
        <div className="border-t border-slate-100 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2.5">
            {status?.uploaded ? (
              <span className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white text-xs font-bold',
                status.valid ? 'bg-emerald-500' : 'bg-amber-400',
              )}>
                {status.valid ? '✓' : '!'}
              </span>
            ) : (
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-400 text-xs">—</span>
            )}
            <p className="text-sm font-medium text-slate-800">{status ? statusSummaryPl(status) : '—'}</p>
          </div>

          {status?.uploaded && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-400">Ważny od</dt>
                <dd className="font-medium text-slate-700">{formatPlDate(status.valid_from)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Ważny do</dt>
                <dd className="font-medium text-slate-700">{formatPlDate(status.valid_until)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-400">Podmiot</dt>
                <dd className="break-all font-medium text-slate-700">{status.subject_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Wgrano</dt>
                <dd className="font-medium text-slate-700">
                  {status.uploaded_at
                    ? new Date(status.uploaded_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {/* Sesja KSeF */}
        <div className="border-t border-slate-100 px-4 py-3 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', ksefSession?.active ? 'bg-emerald-500' : 'bg-slate-300')} aria-hidden />
              {ksefSession?.active ? (
                <span className="text-slate-700">
                  Sesja aktywna
                  {ksefSession.access_valid_until && (
                    <span className="ml-1 text-slate-400">
                      · do {new Date(ksefSession.access_valid_until).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-slate-400">Brak aktywnej sesji</span>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className={primaryBtnCls}
                disabled={!status?.valid || ksefAuthM.isPending || ksefClearM.isPending}
                onClick={() => { setKsefError(null); setKsefModalOpen(true); }}
              >
                {ksefAuthM.isPending ? 'Uwierzytelnianie…' : 'Uwierzytelnij'}
              </button>
              {ksefSession?.active && (
                <button type="button" className={quietBtnCls} disabled={ksefClearM.isPending} onClick={() => void onKsefClear()}>
                  {ksefClearM.isPending ? 'Czyszczenie…' : 'Wyczyść'}
                </button>
              )}
            </div>
          </div>
          {!status?.valid && status?.uploaded && (
            <p className="mt-2 text-xs text-amber-700">Certyfikat nieważny — uwierzytelnianie wyłączone.</p>
          )}
          {!status?.uploaded && (
            <p className="mt-2 text-xs text-slate-500">Najpierw wgraj certyfikat poniżej.</p>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-4 md:px-6">
          {feedback && (
            <p className={cn('mb-4 rounded-2xl border px-3 py-2 text-sm', feedback.type === 'ok' ? 'border-[#A5E1BD] bg-[#F0FDF4] text-emerald-900' : 'border-[#F2B6B6] bg-[#FEF2F2] text-red-700')} role="status">
              {feedback.text}
            </p>
          )}
          {status?.uploaded && !showUploadForm && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-[#F2F2F7] px-3 py-2.5">
                  <p className="text-xs text-slate-500">Plik certyfikatu</p>
                  <p className="mt-0.5 break-all text-sm font-medium text-slate-900">{savedFileLabel(status.certificate_filename)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-[#F2F2F7] px-3 py-2.5">
                  <p className="text-xs text-slate-500">Plik klucza prywatnego</p>
                  <p className="mt-0.5 break-all text-sm font-medium text-slate-900">{savedFileLabel(status.key_filename)}</p>
                </div>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={quietBtnCls}
                    disabled={busy}
                    onClick={() => {
                      setFeedback(null);
                      setCertFile(null);
                      setKeyFile(null);
                      setReplacing(true);
                    }}
                  >
                    Zamień pliki
                  </button>
                  <button
                    type="button"
                    className={dangerBtnCls}
                    disabled={busy}
                    onClick={() => {
                      setFeedback(null);
                      setDeleteOpen(true);
                    }}
                  >
                    Usuń certyfikat
                  </button>
                </div>
              )}
            </div>
          )}
          {showUploadForm && (
            <form className="space-y-3" onSubmit={onSubmit} noValidate>
              {replacing && (
                <p className="text-sm text-slate-600">
                  Wybierz nowy certyfikat i klucz. Obecne pliki zostaną zastąpione po wysłaniu.
                </p>
              )}
              <FilePick
                label="Certyfikat (.pem)"
                accept=".pem,.crt,.cer,application/x-x509-ca-cert"
                file={certFile}
                onChange={setCertFile}
                disabled={!canManage || busy}
              />
              <FilePick
                label="Klucz prywatny (.key / .pem)"
                accept=".key,.pem,application/x-pem-file,application/pkix-key"
                file={keyFile}
                onChange={setKeyFile}
                disabled={!canManage || busy}
              />
              {!canManage && (
                <p className="text-sm text-slate-500">
                  Nie masz uprawnień do zarządzania certyfikatem KSeF. Wymagane uprawnienie: Faktury.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryBtnCls} disabled={!canManage || busy}>
                  {uploadMut.isPending ? 'Wysyłanie…' : 'Wyślij certyfikat'}
                </button>
                {replacing && (
                  <button
                    type="button"
                    className={quietBtnCls}
                    disabled={busy}
                    onClick={() => {
                      setCertFile(null);
                      setKeyFile(null);
                      setReplacing(false);
                      setFeedback(null);
                    }}
                  >
                    Anuluj
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </section>

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
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-lg md:rounded-3xl"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                Usunąć certyfikat KSeF?
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Tej operacji nie można cofnąć. Aby ponownie korzystać z KSeF, będziesz musiał wgrać certyfikat ponownie.
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" className={quietBtnCls} onClick={closeDelete} disabled={deleteMut.isPending}>
                  Anuluj
                </button>
                <button
                  type="button"
                  className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void onConfirmDelete()}
                  disabled={deleteMut.isPending}
                >
                  {deleteMut.isPending ? 'Usuwanie…' : 'Usuń'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
    </div>
  );
}

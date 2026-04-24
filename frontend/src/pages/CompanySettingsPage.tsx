import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useResolvedCompanyId, type CompanyListRow } from '@/hooks/useResolvedCompanyId';
import { useCompanyModulesQuery, useToggleModuleMutation } from '@/query/use-companies';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MODULE_CARD_COPY, MODULE_DISPLAY_ORDER } from '@/constants/companyModuleLabels';
import { cn } from '@/lib/utils';
import type { Company, ModuleName } from '@/types';

type CompanyRow = Company & {
  postal_code?: string;
  created_at?: string;
  is_active?: boolean;
};

function pickCompanyField(c: (CompanyRow | CompanyListRow) | undefined, camel: string, snake: string): string {
  if (!c) return '—';
  const o = c as unknown as Record<string, unknown>;
  const v = o[camel] ?? o[snake];
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function ModuleSwitch({
  enabled,
  onToggle,
  disabled,
  id,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled: boolean;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        // Off: solid gray so the track is never “invisible”
        !enabled && 'border-slate-300 bg-slate-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] dark:border-slate-500 dark:bg-slate-600',
        // On: clear blue (not theme primary) so “active” is obvious
        enabled &&
          'border-blue-600 bg-blue-600 shadow-sm dark:border-sky-500 dark:bg-sky-600',
        !disabled && 'cursor-pointer',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 translate-x-0.5 transform rounded-full border-2 border-slate-300/90 bg-white shadow transition duration-200 ease-out',
          'dark:border-slate-400 dark:bg-slate-50',
          enabled && 'translate-x-6 border-white/90 shadow-md',
        )}
        aria-hidden
      />
    </button>
  );
}

type CompanySettingsModulesProps = {
  companyId: string;
  canChangeModules: boolean;
  onRefreshUser: () => Promise<void>;
  userRole: string | null | undefined;
};

function CompanySettingsModules({ companyId, canChangeModules, onRefreshUser, userRole }: CompanySettingsModulesProps) {
  const { data: modules, isPending: modulesPending, isError: modulesError } = useCompanyModulesQuery(companyId);
  const toggleModule = useToggleModuleMutation(companyId);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<ModuleName | null>(null);

  const moduleRows = useMemo(() => {
    return MODULE_DISPLAY_ORDER.map((module) => {
      const copy = MODULE_CARD_COPY[module];
      const row = modules?.find((m) => m.module === module);
      return {
        module,
        title: copy.title,
        description: copy.description,
        statusOn: copy.statusOn,
        statusOff: copy.statusOff,
        isEnabled: row?.isEnabled ?? false,
        enabledAt: row?.enabledAt ?? null,
      };
    });
  }, [modules]);

  const onToggle = async (module: ModuleName, next: boolean) => {
    if (!canChangeModules) return;
    setSaveError(null);
    setPendingKey(module);
    try {
      await toggleModule.mutateAsync({ module, enabled: next });
      await onRefreshUser();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać modułu');
    } finally {
      setPendingKey(null);
    }
  };

  if (modulesPending) {
    return <p className="text-sm text-muted-foreground">Ładowanie modułów…</p>;
  }

  return (
    <section aria-labelledby="modules-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="modules-heading" className="text-lg font-semibold">
            Moduły
          </h2>
          <p className="text-sm text-muted-foreground">
            {canChangeModules
              ? 'Włączaj lub wyłączaj moduły dla tej firmy (tylko rola: administrator).'
              : 'Tylko administrator może zmieniać moduły. Twoja rola: ' + (userRole ?? '—') + '.'}
          </p>
        </div>
      </div>

      {saveError && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {saveError}
        </p>
      )}

      {modulesError && (
        <p className="text-sm text-destructive" role="alert">
          Nie udało się wczytać listy modułów. Spróbuj ponownie później.
        </p>
      )}

      <ul className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
        {moduleRows.map((row) => {
          const offVisual = !row.isEnabled;
          const switchDisabled = !canChangeModules || pendingKey !== null;
          return (
            <li key={row.module}>
              <Card
                className={cn('h-full transition-colors', offVisual && 'bg-muted/50 text-muted-foreground shadow-none')}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base leading-snug">{row.title}</CardTitle>
                    <CardDescription
                      className={cn('mt-1.5 text-xs leading-relaxed sm:text-sm', offVisual && 'text-muted-foreground/90')}
                    >
                      {row.description}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">{row.isEnabled ? row.statusOn : row.statusOff}</span>
                    <ModuleSwitch
                      id={`module-${row.module}`}
                      enabled={row.isEnabled}
                      disabled={switchDisabled}
                      onToggle={() => void onToggle(row.module, !row.isEnabled)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  {row.enabledAt ? `Włączono: ${new Date(row.enabledAt).toLocaleString('pl-PL')}` : '—'}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CompanySettingsPage() {
  const { user, refreshUser } = useAuth();
  const resolved = useResolvedCompanyId();

  const canChangeModules = user?.current_company_role === 'admin';

  if (resolved.state === 'loading') {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      </div>
    );
  }

  if (resolved.state === 'no_companies') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">
          Nie należysz do żadnej firmy lub profil /me jeszcze się nie zaktualizował. Odśwież dane użytkownika.
        </p>
        <Button type="button" className="mt-4" variant="outline" onClick={() => void refreshUser()}>
          Odśwież dane użytkownika
        </Button>
      </div>
    );
  }

  if (resolved.state !== 'ready') {
    return null;
  }

  const { companyId, company: currentCompany, isUnsynced } = resolved;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ustawienia firmy</h1>
        <p className="text-sm text-muted-foreground">
          Dane organizacji i moduły bieżącej firmy.{' '}
          <Link to="/settings/company-data" className="font-medium text-primary underline-offset-4 hover:underline">
            Edytuj dane rejestrowe
          </Link>
        </p>
        {isUnsynced && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm" role="status">
            Profil użytkownika nie ma jeszcze ustawionej bieżącej firmy (current_company) — poniżej: pierwsza z listy. Po
            połączeniu zostanie zsynchronizowane.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bieżąca firma</CardTitle>
          <CardDescription>Dane rejestrowe i kontakt (z API).</CardDescription>
        </CardHeader>
        <CardContent>
          {currentCompany ? (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Nazwa</dt>
                <dd className="font-medium">{currentCompany.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">NIP</dt>
                <dd>{pickCompanyField(currentCompany, 'nip', 'nip')}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Adres</dt>
                <dd>
                  {pickCompanyField(currentCompany, 'address', 'address')},{' '}
                  {pickCompanyField(currentCompany, 'postalCode', 'postal_code')}{' '}
                  {pickCompanyField(currentCompany, 'city', 'city')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Telefon</dt>
                <dd>{pickCompanyField(currentCompany, 'phone', 'phone')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{pickCompanyField(currentCompany, 'email', 'email')}</dd>
              </div>
              {user?.current_company_role && (
                <div>
                  <dt className="text-muted-foreground">Twoja rola</dt>
                  <dd className="font-medium">{user.current_company_role}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Nie znaleziono danych firmy na liście członkostw.</p>
          )}
        </CardContent>
      </Card>

      <CompanySettingsModules
        companyId={companyId}
        canChangeModules={canChangeModules}
        onRefreshUser={refreshUser}
        userRole={user?.current_company_role}
      />
    </div>
  );
}

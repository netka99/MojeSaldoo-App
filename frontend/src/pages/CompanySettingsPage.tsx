import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { useResolvedCompanyId, type CompanyListRow } from '@/hooks/useResolvedCompanyId';
import { useCompanyModulesQuery, useToggleModuleMutation, useWorkflowSettingsQuery, useUpdateWorkflowSettingsMutation, useDeleteCompanyMutation, useLeaveCompanyMutation, useUpdateCompanyMutation } from '@/query/use-companies';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MODULE_CARD_COPY, MODULE_DISPLAY_ORDER } from '@/constants/companyModuleLabels';
import { cn } from '@/lib/utils';
import type { Company, ModuleName } from '@/types';
import type { RyczaltCategory, TaxationForm } from '@/types/onboarding.types';

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
          'inline-block h-5 w-5 translate-x-0.5 transform rounded-full border-2 border-slate-300/90 bg-surface-card shadow transition duration-200 ease-out',
          'dark:border-slate-400 dark:bg-slate-50',
          enabled && 'translate-x-6 border-white/90 shadow-md',
        )}
        aria-hidden
      />
    </button>
  );
}

/* ─── Collapsible settings group ──────────────────────────────────────── */

function SettingsGroup({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={open}
      >
        <div>
          <p className="text-base font-semibold">{title}</p>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <svg
          className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

function SettingsGroupItem({ children }: { children: ReactNode }) {
  return <div className="px-6 py-5">{children}</div>;
}

/* ─── End collapsible settings group ──────────────────────────────────── */

type KsefUsage = 'mandatory' | 'voluntary' | 'exempt' | 'none';

const KSEF_USAGE_OPTIONS: { value: KsefUsage; label: string; sub: string }[] = [
  { value: 'mandatory', label: 'Obowiązkowy KSeF',  sub: 'Obrót ≥ 200 tys. PLN/rok lub po obowiązku ustawowym' },
  { value: 'voluntary', label: 'Dobrowolny KSeF',   sub: 'Używam z własnej woli, bez ustawowego obowiązku' },
  { value: 'exempt',    label: 'Zwolniony z KSeF',  sub: 'Rolnik ryczałtowy, podmiot zagraniczny lub obrót poniżej progu' },
];

type CompanySettingsModulesProps = {
  companyId: string;
  canChangeModules: boolean;
  onRefreshUser: () => Promise<void>;
  userRole: string | null | undefined;
  currentKsefUsage?: KsefUsage | null;
};

function CompanySettingsModules({ companyId, canChangeModules, onRefreshUser, userRole, currentKsefUsage }: CompanySettingsModulesProps) {
  const { data: modules, isPending: modulesPending, isError: modulesError } = useCompanyModulesQuery(companyId);
  const toggleModule = useToggleModuleMutation(companyId);
  const updateCompany = useUpdateCompanyMutation();

  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<ModuleName | null>(null);
  const [ksefUsage, setKsefUsage] = useState<KsefUsage>(
    currentKsefUsage && currentKsefUsage !== 'none' ? currentKsefUsage : 'mandatory'
  );
  const [ksefUsageSaving, setKsefUsageSaving] = useState(false);

  // sync if parent re-fetches user
  useEffect(() => {
    if (currentKsefUsage && currentKsefUsage !== 'none') setKsefUsage(currentKsefUsage);
  }, [currentKsefUsage]);

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
      // Sync ksef_usage with module state
      if (module === 'ksef') {
        const usageToSave = next ? ksefUsage : 'none';
        await updateCompany.mutateAsync({ companyId, data: { name: '', ksef_usage: usageToSave } });
      }
      await onRefreshUser();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać modułu');
    } finally {
      setPendingKey(null);
    }
  };

  const saveKsefUsage = async (value: KsefUsage) => {
    setKsefUsage(value);
    setKsefUsageSaving(true);
    try {
      await updateCompany.mutateAsync({ companyId, data: { name: '', ksef_usage: value } });
      await onRefreshUser();
    } catch {
      // revert on error
      setKsefUsage(currentKsefUsage && currentKsefUsage !== 'none' ? currentKsefUsage : 'mandatory');
    } finally {
      setKsefUsageSaving(false);
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
          const isKsef = row.module === 'ksef';
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

                  {/* KSeF usage — rozwijane gdy moduł jest włączony */}
                  {isKsef && row.isEnabled && (
                    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                      <p className={cn('mb-2 text-[11px] font-semibold uppercase tracking-wide', ksefUsageSaving && 'opacity-50')}>
                        Tryb użycia KSeF
                      </p>
                      {KSEF_USAGE_OPTIONS.map(opt => (
                        <label
                          key={opt.value}
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors text-foreground',
                            ksefUsage === opt.value
                              ? 'border-primary/50 bg-primary/5'
                              : 'border-border hover:bg-muted/60',
                            (!canChangeModules || ksefUsageSaving) && 'pointer-events-none opacity-50',
                          )}
                        >
                          <input
                            type="radio"
                            name="ksef_usage"
                            value={opt.value}
                            checked={ksefUsage === opt.value}
                            disabled={!canChangeModules || ksefUsageSaving}
                            onChange={() => void saveKsefUsage(opt.value)}
                            className="mt-0.5 h-3.5 w-3.5 accent-primary shrink-0"
                          />
                          <div>
                            <p className="text-xs font-medium leading-tight">{opt.label}</p>
                            <p className="text-[10px] text-muted-foreground leading-snug">{opt.sub}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  {isKsef && !row.isEnabled && (
                    <p className="mt-2 text-[11px] text-muted-foreground/70">
                      Włącz moduł, aby skonfigurować tryb KSeF.
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type WorkflowSettingsSectionProps = {
  companyId: string;
  canEdit: boolean;
};

function WorkflowSettingsSection({ companyId, canEdit }: WorkflowSettingsSectionProps) {
  const { data: settings, isPending, isError } = useWorkflowSettingsQuery(companyId);
  const updateMutation = useUpdateWorkflowSettingsMutation(companyId);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggle = async (field: 'orders_required' | 'wz_required_before_invoice', next: boolean) => {
    if (!canEdit) return;
    setSaveError(null);
    try {
      await updateMutation.mutateAsync({ [field]: next });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać ustawień');
    }
  };

  const rows: { field: 'orders_required' | 'wz_required_before_invoice'; title: string; description: string }[] = [
    {
      field: 'orders_required',
      title: 'Wymagaj zamówienia przed WZ',
      description:
        'Gdy włączone, dokument WZ można wystawić tylko powiązany z zamówieniem. Przy wyłączonej opcji WZ możliwe jest jako samodzielny dokument (np. próbka, prezent).',
    },
    {
      field: 'wz_required_before_invoice',
      title: 'Wymagaj WZ przed fakturą',
      description:
        'Gdy włączone, faktura może być wystawiona dopiero po zatwierdzeniu dokumentu WZ (wydania towaru) dla danego zamówienia. Gdy wyłączone, fakturę można wystawić bezpośrednio z zamówienia.',
    },
  ];

  return (
    <section aria-labelledby="workflow-heading" className="space-y-3">
      <div>
        <h2 id="workflow-heading" className="text-lg font-semibold">
          Przepływ dokumentów
        </h2>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Konfiguracja wymagań dotyczących obiegu dokumentów w firmie.'
            : 'Tylko administrator lub manager może zmieniać te ustawienia.'}
        </p>
      </div>

      {saveError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      {isError && (
        <p className="text-sm text-destructive" role="alert">
          Nie udało się wczytać ustawień przepływu dokumentów.
        </p>
      )}

      {isPending ? (
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {rows.map((row) => {
            const enabled = settings?.[row.field] ?? false;
            const disabled = !canEdit || updateMutation.isPending;
            return (
              <li key={row.field}>
                <Card className={cn('h-full transition-colors', !enabled && 'bg-muted/50 shadow-none')}>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-snug">{row.title}</CardTitle>
                      <CardDescription className={cn('mt-1.5 text-xs leading-relaxed sm:text-sm', !enabled && 'text-muted-foreground/90')}>
                        {row.description}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">{enabled ? 'Włączone' : 'Wyłączone'}</span>
                      <ModuleSwitch
                        id={`workflow-${row.field}`}
                        enabled={enabled}
                        disabled={disabled}
                        onToggle={() => void toggle(row.field, !enabled)}
                      />
                    </div>
                  </CardHeader>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Price Input Mode Section
// ---------------------------------------------------------------------------

type PriceInputMode = 'net' | 'gross';

const PRICE_INPUT_OPTIONS: { value: PriceInputMode; title: string; description: string }[] = [
  {
    value: 'net',
    title: 'Ceny netto',
    description: 'Wprowadzasz ceny bez VAT (standard B2B). Brutto jest wyliczane automatycznie: netto × (1 + VAT%).',
  },
  {
    value: 'gross',
    title: 'Ceny brutto',
    description: 'Wprowadzasz ceny końcowe z VAT (detaliczne, np. 6,00 zł). Netto jest wyliczane automatycznie: brutto ÷ (1 + VAT%).',
  },
];

type PriceInputSectionProps = {
  companyId: string;
  currentMode: PriceInputMode | undefined;
  canEdit: boolean;
  onSaved: () => Promise<void>;
};

function PriceInputModeSection({ companyId, currentMode, canEdit, onSaved }: PriceInputSectionProps) {
  const updateCompany = useUpdateCompanyMutation();
  const [mode, setMode] = useState<PriceInputMode>(currentMode ?? 'net');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (currentMode) setMode(currentMode);
  }, [currentMode]);

  const saveMode = async (value: PriceInputMode) => {
    if (!canEdit) return;
    setMode(value);
    setSaving(true);
    setSaveError(null);
    try {
      await updateCompany.mutateAsync({ companyId, data: { name: '', price_input_mode: value } });
      await onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać');
      setMode(currentMode ?? 'net');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Sposób wprowadzania cen</h3>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Czy firma pracuje na cenach netto czy brutto. Wpływa na obliczenia na fakturach i zamówieniach.'
            : 'Tylko administrator może zmieniać te ustawienia.'}
        </p>
      </div>

      {saveError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {PRICE_INPUT_OPTIONS.map((opt) => {
          const selected = mode === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                disabled={!canEdit || saving}
                onClick={() => void saveMode(opt.value)}
                className={cn(
                  'w-full rounded-xl border-2 p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-background hover:border-primary/40',
                  (!canEdit || saving) && 'cursor-not-allowed opacity-60',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary' : 'border-border',
                  )}>
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{opt.title}</span>
                </div>
                <p className="ml-6 text-xs leading-relaxed text-muted-foreground">{opt.description}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Returns Mode Section
// ---------------------------------------------------------------------------

type InvoiceReturnsMode = 'fv_kor' | 'net_qty' | 'lines';

const RETURNS_MODE_OPTIONS: { value: InvoiceReturnsMode; title: string; description: string }[] = [
  {
    value: 'fv_kor',
    title: 'Oddzielna korekta FV-KOR',
    description: 'Zwroty są obsługiwane jako osobna faktura korygująca. Domyślne zachowanie.',
  },
  {
    value: 'net_qty',
    title: 'Netto w ilości',
    description: 'Przy fakturowaniu dostarczona ilość jest automatycznie pomniejszana o zwroty (dostarczone − zwroty).',
  },
  {
    value: 'lines',
    title: 'Osobna linia ze zwrotem',
    description: 'Zwrot pojawia się jako ujemna pozycja na tej samej fakturze.',
  },
];

type InvoiceReturnsSectionProps = {
  companyId: string;
  currentMode: InvoiceReturnsMode | undefined;
  canEdit: boolean;
  onSaved: () => Promise<void>;
};

function InvoiceReturnsSection({ companyId, currentMode, canEdit, onSaved }: InvoiceReturnsSectionProps) {
  const updateCompany = useUpdateCompanyMutation();
  const [mode, setMode] = useState<InvoiceReturnsMode>(currentMode ?? 'fv_kor');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (currentMode) setMode(currentMode);
  }, [currentMode]);

  const saveMode = async (value: InvoiceReturnsMode) => {
    if (!canEdit) return;
    setMode(value);
    setSaving(true);
    setSaveError(null);
    try {
      await updateCompany.mutateAsync({ companyId, data: { name: '', invoice_returns_mode: value } });
      await onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać');
      setMode(currentMode ?? 'fv_kor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Fakturowanie zwrotów</h3>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Sposób ujmowania zwrotów towarów na fakturach sprzedaży.'
            : 'Tylko administrator może zmieniać te ustawienia.'}
        </p>
      </div>

      {saveError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-1 lg:grid-cols-3">
        {RETURNS_MODE_OPTIONS.map((opt) => {
          const selected = mode === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                disabled={!canEdit || saving}
                onClick={() => void saveMode(opt.value)}
                className={cn(
                  'w-full rounded-xl border-2 p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-background hover:border-primary/40',
                  (!canEdit || saving) && 'cursor-not-allowed opacity-60',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary' : 'border-border',
                  )}>
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{opt.title}</span>
                </div>
                <p className="ml-6 text-xs leading-relaxed text-muted-foreground">{opt.description}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Numbering Section
// ---------------------------------------------------------------------------

type InvoiceNumberingPeriod = 'yearly' | 'monthly';

function buildInvoicePreview(
  prefix: string,
  period: InvoiceNumberingPeriod,
  padding: number,
  start: number,
): string {
  const safePrefix = (prefix || 'FV').trim();
  const safePadding = Math.max(1, Math.min(padding || 4, 8));
  const y = 2026;
  const mo = 9;
  const seq = String(start || 1).padStart(safePadding, '0');
  const datePart = period === 'monthly' ? `${y}/${String(mo).padStart(2, '0')}` : String(y);
  return `${safePrefix}/${datePart}/${seq}`;
}

type InvoiceNumberingSectionProps = {
  companyId: string;
  company: CompanyRow | CompanyListRow | undefined;
  canEdit: boolean;
  onSaved: () => Promise<void>;
};

function InvoiceNumberingSection({ companyId, company, canEdit, onSaved }: InvoiceNumberingSectionProps) {
  const updateCompany = useUpdateCompanyMutation();
  const c = company as CompanyRow | undefined;

  const [prefix, setPrefix] = useState<string>(c?.invoice_number_prefix ?? 'FV');
  const [period, setPeriod] = useState<InvoiceNumberingPeriod>(
    (c?.invoice_number_period as InvoiceNumberingPeriod) ?? 'yearly',
  );
  const [padding, setPadding] = useState<number>(c?.invoice_number_padding ?? 4);
  const [startNum, setStartNum] = useState<number>(c?.invoice_number_start ?? 1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sync when parent re-fetches
  useEffect(() => {
    if (c?.invoice_number_prefix != null) setPrefix(c.invoice_number_prefix);
    if (c?.invoice_number_period != null) setPeriod(c.invoice_number_period as InvoiceNumberingPeriod);
    if (c?.invoice_number_padding != null) setPadding(c.invoice_number_padding);
    if (c?.invoice_number_start != null) setStartNum(c.invoice_number_start);
  }, [c]);

  const preview = buildInvoicePreview(prefix, period, padding, startNum);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateCompany.mutateAsync({
        companyId,
        data: {
          name: '',
          invoice_number_prefix: prefix.trim() || 'FV',
          invoice_number_period: period,
          invoice_number_padding: padding,
          invoice_number_start: startNum,
        },
      });
      await onSaved();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Numeracja faktur</h3>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Format numeru faktury generowanego automatycznie przez system.'
            : 'Tylko administrator może zmieniać te ustawienia.'}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          {/* Prefix */}
          <div className="space-y-1.5">
            <label htmlFor="inv-prefix" className="text-sm font-medium text-foreground">
              Prefiks (np. FV, VAT, MK)
            </label>
            <input
              id="inv-prefix"
              type="text"
              value={prefix}
              disabled={!canEdit}
              maxLength={10}
              onChange={(e) => { setPrefix(e.target.value); setSaved(false); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="FV"
            />
          </div>

          {/* Period */}
          <div className="space-y-1.5">
            <label htmlFor="inv-period" className="text-sm font-medium text-foreground">
              Okres numeracji
            </label>
            <select
              id="inv-period"
              value={period}
              disabled={!canEdit}
              onChange={(e) => { setPeriod(e.target.value as InvoiceNumberingPeriod); setSaved(false); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="yearly">Roczna (FV/2026/001)</option>
              <option value="monthly">Miesięczna (FV/2026/09/001)</option>
            </select>
          </div>

          {/* Padding */}
          <div className="space-y-1.5">
            <label htmlFor="inv-padding" className="text-sm font-medium text-foreground">
              Liczba cyfr (np. 4 → 0001)
            </label>
            <input
              id="inv-padding"
              type="number"
              value={padding}
              disabled={!canEdit}
              min={1}
              max={8}
              onChange={(e) => { setPadding(Math.max(1, Math.min(8, Number(e.target.value) || 4))); setSaved(false); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {/* Start number */}
          <div className="space-y-1.5">
            <label htmlFor="inv-start" className="text-sm font-medium text-foreground">
              Numer pierwszej faktury
            </label>
            <input
              id="inv-start"
              type="number"
              value={startNum}
              disabled={!canEdit}
              min={1}
              onChange={(e) => { setStartNum(Math.max(1, Number(e.target.value) || 1)); setSaved(false); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-xs text-muted-foreground">
              Dotyczy tylko pierwszej faktury w danym roku/miesiącu.
            </p>
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Podgląd</p>
            <p className="mt-1 text-base font-mono font-semibold text-foreground">{preview}</p>
          </div>

          {saveError && (
            <p className="text-sm text-destructive" role="alert">{saveError}</p>
          )}
          {saved && (
            <p className="text-sm text-green-600" role="status">Zapisano.</p>
          )}

          {canEdit && (
            <Button
              type="button"
              disabled={saving || updateCompany.isPending}
              onClick={() => void handleSave()}
            >
              {saving ? 'Zapisywanie…' : 'Zapisz'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank Account Section
// ---------------------------------------------------------------------------

type BankAccountSectionProps = {
  companyId: string;
  company: CompanyRow | CompanyListRow | undefined;
  canEdit: boolean;
  onSaved: () => Promise<void>;
};

function BankAccountSection({ companyId, company, canEdit, onSaved }: BankAccountSectionProps) {
  const updateCompany = useUpdateCompanyMutation();

  const [iban, setIban] = useState<string>(company?.bank_account_iban ?? '');
  const [swift, setSwift] = useState<string>(company?.bank_swift ?? '');
  const [bankName, setBankName] = useState<string>(company?.bank_name ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (company?.bank_account_iban != null) setIban(company.bank_account_iban);
    if (company?.bank_swift != null) setSwift(company.bank_swift);
    if (company?.bank_name != null) setBankName(company.bank_name);
  }, [company]);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateCompany.mutateAsync({
        companyId,
        data: {
          name: '',
          bank_account_iban: iban.trim(),
          bank_swift: swift.trim(),
          bank_name: bankName.trim(),
        },
      });
      await onSaved();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Konto bankowe</h3>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Dane rachunku bankowego drukowane na fakturach.'
            : 'Tylko administrator może zmieniać te ustawienia.'}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="space-y-1.5">
            <label htmlFor="bank-iban" className="text-sm font-medium text-foreground">
              Numer rachunku (IBAN)
            </label>
            <input
              id="bank-iban"
              type="text"
              value={iban}
              disabled={!canEdit}
              maxLength={34}
              onChange={(e) => { setIban(e.target.value); setSaved(false); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="PL00 0000 0000 0000 0000 0000 0000"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="bank-swift" className="text-sm font-medium text-foreground">
                SWIFT / BIC
              </label>
              <input
                id="bank-swift"
                type="text"
                value={swift}
                disabled={!canEdit}
                maxLength={11}
                onChange={(e) => { setSwift(e.target.value.toUpperCase()); setSaved(false); }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="XXXXXXXX"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bank-name" className="text-sm font-medium text-foreground">
                Nazwa banku
              </label>
              <input
                id="bank-name"
                type="text"
                value={bankName}
                disabled={!canEdit}
                maxLength={100}
                onChange={(e) => { setBankName(e.target.value); setSaved(false); }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Nazwa banku"
              />
            </div>
          </div>

          {saveError && (
            <p className="text-sm text-destructive" role="alert">{saveError}</p>
          )}
          {saved && (
            <p className="text-sm text-green-600" role="status">Zapisano.</p>
          )}

          {canEdit && (
            <Button
              type="button"
              disabled={saving || updateCompany.isPending}
              onClick={() => void handleSave()}
            >
              {saving ? 'Zapisywanie…' : 'Zapisz'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete Company Dialog
// ---------------------------------------------------------------------------

function DeleteCompanyDialog({
  companyId,
  companyName,
  onSuccess,
}: {
  companyId: string;
  companyName: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deleteMutation = useDeleteCompanyMutation();

  const confirmed = inputValue === companyName;

  const handleOpen = () => {
    setInputValue('');
    setError(null);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleConfirm = async () => {
    if (!confirmed) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync({ companyId, confirmName: inputValue });
      setOpen(false);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się usunąć firmy');
    }
  };

  if (!open) {
    return (
      <Button type="button" variant="destructive" onClick={handleOpen}>
        Usuń firmę
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg border bg-surface-card p-6 shadow-xl">
        <h2 id="delete-dialog-title" className="text-lg font-semibold text-destructive">
          Usuń firmę
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ta operacja jest <strong>nieodwracalna</strong>. Dane podatkowe (faktury, WZ, PZ) zostaną zachowane zgodnie
          z wymogami prawa przez 5 lat, ale dostęp do firmy zostanie trwale usunięty.
        </p>
        <p className="mt-3 text-sm">
          Wpisz nazwę firmy, żeby potwierdzić:{' '}
          <strong className="font-semibold">{companyName}</strong>
        </p>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Wpisz nazwę firmy"
          className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive"
          aria-label="Potwierdź nazwę firmy"
        />
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={deleteMutation.isPending}
          >
            Anuluj
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={!confirmed || deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Usuwanie…' : 'Usuń firmę'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leave Company Dialog
// ---------------------------------------------------------------------------

function LeaveCompanyDialog({
  companyId,
  onSuccess,
}: {
  companyId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaveMutation = useLeaveCompanyMutation();

  const handleConfirm = async () => {
    setError(null);
    try {
      await leaveMutation.mutateAsync(companyId);
      setOpen(false);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się opuścić firmy');
    }
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Opuść firmę
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg border bg-surface-card p-6 shadow-xl">
        <h2 id="leave-dialog-title" className="text-lg font-semibold">
          Opuść firmę
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Czy na pewno chcesz opuścić tę firmę? Stracisz dostęp do wszystkich jej danych.
        </p>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={leaveMutation.isPending}
          >
            Anuluj
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={leaveMutation.isPending}
          >
            {leaveMutation.isPending ? 'Opuszczanie…' : 'Opuść firmę'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxation Settings Section
// ---------------------------------------------------------------------------

const RYCZALT_CATEGORY_LABELS: Record<RyczaltCategory, string> = {
  rolnicze:     '2% — Sprzedaż produktów rolnych',
  handel:       '3% — Handel (zakup i odsprzedaż)',
  budownictwo:  '5,5% — Budownictwo',
  uslugi:       '8,5% — Usługi',
  it:           '12% — Usługi IT i pośrednictwo finansowe',
  medyczne:     '14% — Usługi medyczne, architektoniczne, inżynieryjne',
  finansowe:    '15% — Doradztwo finansowe i rachunkowość',
  wolne_zawody: '17% — Wolne zawody (prawnicy, lekarze itp.)',
};

function TaxationSettingsSection({
  companyId,
  currentTaxationForm,
  currentRyczaltCategory,
  canEdit,
  onSaved,
}: {
  companyId: string;
  currentTaxationForm: string | null | undefined;
  currentRyczaltCategory: string | null | undefined;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const updateMutation = useUpdateCompanyMutation();
  const [taxationForm, setTaxationForm] = useState<TaxationForm>(
    (currentTaxationForm as TaxationForm) ?? 'kpir',
  );
  const [ryczaltCategory, setRyczaltCategory] = useState<RyczaltCategory | null>(
    (currentRyczaltCategory as RyczaltCategory) ?? null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSave =
    taxationForm === 'kpir' || (taxationForm === 'ryczalt' && ryczaltCategory !== null);

  const handleSave = async () => {
    if (!canEdit || !canSave) return;
    setSaveError(null);
    setSaved(false);
    try {
      await updateMutation.mutateAsync({
        companyId,
        data: {
          name: '',  // required by type but backend accepts partial patch
          taxation_form: taxationForm,
          ryczalt_category: taxationForm === 'ryczalt' ? ryczaltCategory : null,
        },
      });
      await onSaved();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <section aria-labelledby="taxation-heading" className="space-y-3">
      <div>
        <h2 id="taxation-heading" className="text-lg font-semibold">
          Forma opodatkowania
        </h2>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Wpływa na dostępne raporty JPK.'
            : 'Tylko administrator może zmieniać ustawienia opodatkowania.'}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          {/* KPiR / Ryczałt */}
          <div className="grid grid-cols-2 gap-3">
            {(['kpir', 'ryczalt'] as TaxationForm[]).map((form) => (
              <button
                key={form}
                type="button"
                disabled={!canEdit}
                onClick={() => { setTaxationForm(form); if (form === 'kpir') setRyczaltCategory(null); setSaved(false); }}
                aria-pressed={taxationForm === form}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  taxationForm === form
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-background hover:border-primary/40 hover:bg-muted/40',
                  !canEdit && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="text-2xl leading-none">{form === 'kpir' ? '📒' : '🧾'}</span>
                <p className="text-sm font-semibold text-foreground">
                  {form === 'kpir' ? 'KPiR' : 'Ryczałt'}
                </p>
                <p className="text-xs leading-snug text-muted-foreground">
                  {form === 'kpir'
                    ? 'Podatkowa Księga Przychodów i Rozchodów'
                    : 'Ryczałt ewidencjonowany'}
                </p>
              </button>
            ))}
          </div>

          {/* Ryczałt rate */}
          {taxationForm === 'ryczalt' && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Stawka ryczałtu</p>
              <select
                value={ryczaltCategory ?? ''}
                disabled={!canEdit}
                onChange={(e) => { setRyczaltCategory(e.target.value as RyczaltCategory); setSaved(false); }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="" disabled>Wybierz stawkę…</option>
                {(Object.keys(RYCZALT_CATEGORY_LABELS) as RyczaltCategory[]).map((cat) => (
                  <option key={cat} value={cat}>{RYCZALT_CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </div>
          )}

          {saveError && (
            <p className="text-sm text-destructive" role="alert">{saveError}</p>
          )}
          {saved && (
            <p className="text-sm text-green-600" role="status">Zapisano.</p>
          )}

          {canEdit && (
            <Button
              type="button"
              disabled={!canSave || updateMutation.isPending}
              onClick={() => void handleSave()}
            >
              {updateMutation.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// VAT Settings Section
// ---------------------------------------------------------------------------

function VatSettingsSection({
  companyId,
  currentIsVatPayer,
  canEdit,
  onSaved,
}: {
  companyId: string;
  currentIsVatPayer: boolean;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const updateMutation = useUpdateCompanyMutation();
  const [isVatPayer, setIsVatPayer] = useState(currentIsVatPayer);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveError(null);
    setSaved(false);
    try {
      await updateMutation.mutateAsync({ companyId, data: { name: '', is_vat_payer: isVatPayer } });
      await onSaved();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">VAT</h2>
        <p className="text-sm text-muted-foreground">Wpływa na wyświetlanie podziału VAT w raportach sprzedaży.</p>
      </div>
      <Card>
        <CardContent className="pt-5 space-y-4">
          <label className={cn('flex cursor-pointer items-center gap-3', !canEdit && 'cursor-not-allowed opacity-60')}>
            <input
              type="checkbox"
              checked={isVatPayer}
              disabled={!canEdit}
              onChange={(e) => { setIsVatPayer(e.target.checked); setSaved(false); }}
              className="h-4 w-4 rounded border-input"
            />
            <div>
              <p className="text-sm font-medium">Czynny podatnik VAT</p>
              <p className="text-xs text-muted-foreground">Zaznacz jeśli firma jest zarejestrowana jako płatnik VAT</p>
            </div>
          </label>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          {saved && <p className="text-sm text-green-600">Zapisano.</p>}
          {canEdit && (
            <Button size="sm" onClick={handleSave} loading={updateMutation.isPending}>
              Zapisz
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Danger Zone Section
// ---------------------------------------------------------------------------

function DangerZoneSection({
  companyId,
  companyName,
  isAdmin,
  onDone,
}: {
  companyId: string;
  companyName: string;
  isAdmin: boolean;
  onDone: () => void;
}) {
  return (
    <section aria-labelledby="danger-zone-heading" className="space-y-3">
      <div>
        <h2 id="danger-zone-heading" className="text-lg font-semibold text-destructive">
          Strefa niebezpieczna
        </h2>
        <p className="text-sm text-muted-foreground">Poniższe akcje są nieodwracalne.</p>
      </div>
      <Card className="border-destructive/40">
        <CardContent className="flex flex-wrap gap-3 pt-5">
          <LeaveCompanyDialog companyId={companyId} onSuccess={onDone} />
          {isAdmin && (
            <DeleteCompanyDialog
              companyId={companyId}
              companyName={companyName}
              onSuccess={onDone}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function CompanySettingsPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const resolved = useResolvedCompanyId();
  const ksefEnabled = useModuleGuard('ksef');

  const canChangeModules = user?.is_company_admin === true;

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
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Ustawienia firmy</h1>
        <p className="text-sm text-muted-foreground">
          Dane organizacji i moduły bieżącej firmy.{' '}
          <Link to="/settings/company-data" className="font-medium text-primary underline-offset-4 hover:underline">
            Edytuj dane rejestrowe
          </Link>
          {ksefEnabled && (
            <>
              {' · '}
              <Link
                to="/settings/certificate"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Certyfikat KSeF
              </Link>
            </>
          )}
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
        currentKsefUsage={user?.ksef_usage}
      />

      <WorkflowSettingsSection
        companyId={companyId}
        canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
      />

      <TaxationSettingsSection
        companyId={companyId}
        currentTaxationForm={user?.taxation_form}
        currentRyczaltCategory={user?.ryczalt_category}
        canEdit={user?.is_company_admin === true}
        onSaved={refreshUser}
      />

      <VatSettingsSection
        companyId={companyId}
        currentIsVatPayer={user?.is_vat_payer ?? false}
        canEdit={user?.is_company_admin === true}
        onSaved={refreshUser}
      />

      <SettingsGroup
        title="Faktury"
        description="Numeracja, ceny, zwroty i inne ustawienia fakturowania."
      >
        <SettingsGroupItem>
          <PriceInputModeSection
            companyId={companyId}
            currentMode={user?.price_input_mode ?? undefined}
            canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
            onSaved={refreshUser}
          />
        </SettingsGroupItem>
        <SettingsGroupItem>
          <InvoiceReturnsSection
            companyId={companyId}
            currentMode={currentCompany?.invoice_returns_mode}
            canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
            onSaved={refreshUser}
          />
        </SettingsGroupItem>
        <SettingsGroupItem>
          <InvoiceNumberingSection
            companyId={companyId}
            company={currentCompany}
            canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
            onSaved={refreshUser}
          />
        </SettingsGroupItem>
        <SettingsGroupItem>
          <BankAccountSection
            companyId={companyId}
            company={currentCompany}
            canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
            onSaved={refreshUser}
          />
        </SettingsGroupItem>
      </SettingsGroup>

      <DangerZoneSection
        companyId={companyId}
        companyName={currentCompany?.name ?? ''}
        isAdmin={user?.is_company_admin === true}
        onDone={async () => {
          await refreshUser();
          navigate('/');
        }}
      />
    </div>
  );
}

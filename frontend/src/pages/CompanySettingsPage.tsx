import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useResolvedCompanyId, type CompanyListRow } from '@/hooks/useResolvedCompanyId';
import { useCompanyModulesQuery, useToggleModuleMutation, useWorkflowSettingsQuery, useUpdateWorkflowSettingsMutation, useDeleteCompanyMutation, useLeaveCompanyMutation, useUpdateCompanyMutation } from '@/query/use-companies';
import { MODULE_CARD_COPY, MODULE_DISPLAY_ORDER } from '@/constants/companyModuleLabels';
import { cn } from '@/lib/utils';

const cardCls = 'rounded-2xl border border-slate-200 bg-white md:rounded-3xl';
const primaryBtnCls =
  'rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50';
const quietBtnCls =
  'rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const fieldLabelCls = 'mb-1.5 block text-sm font-medium text-slate-800';
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

function companyText(c: (CompanyRow | CompanyListRow) | undefined, camel: string, snake: string): string | null {
  if (!c) return null;
  const o = c as unknown as Record<string, unknown>;
  const v = o[camel] ?? o[snake];
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return String(v).trim();
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2',
        !enabled && 'border-slate-300 bg-slate-200',
        enabled && 'border-primary bg-primary',
        !disabled && 'cursor-pointer',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 translate-x-0.5 transform rounded-full border-2 border-white bg-white transition duration-200 ease-out',
          enabled && 'translate-x-6',
        )}
        aria-hidden
      />
    </button>
  );
}

function TopicHeading({
  id,
  title,
  hint,
  level = 2,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Title = level === 3 ? 'h3' : 'h2';
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
        {children}
      </span>
      <div>
        <Title id={id} className="text-sm font-semibold text-slate-900">{title}</Title>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function HeadingGlyph({ children }: { children: ReactNode }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      {children}
    </svg>
  );
}

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
    <section aria-labelledby="modules-heading" className="flex flex-col gap-3">
      <TopicHeading
        id="modules-heading"
        title="Moduły"
        hint={canChangeModules
          ? 'Włączaj lub wyłączaj moduły dla tej firmy.'
          : 'Tylko administrator może zmieniać moduły. Twoja rola: ' + (userRole ?? '—') + '.'}
      >
        <HeadingGlyph>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </HeadingGlyph>
      </TopicHeading>

      {saveError && (
        <p className="rounded-2xl border border-[#F2B6B6] bg-[#FEF2F2] px-3 py-2 text-sm text-red-700" role="alert">
          {saveError}
        </p>
      )}

      {modulesError && (
        <p className="text-sm text-red-700" role="alert">
          Nie udało się wczytać listy modułów. Spróbuj ponownie później.
        </p>
      )}

      <ul className="grid gap-3 lg:grid-cols-2">
        {moduleRows.map((row) => {
          const switchDisabled = !canChangeModules || pendingKey !== null;
          const isKsef = row.module === 'ksef';
          return (
            <li key={row.module} className={cn(cardCls, 'p-4 md:p-5')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{row.description}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn('text-xs font-medium', row.isEnabled ? 'text-emerald-700' : 'text-slate-400')}>
                    {row.isEnabled ? row.statusOn : row.statusOff}
                  </span>
                  <ModuleSwitch
                    id={`module-${row.module}`}
                    enabled={row.isEnabled}
                    disabled={switchDisabled}
                    onToggle={() => void onToggle(row.module, !row.isEnabled)}
                  />
                </div>
              </div>

              {isKsef && row.isEnabled && (
                <div className={cn('mt-3 space-y-2 border-t border-slate-100 pt-3', ksefUsageSaving && 'opacity-60')}>
                  <p className="text-sm font-medium text-slate-800">Tryb użycia KSeF</p>
                  {KSEF_USAGE_OPTIONS.map(opt => (
                    <label
                      key={opt.value}
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-2xl border px-3 py-2',
                        ksefUsage === opt.value
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-200 hover:bg-slate-50',
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
                        className="mt-0.5 h-4 w-4 accent-primary shrink-0"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{opt.label}</p>
                        <p className="text-xs text-slate-500">{opt.sub}</p>
                      </div>
                    </label>
                  ))}
                  <Link
                    to="/settings/certificate"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">Certyfikat i środowisko</span>
                      <span className="block text-xs text-slate-500">Pliki certyfikatu i sesja KSeF</span>
                    </span>
                    <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              )}
              {isKsef && !row.isEnabled && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Włącz moduł, aby ustawić tryb KSeF i certyfikat.
                </p>
              )}
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
  const [confirmField, setConfirmField] = useState<'auto_deliver_wz' | null>(null);
  const { data: settings, isPending, isError } = useWorkflowSettingsQuery(companyId);
  const updateMutation = useUpdateWorkflowSettingsMutation(companyId);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggle = async (field: 'orders_required' | 'wz_required_before_invoice' | 'auto_wz_on_order' | 'auto_deliver_wz', next: boolean) => {
    if (!canEdit) return;
    setSaveError(null);
    try {
      await updateMutation.mutateAsync({ [field]: next });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Nie udało się zapisać ustawień');
    }
  };

  const changedAtField = (field: 'orders_required' | 'wz_required_before_invoice' | 'auto_wz_on_order' | 'auto_deliver_wz') =>
    `${field}_changed_at` as keyof typeof settings;

  const rows: { field: 'orders_required' | 'wz_required_before_invoice' | 'auto_wz_on_order' | 'auto_deliver_wz'; title: string; description: string; confirmOnEnable?: string }[] = [
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
    {
      field: 'auto_wz_on_order',
      title: 'Automatyczne WZ przy zamówieniu',
      description:
        'Gdy włączone, formularz tworzenia zamówienia domyślnie zaznacza opcję "Wygeneruj WZ od razu". Przydatne przy sprzedaży trasowej i dostawach realizowanych od ręki.',
    },
    {
      field: 'auto_deliver_wz',
      title: 'WZ od razu dostarczone',
      description:
        'Włączone: zatwierdzenie WZ = dostarczone od razu. Zamówienie zamyka się automatycznie. Idealne gdy ta sama osoba drukuje i dostarcza towar.\n' +
        'Wyłączone: WZ przechodzi przez etapy Zapisano → W drodze → Dostarczone. Przydatne gdy dostawa i potwierdzenie odbioru to dwa osobne kroki w firmie.',
      confirmOnEnable: 'Wszystkie otwarte dokumenty WZ (w statusie "Zapisano" lub "W drodze") zostaną automatycznie oznaczone jako Dostarczone. Czy chcesz kontynuować?',
    },
  ];

  return (
    <section aria-labelledby="workflow-heading" className="flex flex-col gap-3">
      <TopicHeading
        id="workflow-heading"
        title="Przepływ dokumentów"
        hint={canEdit
          ? 'Kolejność zamówienia, WZ i faktury.'
          : 'Tylko administrator lub manager może zmieniać te ustawienia.'}
      >
        <HeadingGlyph>
          <path d="M7 7h11M14 4l4 3-4 3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 17H6M10 14l-4 3 4 3" strokeLinecap="round" strokeLinejoin="round" />
        </HeadingGlyph>
      </TopicHeading>

      {saveError && (
        <p className="rounded-2xl border border-[#F2B6B6] bg-[#FEF2F2] px-3 py-2 text-sm text-red-700" role="alert">
          {saveError}
        </p>
      )}

      {isError && (
        <p className="text-sm text-red-700" role="alert">
          Nie udało się wczytać ustawień przepływu dokumentów.
        </p>
      )}

      {isPending ? (
        <p className="text-sm text-slate-500">Ładowanie…</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const enabled = settings?.[row.field] ?? false;
            const disabled = !canEdit || updateMutation.isPending;
            return (
              <li key={row.field} className={cn(cardCls, 'flex items-start justify-between gap-3 p-4 md:p-5')}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-500">{row.description}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn('text-xs font-medium', enabled ? 'text-emerald-700' : 'text-slate-400')}>
                    {enabled ? 'Włączone' : 'Wyłączone'}
                  </span>
                  <ModuleSwitch
                    id={`workflow-${row.field}`}
                    enabled={enabled}
                    disabled={disabled}
                    onToggle={() => {
                      if (!enabled && row.confirmOnEnable) {
                        setConfirmField(row.field as 'auto_deliver_wz');
                      } else {
                        void toggle(row.field, !enabled);
                      }
                    }}
                  />
                  {(() => {
                    const ts = settings?.[changedAtField(row.field)] as string | null | undefined;
                    if (!ts) return null;
                    const d = new Date(ts);
                    return (
                      <p className="mt-1 text-xs text-slate-400">
                        zm. {d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    );
                  })()}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Confirm dialog for auto_deliver_wz */}
      {confirmField && (() => {
        const row = rows.find((r) => r.field === confirmField)!;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-apple-float">
              <p className="text-sm font-semibold text-slate-900">{row.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{row.confirmOnEnable}</p>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setConfirmField(null)}
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
                  onClick={() => {
                    setConfirmField(null);
                    void toggle(confirmField, true);
                  }}
                >
                  Włącz i zamknij WZ
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
    <div className={cn(cardCls, 'space-y-3 p-4 md:p-6')}>
      <TopicHeading
        level={3}
        title="Sposób wprowadzania cen"
        hint={canEdit
          ? 'Czy firma pracuje na cenach netto czy brutto. Wpływa na obliczenia na fakturach i zamówieniach.'
          : 'Tylko administrator może zmieniać te ustawienia.'}
      >
        <HeadingGlyph>
          <path d="M12 3v18" strokeLinecap="round" />
          <path d="M17 6.5H9.5a3.2 3.2 0 000 6.4h5a3.2 3.2 0 010 6.4H7" strokeLinecap="round" strokeLinejoin="round" />
        </HeadingGlyph>
      </TopicHeading>

      {saveError && (
        <p className="rounded-2xl border border-[#F2B6B6] bg-[#FEF2F2] px-3 py-2 text-sm text-red-700" role="alert">
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
                  'w-full rounded-2xl border p-4 text-left',
                  selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                  (!canEdit || saving) && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary' : 'border-slate-300',
                  )}>
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{opt.title}</span>
                </div>
                <p className="ml-6 text-xs leading-relaxed text-slate-500">{opt.description}</p>
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

type WzQuickReturnsSectionProps = {
  companyId: string;
  enabled: boolean;
  canEdit: boolean;
  onSaved: () => Promise<void>;
};

function WzQuickReturnsSection({ companyId, enabled, canEdit, onSaved }: WzQuickReturnsSectionProps) {
  const updateCompany = useUpdateCompanyMutation();
  const [value, setValue] = useState(enabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(enabled); }, [enabled]);

  const toggle = async () => {
    if (!canEdit || saving) return;
    const next = !value;
    setValue(next);
    setSaving(true);
    try {
      await updateCompany.mutateAsync({ companyId, data: { name: '', wz_quick_returns: next } });
      await onSaved();
    } catch {
      setValue(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(cardCls, 'p-4 md:p-6')}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 12a8 8 0 101.8-5.2" strokeLinecap="round" />
              <path d="M9 3H5v4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 8v4l3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Szybkie zwroty przy WZ</p>
            <p className="text-xs text-slate-500">Pokazuje przycisk "Zwrot" przy każdej WZ na liście. Przydatne przy dostawach trasowych gdy klient oddaje towar z poprzedniej wizyty.</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          disabled={!canEdit || saving}
          onClick={toggle}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
            value ? 'bg-primary' : 'bg-slate-200',
            (!canEdit || saving) && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', value ? 'translate-x-5' : 'translate-x-0')} />
        </button>
      </div>
    </div>
  );
}

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
    <div className={cn(cardCls, 'space-y-3 p-4 md:p-6')}>
      <TopicHeading
        level={3}
        title="Fakturowanie zwrotów"
        hint={canEdit
          ? 'Sposób ujmowania zwrotów towarów na fakturach sprzedaży.'
          : 'Tylko administrator może zmieniać te ustawienia.'}
      >
        <HeadingGlyph>
          <path d="M4 12a8 8 0 101.8-5.2" strokeLinecap="round" />
          <path d="M4 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
        </HeadingGlyph>
      </TopicHeading>

      {saveError && (
        <p className="rounded-2xl border border-[#F2B6B6] bg-[#FEF2F2] px-3 py-2 text-sm text-red-700" role="alert">
          {saveError}
        </p>
      )}

      <ul className="grid gap-3 lg:grid-cols-3">
        {RETURNS_MODE_OPTIONS.map((opt) => {
          const selected = mode === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                disabled={!canEdit || saving}
                onClick={() => void saveMode(opt.value)}
                className={cn(
                  'h-full w-full rounded-2xl border p-4 text-left',
                  selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                  (!canEdit || saving) && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary' : 'border-slate-300',
                  )}>
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{opt.title}</span>
                </div>
                <p className="ml-6 text-xs leading-relaxed text-slate-500">{opt.description}</p>
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
    <div className={cn(cardCls, 'space-y-4 p-4 md:p-6')}>
      <TopicHeading
        level={3}
        title="Numeracja faktur"
        hint={canEdit
          ? 'Format numeru faktury generowanego automatycznie przez system.'
          : 'Tylko administrator może zmieniać te ustawienia.'}
      >
        <HeadingGlyph>
          <path d="M8 7h12M8 12h12M8 17h12" strokeLinecap="round" />
          <path d="M4 7h.01M4 12h.01M4 17h.01" strokeLinecap="round" strokeWidth={2.4} />
        </HeadingGlyph>
      </TopicHeading>

      <div>
        <p className={fieldLabelCls}>Okres numeracji</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { value: 'yearly' as const, title: 'Roczna', description: 'Numer rośnie przez cały rok, np. FV/2026/001.' },
            { value: 'monthly' as const, title: 'Miesięczna', description: 'Numer zaczyna się od nowa co miesiąc, np. FV/2026/09/001.' },
          ]).map((opt) => {
            const selected = period === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={!canEdit}
                aria-pressed={selected}
                onClick={() => { setPeriod(opt.value); setSaved(false); }}
                className={cn(
                  'rounded-2xl border p-4 text-left',
                  selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
                  !canEdit && 'cursor-not-allowed opacity-50',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary' : 'border-slate-300',
                  )}>
                    {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{opt.title}</span>
                </div>
                <p className="ml-6 text-xs leading-relaxed text-slate-500">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="inv-prefix" className={fieldLabelCls}>Prefiks</label>
          <input
            id="inv-prefix"
            type="text"
            value={prefix}
            disabled={!canEdit}
            maxLength={10}
            onChange={(e) => { setPrefix(e.target.value); setSaved(false); }}
            className={cn('field-ios w-full disabled:cursor-not-allowed disabled:opacity-50', prefix.trim() ? 'border-solid border-slate-300 bg-white' : 'border-dashed border-slate-300 placeholder:text-slate-400')}
            placeholder="FV"
          />
        </div>
        <div>
          <label htmlFor="inv-padding" className={fieldLabelCls}>Liczba cyfr</label>
          <input
            id="inv-padding"
            type="number"
            value={padding}
            disabled={!canEdit}
            min={1}
            max={8}
            onChange={(e) => { setPadding(Math.max(1, Math.min(8, Number(e.target.value) || 4))); setSaved(false); }}
            className="field-ios w-full border-solid border-slate-300 bg-white disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-slate-500">4 daje 0001</p>
        </div>
        <div>
          <label htmlFor="inv-start" className={fieldLabelCls}>Pierwszy numer</label>
          <input
            id="inv-start"
            type="number"
            value={startNum}
            disabled={!canEdit}
            min={1}
            onChange={(e) => { setStartNum(Math.max(1, Number(e.target.value) || 1)); setSaved(false); }}
            className="field-ios w-full border-solid border-slate-300 bg-white disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-slate-500">Tylko pierwsza faktura w okresie</p>
        </div>
      </div>

      {saveError && (
        <p className="text-sm text-red-700" role="alert">{saveError}</p>
      )}
      {saved && (
        <p className="text-sm font-medium text-emerald-700" role="status">Zapisano.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Podgląd</p>
          <span className="mt-1 inline-block rounded-lg bg-primary/10 px-2.5 py-1 text-base font-semibold tracking-tight text-primary">{preview}</span>
        </div>
        {canEdit && (
          <button type="button" className={primaryBtnCls} disabled={saving || updateCompany.isPending} onClick={() => void handleSave()}>
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        )}
      </div>
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
      <button type="button" className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50" onClick={handleOpen}>
        Usuń firmę
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-apple-md md:rounded-3xl">
        <h2 id="delete-dialog-title" className="text-lg font-semibold text-slate-900">
          Usuń firmę
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Ta operacja jest <strong>nieodwracalna</strong>. Dane podatkowe (faktury, WZ, PZ) zostaną zachowane zgodnie
          z wymogami prawa przez 5 lat, ale dostęp do firmy zostanie trwale usunięty.
        </p>
        <p className="mt-3 text-sm text-slate-800">
          Wpisz nazwę firmy, żeby potwierdzić:{' '}
          <strong className="font-semibold">{companyName}</strong>
        </p>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Wpisz nazwę firmy"
          className="field-ios mt-2 w-full"
          aria-label="Potwierdź nazwę firmy"
        />
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={quietBtnCls} onClick={() => setOpen(false)} disabled={deleteMutation.isPending}>
            Anuluj
          </button>
          <button
            type="button"
            className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleConfirm()}
            disabled={!confirmed || deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Usuwanie…' : 'Usuń firmę'}
          </button>
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
      <button type="button" className={quietBtnCls} onClick={() => setOpen(true)}>
        Opuść firmę
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-apple-md md:rounded-3xl">
        <h2 id="leave-dialog-title" className="text-lg font-semibold text-slate-900">
          Opuść firmę
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Czy na pewno chcesz opuścić tę firmę? Stracisz dostęp do wszystkich jej danych.
        </p>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={quietBtnCls} onClick={() => setOpen(false)} disabled={leaveMutation.isPending}>
            Anuluj
          </button>
          <button
            type="button"
            className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleConfirm()}
            disabled={leaveMutation.isPending}
          >
            {leaveMutation.isPending ? 'Opuszczanie…' : 'Opuść firmę'}
          </button>
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
    <div className={cn(cardCls, 'space-y-4 p-4 md:p-6')}>
      <TopicHeading
        level={3}
        title="Forma opodatkowania"
        hint={canEdit
          ? 'Wpływa na dostępne raporty JPK.'
          : 'Tylko administrator może zmieniać ustawienia opodatkowania.'}
      >
        <HeadingGlyph>
          <path d="M6 4h9a3 3 0 013 3v13H9a3 3 0 01-3-3V4z" strokeLinejoin="round" />
          <path d="M6 4a3 3 0 00-3 3v1h3" strokeLinejoin="round" />
          <path d="M9 9h6M9 13h6" strokeLinecap="round" />
        </HeadingGlyph>
      </TopicHeading>

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
                  'flex flex-col items-start gap-1 rounded-2xl border p-4 text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                  taxationForm === form
                    ? 'border-primary bg-primary/5'
                    : 'border-slate-200 bg-white hover:bg-slate-50',
                  !canEdit && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="text-2xl leading-none" aria-hidden>{form === 'kpir' ? '📒' : '🧾'}</span>
                <p className="text-sm font-semibold text-slate-900">
                  {form === 'kpir' ? 'KPiR' : 'Ryczałt'}
                </p>
                <p className="text-xs leading-snug text-slate-500">
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
              <p className={fieldLabelCls}>Stawka ryczałtu</p>
              <select
                value={ryczaltCategory ?? ''}
                disabled={!canEdit}
                onChange={(e) => { setRyczaltCategory(e.target.value as RyczaltCategory); setSaved(false); }}
                className="select-pill w-full disabled:cursor-not-allowed disabled:opacity-50"
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
            <button type="button" className={primaryBtnCls} disabled={!canSave || updateMutation.isPending} onClick={() => void handleSave()}>
              {updateMutation.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </button>
          )}
    </div>
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
    <div className={cn(cardCls, 'space-y-4 p-4 md:p-6')}>
      <TopicHeading level={3} title="VAT" hint="Wpływa na wyświetlanie podziału VAT w raportach sprzedaży.">
        <HeadingGlyph>
          <circle cx="12" cy="12" r="8" />
          <path d="M15.5 8.5l-7 7M9 9.5h.01M15 14.5h.01" strokeLinecap="round" />
        </HeadingGlyph>
      </TopicHeading>
      <label className={cn('flex cursor-pointer items-center gap-3', !canEdit && 'cursor-not-allowed opacity-50')}>
        <input
          type="checkbox"
          checked={isVatPayer}
          disabled={!canEdit}
          onChange={(e) => { setIsVatPayer(e.target.checked); setSaved(false); }}
          className="h-4 w-4 accent-primary"
        />
        <div>
          <p className="text-sm font-medium text-slate-900">Czynny podatnik VAT</p>
          <p className="text-xs text-slate-500">Zaznacz, jeśli firma jest zarejestrowana jako płatnik VAT.</p>
        </div>
      </label>
      {saveError && <p className="text-sm text-red-700">{saveError}</p>}
      {saved && <p className="text-sm font-medium text-emerald-700">Zapisano.</p>}
      {canEdit && (
        <button type="button" className={primaryBtnCls} disabled={updateMutation.isPending} onClick={() => void handleSave()}>
          {updateMutation.isPending ? 'Zapisywanie…' : 'Zapisz'}
        </button>
      )}
    </div>
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
    <section aria-labelledby="danger-zone-heading" className="flex flex-col gap-3">
      <TopicHeading id="danger-zone-heading" title="Konto firmy" hint="Te działania są nieodwracalne.">
        <HeadingGlyph>
          <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          <path d="M10.3 4.8L2.8 18a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.8a2 2 0 00-3.4 0z" strokeLinejoin="round" />
        </HeadingGlyph>
      </TopicHeading>
      <div className={cn(cardCls, 'flex flex-wrap gap-2 p-4 md:p-6')}>
        <LeaveCompanyDialog companyId={companyId} onSuccess={onDone} />
        {isAdmin && (
          <DeleteCompanyDialog
            companyId={companyId}
            companyName={companyName}
            onSuccess={onDone}
          />
        )}
      </div>
    </section>
  );
}

export function CompanySettingsPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const resolved = useResolvedCompanyId();

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
        <button type="button" className={cn('mt-4', quietBtnCls)} onClick={() => void refreshUser()}>
          Odśwież dane użytkownika
        </button>
      </div>
    );
  }

  if (resolved.state !== 'ready') {
    return null;
  }

  const { companyId, company: currentCompany, isUnsynced } = resolved;

  const addressLine = [
    companyText(currentCompany, 'address', 'address'),
    [companyText(currentCompany, 'postalCode', 'postal_code'), companyText(currentCompany, 'city', 'city')].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const registry = [
    companyText(currentCompany, 'regon', 'regon') ? { label: 'REGON', value: companyText(currentCompany, 'regon', 'regon')! } : null,
    companyText(currentCompany, 'krs', 'krs') ? { label: 'KRS', value: companyText(currentCompany, 'krs', 'krs')! } : null,
    companyText(currentCompany, 'bdo', 'bdo') ? { label: 'BDO', value: companyText(currentCompany, 'bdo', 'bdo')! } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  return (
    <div className="min-h-full bg-[#F2F2F7]">
    <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 pb-10 pt-8 sm:px-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Ustawienia firmy</h1>
        <p className="mt-1 text-xs text-slate-500">
          Moduły i ustawienia bieżącej firmy.
        </p>
        {isUnsynced && (
          <p className="mt-3 rounded-2xl border border-[#F3D072] bg-[#FFFBEB] px-3 py-2 text-sm text-slate-800" role="status">
            Nie ustawiono bieżącej firmy. Pokazujemy pierwszą firmę z Twojego konta.
          </p>
        )}
      </header>

      <section aria-labelledby="company-heading" className="flex flex-col gap-3">
        <TopicHeading id="company-heading" title="Bieżąca firma" hint="Nazwa, adres i kontakt widoczne na fakturze.">
          <HeadingGlyph>
            <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeLinecap="round" strokeLinejoin="round" />
          </HeadingGlyph>
        </TopicHeading>
        <div className={cn(cardCls, 'p-4 md:p-6')}>
          {currentCompany ? (
            <>
              <p className="text-base font-semibold text-slate-900">{currentCompany.name}</p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  { label: 'NIP', value: pickCompanyField(currentCompany, 'nip', 'nip') },
                  { label: 'Adres', value: addressLine, wide: true },
                  { label: 'Telefon', value: companyText(currentCompany, 'phone', 'phone') },
                  { label: 'E-mail', value: companyText(currentCompany, 'email', 'email') },
                  ...registry.map((row) => ({ label: row.label, value: row.value })),
                  user?.current_company_role
                    ? { label: 'Twoja rola', value: user.current_company_role }
                    : null,
                ]
                  .filter((row): row is { label: string; value: string; wide?: boolean } => Boolean(row?.value) && row!.value !== '—')
                  .map((row) => (
                    <div
                      key={row.label}
                      className={cn(
                        'rounded-xl border border-slate-200 bg-[#F2F2F7] px-3 py-2.5',
                        row.wide && 'sm:col-span-2',
                      )}
                    >
                      <dt className="text-xs text-slate-500">{row.label}</dt>
                      <dd className="mt-0.5 text-sm font-medium text-slate-900">{row.value}</dd>
                    </div>
                  ))}
              </dl>
              <Link
                to="/settings/company-data"
                className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900">Edytuj dane firmy</span>
                  <span className="block text-xs text-slate-500">Nazwa, adres, konto bankowe i logo</span>
                </span>
                <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </>
          ) : (
            <p className="text-sm text-slate-600">Brak danych firmy.</p>
          )}
        </div>
      </section>

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

      <section aria-labelledby="invoices-heading" className="flex flex-col gap-3">
        <TopicHeading id="invoices-heading" title="Faktury" hint="Numeracja, ceny i zwroty.">
          <HeadingGlyph>
            <path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinejoin="round" />
            <path d="M14 3v6h6M8 13h8M8 17h5" strokeLinecap="round" strokeLinejoin="round" />
          </HeadingGlyph>
        </TopicHeading>
        <PriceInputModeSection
          companyId={companyId}
          currentMode={user?.price_input_mode ?? undefined}
          canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
          onSaved={refreshUser}
        />
        <InvoiceReturnsSection
          companyId={companyId}
          currentMode={currentCompany?.invoice_returns_mode}
          canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
          onSaved={refreshUser}
        />
        <WzQuickReturnsSection
          companyId={companyId}
          enabled={currentCompany?.wz_quick_returns ?? false}
          canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
          onSaved={refreshUser}
        />
        <InvoiceNumberingSection
          companyId={companyId}
          company={currentCompany}
          canEdit={user?.is_company_admin === true || user?.permissions?.can_manage_settings === true}
          onSaved={refreshUser}
        />
      </section>

      <section aria-labelledby="taxes-heading" className="flex flex-col gap-3">
        <TopicHeading id="taxes-heading" title="Podatki" hint="Forma opodatkowania i VAT.">
          <HeadingGlyph>
            <path d="M4 19V5M4 19h16" strokeLinecap="round" />
            <path d="M8 15v-4M12 15V8M16 15v-2" strokeLinecap="round" />
          </HeadingGlyph>
        </TopicHeading>
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
      </section>

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
    </div>
  );
}

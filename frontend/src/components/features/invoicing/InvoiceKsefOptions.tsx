/**
 * InvoiceKsefOptions — FA-3 KSeF fields as uniform accordion rows.
 * Each section is a self-contained collapsible, matching AnnotationsSection style.
 */
import { useState, type ReactNode } from 'react';
import type { InvoiceKsefOptions as KsefOptionsType } from '@/types';
import { cn } from '@/lib/utils';

function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  if (clean.length < 8) return iban;
  return clean.slice(0, 4) + ' •••• •••• •••• ' + clean.slice(-4);
}

const fieldClass = 'field-ios-tall';

function IconChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      {children}
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type InvoiceKsefOptionsProps = {
  value: KsefOptionsType;
  onChange: (patch: Partial<KsefOptionsType>) => void;
  paymentMethod?: import('@/types').InvoicePaymentMethod;
};

export function InvoiceKsefOptions({ value, onChange, paymentMethod }: InvoiceKsefOptionsProps) {
  const set = <K extends keyof KsefOptionsType>(key: K, v: KsefOptionsType[K]) =>
    onChange({ [key]: v } as Partial<KsefOptionsType>);

  return (
    <>
      {/* Dane bankowe — tylko przy przelewie */}
      {paymentMethod === 'transfer' && (
        <BankDataAccordion value={value} set={set} />
      )}

      {/* Dodatkowe informacje (DodatkowyOpis FA-3) */}
      <AdditionalInfoAccordion
        rows={value.additional_info ?? []}
        onChange={(v) => set('additional_info', v)}
      />

      {/* Numery WZ */}
      <WzRow values={value.wz_numbers ?? []} onChange={(v) => set('wz_numbers', v)} />

      {/* Link, skonto, ID płatności, uwagi */}
      <RareOptionsAccordion value={value} set={set} />
    </>
  );
}

/* ── Dane bankowe ───────────────────────────────────────────────── */

function BankDataAccordion({
  value,
  set,
}: {
  value: KsefOptionsType;
  set: <K extends keyof KsefOptionsType>(key: K, v: KsefOptionsType[K]) => void;
}) {
  const hasIban = Boolean(value.bank_account_iban);
  const [open, setOpen] = useState(false);

  const hasFilled = hasIban || value.bank_swift || value.bank_name;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <IconChip>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M3 10h18M5 10v8M10 10v8M14 10v8M19 10v8M3 18h18M12 3l9 7H3l9-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </IconChip>
          <span className="text-sm font-semibold text-slate-900">Dane bankowe</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {!open && hasIban && (
            <span className="truncate text-xs text-slate-400">{maskIban(value.bank_account_iban ?? '')}</span>
          )}
          {!open && !hasIban && hasFilled && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">ustawione</span>
          )}
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 md:px-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Numer rachunku IBAN</label>
            <input
              type="text"
              className={fieldClass}
              placeholder="np. PL12 1234 5678 9012 3456 7890 1234"
              value={value.bank_account_iban ?? ''}
              onChange={(e) => set('bank_account_iban', e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-800">Kod SWIFT / BIC</label>
              <input
                type="text"
                className={fieldClass}
                placeholder="np. PKOPPLPW"
                value={value.bank_swift ?? ''}
                onChange={(e) => set('bank_swift', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-800">Nazwa banku</label>
              <input
                type="text"
                className={fieldClass}
                placeholder="np. PKO Bank Polski"
                value={value.bank_name ?? ''}
                onChange={(e) => set('bank_name', e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Numery WZ — accordion ─────────────────────────────────────── */

function WzRow({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const raw = e.currentTarget.value.trim();
      if (raw && !values.includes(raw)) { onChange([...values, raw]); e.currentTarget.value = ''; }
    }
  };
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw && !values.includes(raw)) { onChange([...values, raw]); e.target.value = ''; }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <IconChip>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M1 7h13v10H1zM14 10h5l3 3v4h-8" strokeLinejoin="round" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>
          </IconChip>
          <span className="text-sm font-semibold text-slate-900">Numery dokumentów WZ</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && values.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {values.length}
            </span>
          )}
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-4 py-4 md:px-6">
          <input
            type="text"
            className={fieldClass}
            placeholder="np. WZ/2026/0001 — wpisz i naciśnij Enter"
            onKeyDown={handleKey}
            onBlur={handleBlur}
          />
          {values.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {values.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-sm font-medium text-primary">
                  {v}
                  <button
                    type="button"
                    onClick={() => onChange(values.filter((x) => x !== v))}
                    className="ml-0.5 text-indigo-400 hover:text-destructive"
                    aria-label={`Usuń ${v}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Dodatkowe informacje (DodatkowyOpis FA-3) ──────────────────── */

type InfoRow = { label: string; value: string };

function AdditionalInfoAccordion({
  rows,
  onChange,
}: {
  rows: InfoRow[];
  onChange: (v: InfoRow[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const update = (i: number, field: keyof InfoRow, val: string) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [field]: val } : r));
    onChange(next);
  };

  const add = () => onChange([...rows, { label: '', value: '' }]);

  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <IconChip>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5h6M9 12h6M9 16h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconChip>
          <span className="text-sm font-semibold text-slate-900">Dodatkowe informacje</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && rows.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {rows.length}
            </span>
          )}
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4 md:px-6">
          <p className="mb-3 text-xs text-slate-400">
            Pary klucz–wartość wysyłane do KSeF jako DodatkowyOpis (np. "Okres dostawy" / "2026-09-01 - 2026-09-30").
          </p>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    className={fieldClass}
                    placeholder="Rodzaj informacji (np. Okres dostawy)"
                    value={row.label}
                    onChange={(e) => update(i, 'label', e.target.value)}
                  />
                  <input
                    type="text"
                    className={fieldClass}
                    placeholder="Treść informacji"
                    value={row.value}
                    onChange={(e) => update(i, 'value', e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-destructive"
                  aria-label="Usuń wiersz"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={add}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            + Dodaj wiersz
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Link, skonto, ID płatności, uwagi ─────────────────────────── */

function RareOptionsAccordion({
  value,
  set,
}: {
  value: KsefOptionsType;
  set: <K extends keyof KsefOptionsType>(key: K, v: KsefOptionsType[K]) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasAny = value.payment_link || value.ksef_payment_id || value.discount_conditions || value.extra_notes;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <IconChip>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1.5 1.5" strokeLinecap="round" /><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7L13 18" strokeLinecap="round" /></svg>
          </IconChip>
          <span className="min-w-0 text-sm font-semibold text-slate-900">Link, skonto, ID płatności</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && hasAny && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">ustawione</span>
          )}
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 md:px-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Link do płatności online</label>
            <input type="text" className={fieldClass} placeholder="https://platnosc.example.com/faktura/..." value={value.payment_link ?? ''} onChange={(e) => set('payment_link', e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Identyfikator płatności KSeF</label>
            <input type="text" className={fieldClass} placeholder="np. 001ABC123DEF4" value={value.ksef_payment_id ?? ''} onChange={(e) => set('ksef_payment_id', e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Warunki skonta</label>
            <input type="text" className={fieldClass} placeholder="np. 2% przy zapłacie do 7 dni" maxLength={256} value={value.discount_conditions ?? ''} onChange={(e) => set('discount_conditions', e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">
              Uwagi wewnętrzne
              <span className="ml-2 text-xs font-normal text-slate-400">nie wysyłane do KSeF</span>
            </label>
            <textarea className={cn(fieldClass, 'min-h-[64px] resize-none')} rows={2} placeholder="np. Zamówienie telefoniczne, nr ref. klienta: …" value={value.extra_notes ?? ''} onChange={(e) => set('extra_notes', e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

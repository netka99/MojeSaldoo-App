/**
 * InvoiceKsefOptions — collapsible sections for all optional FA-3 KSeF fields.
 *
 * Hidden by default so users only see what they need. Each annotation has a
 * description of when it's required. Bank account section auto-opens when
 * payment method is 'transfer' and the company has a bank IBAN set.
 *
 * Usage:
 *   <InvoiceKsefOptions
 *     value={ksefOptions}
 *     onChange={setKsefOptions}
 *     paymentMethod={paymentMethod}
 *   />
 */
import { useState } from 'react';
import type { InvoiceKsefOptions as KsefOptionsType } from '@/types';
import { Accordion } from '@/components/ui/Accordion';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  if (clean.length < 8) return iban;
  return clean.slice(0, 4) + ' •••• •••• •••• ' + clean.slice(-4);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TagInput({
  label,
  description,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  description: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const raw = (e.currentTarget.value || '').trim();
      if (raw && !values.includes(raw)) {
        onChange([...values, raw]);
        e.currentTarget.value = '';
      }
    }
  };
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw && !values.includes(raw)) {
      onChange([...values, raw]);
      e.target.value = '';
    }
  };
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <input
        type="text"
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        placeholder={placeholder ?? 'Wpisz i naciśnij Enter'}
        onKeyDown={handleKey}
        onBlur={handleBlur}
      />
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {v}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:text-destructive focus-visible:outline-none"
                aria-label={`Usuń ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const textareaClass = cn(
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type InvoiceKsefOptionsProps = {
  value: KsefOptionsType;
  onChange: (patch: Partial<KsefOptionsType>) => void;
  /** Current payment method — bank section auto-opens when 'transfer'. */
  paymentMethod?: import('@/types').InvoicePaymentMethod;
};

export function InvoiceKsefOptions({ value, onChange, paymentMethod }: InvoiceKsefOptionsProps) {
  const set = <K extends keyof KsefOptionsType>(key: K, v: KsefOptionsType[K]) =>
    onChange({ [key]: v } as Partial<KsefOptionsType>);

  const [bankEditing, setBankEditing] = useState(false);
  const hasBankFromSettings = Boolean(value.bank_account_iban);
  const bankOpen = paymentMethod === 'transfer' && hasBankFromSettings;

  return (
    <div className="space-y-3">
      {/* ── Bank account ── */}
      {hasBankFromSettings && !bankEditing ? (
        /* Dane z ustawień — tylko info + link */
        <div className="flex items-center justify-between gap-3 px-1 py-0.5">
          <p className="text-xs text-slate-400">
            Dane bankowe pobrane z ustawień firmy:{' '}
            <span className="font-mono text-slate-600">{maskIban(value.bank_account_iban ?? '')}</span>
          </p>
          <button
            type="button"
            onClick={() => setBankEditing(true)}
            className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Zmień
          </button>
        </div>
      ) : (
        /* Pola edycji — widoczne po kliknięciu "Zmień" lub gdy brak IBAN w ustawieniach */
        <Accordion
          title="Dane bankowe"
          description="Numer rachunku IBAN, SWIFT, nazwa banku"
          defaultOpen
        >
          <div className="space-y-4">
            {hasBankFromSettings && (
              <button
                type="button"
                onClick={() => setBankEditing(false)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                ← Przywróć dane z ustawień firmy
              </button>
            )}
            <Input
              label="Numer rachunku IBAN"
              placeholder="np. PL12 1234 5678 9012 3456 7890 1234"
              value={value.bank_account_iban ?? ''}
              onChange={(e) => set('bank_account_iban', e.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Kod SWIFT / BIC"
                placeholder="np. PKOPPLPW"
                value={value.bank_swift ?? ''}
                onChange={(e) => set('bank_swift', e.target.value)}
              />
              <Input
                label="Nazwa banku"
                placeholder="np. PKO Bank Polski"
                value={value.bank_name ?? ''}
                onChange={(e) => set('bank_name', e.target.value)}
              />
            </div>
          </div>
        </Accordion>
      )}

      {/* Link do płatności + skonto — zawsze widoczne w accordion */}
      <Accordion title="Płatność elektroniczna i skonto" description="Link do bramki, identyfikator KSeF, warunki skonta" defaultOpen={false}>
        <div className="space-y-4">
          <Input
            label="Link do płatności online (opcjonalnie)"
            placeholder="https://platnosc.example.com/faktura/..."
            value={value.payment_link ?? ''}
            onChange={(e) => set('payment_link', e.target.value)}
          />
          <Input
            label="Identyfikator płatności KSeF (opcjonalnie)"
            placeholder="np. 001ABC123DEF4"
            value={value.ksef_payment_id ?? ''}
            onChange={(e) => set('ksef_payment_id', e.target.value)}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Warunki skonta (opcjonalnie)</label>
            <p className="text-xs text-muted-foreground">
              Opis rabatu za wcześniejszą zapłatę, np. &quot;2% przy zapłacie w ciągu 7 dni&quot; (max 256 znaków).
            </p>
            <input
              type="text"
              className={cn(
                'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              placeholder="np. 2% przy zapłacie do 7 dni"
              maxLength={256}
              value={value.discount_conditions ?? ''}
              onChange={(e) => set('discount_conditions', e.target.value)}
            />
          </div>
        </div>
      </Accordion>

      {/* ── Documents and footer ── */}
      <Accordion
        title="Dokumenty WZ i stopka faktury"
        description="Powiązane dokumenty magazynowe, stopka faktury, dodatkowe uwagi"
        defaultOpen={false}
      >
        <div className="space-y-4">
          <TagInput
            label="Numery dokumentów WZ"
            description="Numery magazynowych dokumentów wydania zewnętrznego powiązanych z tą fakturą. Wpisz numer i naciśnij Enter."
            values={value.wz_numbers ?? []}
            onChange={(v) => set('wz_numbers', v)}
            placeholder="np. WZ/2026/0001"
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Stopka faktury (opcjonalnie)</label>
            <p className="text-xs text-muted-foreground">
              Tekst wyświetlany u dołu faktury — np. numer konta, dane bankowe, uwagi (max 3 500 znaków). Wysyłany do KSeF.
            </p>
            <textarea
              className={textareaClass}
              maxLength={3500}
              rows={3}
              placeholder="np. Faktura jest dokumentem księgowym. Dziękujemy za współpracę."
              value={value.footer_text ?? ''}
              onChange={(e) => set('footer_text', e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {(value.footer_text ?? '').length} / 3 500
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Dodatkowe uwagi (wewnętrzne, opcjonalnie)</label>
            <p className="text-xs text-muted-foreground">
              Widoczne na wydruku faktury, ale nie wysyłane do KSeF. Do notatek wewnętrznych.
            </p>
            <textarea
              className={textareaClass}
              rows={3}
              placeholder="np. Zamówienie telefoniczne, nr ref. klienta: …"
              value={value.extra_notes ?? ''}
              onChange={(e) => set('extra_notes', e.target.value)}
            />
          </div>
        </div>
      </Accordion>
    </div>
  );
}

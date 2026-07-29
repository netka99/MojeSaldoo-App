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
import type { InvoiceKsefOptions as KsefOptionsType, KsefInvoiceType } from '@/types';
import { Accordion } from '@/components/ui/Accordion';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AnnotationRow({
  label,
  description,
  checked,
  onChange,
  warn,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  warn?: string;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-lg p-2 transition-colors hover:bg-muted/30">
      <div className="mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input accent-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
      <div className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        {warn && checked && (
          <span className="mt-1 block text-xs font-medium text-amber-600">{warn}</span>
        )}
      </div>
    </label>
  );
}

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
  paymentMethod?: 'transfer' | 'cash' | 'card';
};

const KSEF_TYPE_OPTIONS: { value: KsefInvoiceType; label: string; description: string }[] = [
  { value: 'VAT', label: 'Podstawowa', description: 'Standardowa faktura VAT — najczęstszy przypadek.' },
  {
    value: 'ZAL',
    label: 'Zaliczkowa',
    description: 'Faktura zaliczkowa (ZAL) — wystawiana przed dostawą po otrzymaniu zaliczki. Wymaga późniejszej faktury rozliczeniowej.',
  },
  {
    value: 'ROZ',
    label: 'Rozliczeniowa',
    description: 'Faktura rozliczeniowa (ROZ) — rozlicza wcześniej wystawione faktury zaliczkowe.',
  },
];

const selectClass = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

export function InvoiceKsefOptions({ value, onChange, paymentMethod }: InvoiceKsefOptionsProps) {
  const set = <K extends keyof KsefOptionsType>(key: K, v: KsefOptionsType[K]) =>
    onChange({ [key]: v } as Partial<KsefOptionsType>);

  const bankOpen = paymentMethod === 'transfer' && Boolean(value.bank_account_iban);

  const activeAnnotations = [
    value.annotation_mpp,
    value.annotation_kasowa,
    value.annotation_odwrotne,
    value.annotation_trojstronna,
    value.annotation_zwolnienie,
    value.annotation_marza,
    value.annotation_tp,
    value.annotation_fp,
    value.annotation_oss,
  ].filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* ── Invoice type ── */}
      <Accordion
        title="Rodzaj faktury"
        description={
          value.ksef_invoice_type && value.ksef_invoice_type !== 'VAT'
            ? `Wybrany: ${KSEF_TYPE_OPTIONS.find((o) => o.value === value.ksef_invoice_type)?.label}`
            : 'Podstawowa (domyślna) — zmień tylko dla zaliczkowych lub rozliczeniowych'
        }
        defaultOpen={false}
      >
        <div className="space-y-2">
          {KSEF_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer gap-3 rounded-lg p-2 hover:bg-muted/30">
              <input
                type="radio"
                className="mt-0.5 h-4 w-4 accent-primary"
                name="ksef_invoice_type"
                value={opt.value}
                checked={(value.ksef_invoice_type ?? 'VAT') === opt.value}
                onChange={() => set('ksef_invoice_type', opt.value)}
              />
              <span>
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">{opt.description}</span>
                {opt.value !== 'VAT' && (
                  <span className="mt-1 block text-xs text-amber-600">
                    Uwaga: typ {opt.value} jest obsługiwany przez KSeF, ale generowanie XML dla zaliczkowych/rozliczeniowych
                    jest w trakcie implementacji. Wysyłka zostanie zablokowana.
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </Accordion>

      {/* ── Annotations ── */}
      <Accordion
        title={`Adnotacje FA-3 ${activeAnnotations > 0 ? `(${activeAnnotations} aktywnych)` : '(opcjonalne)'}`}
        description="Znaczniki wymagane przepisami VAT — MPP, odwrotne obciążenie, zwolnienia, powiązania i inne"
        defaultOpen={activeAnnotations > 0}
      >
        <div className="space-y-1 divide-y divide-border/50">
          <AnnotationRow
            label="MPP — Mechanizm podzielonej płatności"
            description="Wymagany gdy faktura opiewa na ≥15 000 PLN brutto i zawiera towary/usługi z załącznika 15 do ustawy VAT (np. stal, elektronika, paliwa). Nabywca musi zapłacić VAT na osobny rachunek VAT."
            checked={value.annotation_mpp ?? false}
            onChange={(v) => set('annotation_mpp', v)}
          />
          <AnnotationRow
            label="Metoda kasowa"
            description="Zaznacz jeśli rozliczasz VAT metodą kasową (art. 21 ust. 1 ustawy VAT). Dotyczy małych podatników, u których obowiązek podatkowy powstaje z chwilą zapłaty."
            checked={value.annotation_kasowa ?? false}
            onChange={(v) => set('annotation_kasowa', v)}
          />
          <AnnotationRow
            label="Odwrotne obciążenie"
            description="Stosuj gdy podatek VAT rozlicza nabywca a nie sprzedawca (np. złom, odpady, usługi budowlane w podwykonawstwie B2B, niektóre usługi elektroniczne)."
            checked={value.annotation_odwrotne ?? false}
            onChange={(v) => set('annotation_odwrotne', v)}
          />
          <AnnotationRow
            label="Procedura trójstronna uproszczona"
            description="Wewnątrzwspólnotowe transakcje łańcuchowe z trzema podmiotami z różnych krajów UE (art. 135 ust. 1 pkt 4 ustawy VAT). Rzadko stosowane."
            checked={value.annotation_trojstronna ?? false}
            onChange={(v) => set('annotation_trojstronna', v)}
          />
          <AnnotationRow
            label="Dostawa zwolniona z VAT"
            description="Zaznacz gdy sprzedajesz towary lub usługi zwolnione z podatku VAT na podstawie art. 43 ust. 1, art. 113 ust. 1 i 9 lub art. 82 ust. 3 (np. usługi medyczne, edukacyjne, finansowe, małe podmioty do limitu 200 000 PLN)."
            checked={value.annotation_zwolnienie ?? false}
            onChange={(v) => set('annotation_zwolnienie', v)}
            warn="Nie można łączyć ze zwolnieniem z VAT i mechanizmem MPP jednocześnie."
          />
          <AnnotationRow
            label="Procedura marży"
            description="Dotyczy sprzedaży towarów używanych, dzieł sztuki, antyków lub biur podróży (art. 119 lub 120 ustawy VAT). VAT jest obliczany od marży, nie od całej ceny."
            checked={value.annotation_marza ?? false}
            onChange={(v) => set('annotation_marza', v)}
          />
          <AnnotationRow
            label="Procedura OSS (One Stop Shop)"
            description="Sprzedaż B2C do konsumentów w innych krajach UE przez platformę OSS. Dotyczy sklepów internetowych przekraczających limit 10 000 EUR."
            checked={value.annotation_oss ?? false}
            onChange={(v) => set('annotation_oss', v)}
          />
          <AnnotationRow
            label="TP — Powiązania między stronami"
            description="Wymagany zgodnie z §10 ust. 4 pkt 3 rozporządzenia JPK gdy nabywca i sprzedawca są podmiotami powiązanymi (rodzina, udziały ≥25%, wspólny zarząd itp.)."
            checked={value.annotation_tp ?? false}
            onChange={(v) => set('annotation_tp', v)}
          />
          <AnnotationRow
            label="FP — Faktura do paragonu fiskalnego"
            description="Zaznacz gdy wystawiasz fakturę na podstawie wcześniej wydrukowanego paragonu z kasy fiskalnej (art. 109 ust. 3d ustawy VAT). Faktura jest powiązana z paragonem w ewidencji JPK."
            checked={value.annotation_fp ?? false}
            onChange={(v) => set('annotation_fp', v)}
          />
        </div>
      </Accordion>

      {/* ── Bank account ── */}
      <Accordion
        title="Dane bankowe i płatność"
        description="Numer rachunku bankowego, SWIFT, link do płatności, skonto"
        defaultOpen={bankOpen}
      >
        <div className="space-y-4">
          <Input
            label="Numer rachunku IBAN"
            placeholder="np. PL12 1234 5678 9012 3456 7890 1234"
            value={value.bank_account_iban ?? ''}
            onChange={(e) => set('bank_account_iban', e.target.value)}
          />
          <p className="mt-0 text-xs text-muted-foreground">
            Wymagany przy formie płatności &quot;przelew&quot;. Rachunek nie jest wysyłany do KSeF przy gotówce.
          </p>
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
          <Input
            label="Link do płatności online (opcjonalnie)"
            placeholder="https://platnosc.example.com/faktura/..."
            value={value.payment_link ?? ''}
            onChange={(e) => set('payment_link', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Link do bramki płatniczej (max 512 znaków). Wysyłany do KSeF i widoczny dla nabywcy.
          </p>
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

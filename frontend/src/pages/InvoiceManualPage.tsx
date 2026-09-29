import { useMemo, useState, useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authStorage } from '@/services/api';
import { invoiceService } from '@/services/invoice.service';
import { useAllProductsQuery } from '@/query/use-products';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useCreateManualInvoiceMutation } from '@/query/use-invoices';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import { usePriceInputMode } from '@/hooks/usePriceInputMode';
import { InvoiceKsefOptions } from '@/components/features/invoicing/InvoiceKsefOptions';
import { cn } from '@/lib/utils';
import type {
  InvoiceKsefOptions as KsefOptionsType,
  InvoiceItemWrite,
  InvoicePaymentMethod,
  KsefInvoiceType,
  Company,
} from '@/types';

/* ─── Helpers ──────────────────────────────────────────────────────── */

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function todayIso(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDaysIso(isoYmd: string, days: number): string {
  const [y, m, d] = isoYmd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDateMed(isoDate: string): string {
  const d = new Date(isoDate);
  return isNaN(d.getTime()) ? isoDate : plDate.format(d);
}

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toDecimalInput(v: string): string {
  return v.replace(',', '.');
}

/* ─── Polish PLN → words ────────────────────────────────────────────── */
const ONES = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', 'dziesięć', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

function chunkToWords(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const t = Math.floor(rest / 10);
  const o = rest % 10;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]);
  if (t === 1) parts.push(TEENS[o]);
  else { if (t > 0) parts.push(TENS[t]); if (o > 0) parts.push(ONES[o]); }
  return parts.join(' ');
}

function plnToWords(amount: number): string {
  const zloty = Math.floor(Math.abs(amount));
  const grosze = Math.round((Math.abs(amount) - zloty) * 100);
  if (zloty === 0 && grosze === 0) return 'zero złotych 00/100';
  const millions = Math.floor(zloty / 1_000_000);
  const thousands = Math.floor((zloty % 1_000_000) / 1_000);
  const remainder = zloty % 1_000;
  const parts: string[] = [];
  if (millions > 0) {
    const w = chunkToWords(millions);
    parts.push(w, millions === 1 ? 'milion' : millions < 5 ? 'miliony' : 'milionów');
  }
  if (thousands > 0) {
    const w = chunkToWords(thousands);
    if (thousands === 1) parts.push('tysiąc');
    else if (thousands >= 2 && thousands <= 4) parts.push(w, 'tysiące');
    else parts.push(w, 'tysięcy');
  }
  if (remainder > 0) parts.push(chunkToWords(remainder));
  if (zloty === 0) parts.push('zero');
  const r = zloty % 10;
  const r100 = zloty % 100;
  let suffix: string;
  if (zloty === 1) suffix = 'złoty';
  else if (r >= 2 && r <= 4 && !(r100 >= 12 && r100 <= 14)) suffix = 'złote';
  else suffix = 'złotych';
  return `${parts.join(' ')} ${suffix} ${grosze.toString().padStart(2, '0')}/100`;
}

/* ─── Types ─────────────────────────────────────────────────────────── */

interface LineItem {
  id: number;
  product_id: string;
  product_name: string;
  product_unit: string;
  quantity: string;
  unit_price_net: string;
  vat_rate: string;
  stock_total?: string;
  sku?: string;
}

type ProductOption = {
  id: string;
  name: string;
  unit: string;
  sku: string;
  vat_rate?: string | number | null;
  price_net?: string | number | null;
  price_gross?: string | number | null;
  stock_total?: string | number | null;
};

let _lineId = 1;
function nextLineId() { return _lineId++; }

function emptyLine(name = ''): LineItem {
  return { id: nextLineId(), product_id: '', product_name: name, product_unit: 'szt', quantity: '1', unit_price_net: '', vat_rate: '23' };
}

function lineFromProduct(p: ProductOption, isGross: boolean): LineItem {
  const price = isGross ? p.price_gross : p.price_net;
  return {
    id: nextLineId(),
    product_id: p.id,
    product_name: p.name,
    product_unit: p.unit || 'szt',
    quantity: '1',
    unit_price_net: price != null ? String(price) : '',
    vat_rate: p.vat_rate != null ? String(p.vat_rate) : '23',
    stock_total: p.stock_total != null ? String(p.stock_total) : undefined,
    sku: p.sku || undefined,
  };
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const PAYMENT_OPTIONS: { value: InvoicePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Przelew bankowy' },
  { value: 'cash', label: 'Gotówka przy odbiorze' },
  { value: 'card', label: 'Karta płatnicza' },
];

const TERM_OPTIONS = [7, 14, 21, 30, 60];

function termLabel(days: number) { return `${days} dni`; }

/* ─── VAT breakdown ──────────────────────────────────────────────────── */

interface VatGroup { rate: string; net: number; vatAmt: number; gross: number }

function buildVatGroups(lines: LineItem[], isGross: boolean): VatGroup[] {
  const map: Record<string, VatGroup> = {};
  for (const l of lines) {
    const qty = parseNum(l.quantity);
    const price = parseNum(l.unit_price_net);
    const vat = parseNum(l.vat_rate);
    if (!qty || !price) continue;
    const gross = isGross ? qty * price : qty * price * (1 + vat / 100);
    const net = gross / (1 + vat / 100);
    const key = `${l.vat_rate}%`;
    if (!map[key]) map[key] = { rate: key, net: 0, vatAmt: 0, gross: 0 };
    map[key].net += net;
    map[key].vatAmt += gross - net;
    map[key].gross += gross;
  }
  return Object.values(map).sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
}

/* ─── Icons ─────────────────────────────────────────────────────────── */

function MinusIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="M5 12h14" strokeLinecap="round" /></svg>;
}
function PlusIconSm() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>;
}
function TrashIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SearchIcon() {
  return <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" /></svg>;
}
function ChevronDownIcon() {
  return <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/* ─── Invoice type dropdown ──────────────────────────────────────────── */

const INVOICE_TYPE_OPTIONS: { value: KsefInvoiceType; label: string; shortLabel: string; desc: string; warning?: string }[] = [
  {
    value: 'VAT',
    label: 'Podstawowa',
    shortLabel: 'Podstawowa',
    desc: 'Standardowa faktura VAT — najczęstszy przypadek.',
  },
  {
    value: 'ZAL',
    label: 'Zaliczkowa',
    shortLabel: 'Zaliczkowa',
    desc: 'Faktura zaliczkowa (ZAL) — wystawiana przed dostawą po otrzymaniu zaliczki. Wymaga późniejszej faktury rozliczeniowej.',
    warning: 'Typ ZAL jest obsługiwany przez KSeF, ale generowanie XML jest w trakcie implementacji. Wysyłka zostanie zablokowana.',
  },
  {
    value: 'ROZ',
    label: 'Rozliczeniowa',
    shortLabel: 'Rozliczeniowa',
    desc: 'Faktura rozliczeniowa (ROZ) — rozlicza wcześniej wystawione faktury zaliczkowe.',
    warning: 'Typ ROZ jest obsługiwany przez KSeF, ale generowanie XML jest w trakcie implementacji. Wysyłka zostanie zablokowana.',
  },
];

function InvoiceTypeDropdown({
  value,
  onChange,
}: {
  value: KsefInvoiceType;
  onChange: (v: KsefInvoiceType) => void;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const opt = INVOICE_TYPE_OPTIONS.find((o) => o.value === value) ?? INVOICE_TYPE_OPTIONS[0];

  return (
    <div className="flex items-center gap-1">
      {/* Native select styled as a pill */}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as KsefInvoiceType)}
          className="cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-1 pl-3 pr-7 text-[13px] font-semibold text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {INVOICE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>

      {/* ⓘ icon with tooltip */}
      <div className="relative">
        <button
          type="button"
          onMouseEnter={() => setTooltipOpen(true)}
          onMouseLeave={() => setTooltipOpen(false)}
          onFocus={() => setTooltipOpen(true)}
          onBlur={() => setTooltipOpen(false)}
          className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:text-primary"
          aria-label="Informacja o typie faktury"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
          </svg>
        </button>

        {tooltipOpen && (
          <div className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-lg">
            {/* arrow pointing up */}
            <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white" />
            <p className="mb-1 text-[13px] font-semibold text-slate-800">{opt.label}</p>
            <p className="text-[12px] leading-relaxed text-slate-500">{opt.desc}</p>
            {opt.warning && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-600">{opt.warning}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── LineRow ────────────────────────────────────────────────────────── */

function LineRow({
  line,
  index,
  onUpdate,
  onRemove,
  isGross,
  priceLabel,
}: {
  line: LineItem;
  index: number;
  onUpdate: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  isGross: boolean;
  priceLabel: string;
}) {
  const initial = (line.product_name || String.fromCharCode(65 + (index % 26))).charAt(0).toUpperCase();

  const lineGross = useMemo(() => {
    const qty = parseNum(line.quantity);
    const price = parseNum(line.unit_price_net);
    const vat = parseNum(line.vat_rate);
    return isGross ? qty * price : qty * price * (1 + vat / 100);
  }, [isGross, line.quantity, line.unit_price_net, line.vat_rate]);

  const lineNet = lineGross / (1 + parseNum(line.vat_rate) / 100);

  function adjustQty(delta: number) {
    const current = parseNum(line.quantity);
    const next = Math.max(0.001, current + delta);
    onUpdate({ quantity: Number.isInteger(next) ? String(next) : parseFloat(next.toFixed(3)).toString() });
  }

  const unitLabel = line.product_unit === 'szt' ? 'szt.' : (line.product_unit || 'szt.');

  const fieldClass = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-3 transition duration-200 hover:border-primary/30 hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] md:flex md:items-center md:gap-4 md:p-4">
      <div className="flex min-w-0 items-start justify-between gap-3 md:w-72 md:shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-sm font-bold text-primary md:h-11 md:w-11 md:rounded-2xl md:text-lg" aria-hidden>
            {initial}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {line.product_id ? (
                <p className="break-words text-xs font-bold text-slate-800 md:text-sm">{line.product_name}</p>
              ) : (
                <input
                  type="text"
                  value={line.product_name}
                  onChange={(e) => onUpdate({ product_name: e.target.value })}
                  placeholder="Nazwa…"
                  className="w-full min-w-0 bg-transparent text-xs font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:outline-none md:text-sm"
                  autoFocus
                />
              )}
            </div>
            {(line.sku || line.stock_total != null) && (
              <p className="mt-0.5 truncate text-[10px] text-slate-400 md:text-xs">
                {line.sku && `SKU: ${line.sku}`}
                {line.sku && line.stock_total != null && ' • '}
                {line.stock_total != null && `Magazyn: ${line.stock_total} ${line.product_unit}`}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 md:hidden"
          aria-label="Usuń pozycję"
        >
          <TrashIcon />
        </button>
      </div>

      <div className="mt-2.5 flex flex-1 flex-wrap items-center gap-2 border-t border-slate-200/50 pt-2.5 md:mt-0 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6 md:border-0 md:pt-0">
        <div className="flex flex-wrap items-center gap-2 md:justify-self-start">
        <div className="flex items-center rounded-2xl border border-slate-200/80 bg-slate-50 p-0.5 md:p-1">
          <button
            type="button"
            onClick={() => adjustQty(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 active:scale-90 md:h-8 md:w-8 md:rounded-xl"
            aria-label="Zmniejsz ilość"
          >
            <MinusIcon />
          </button>
          <input
            type="text"
            inputMode="decimal"
            value={line.quantity}
            onChange={(e) => onUpdate({ quantity: toDecimalInput(e.target.value) })}
            onFocus={(e) => e.target.select()}
            aria-label="Ilość"
            className="w-8 bg-transparent text-center text-xs font-bold tabular-nums text-slate-900 focus:outline-none md:w-12 md:text-sm"
          />
          <button
            type="button"
            onClick={() => adjustQty(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white transition hover:bg-primary/90 active:scale-90 md:h-8 md:w-8 md:rounded-xl"
            aria-label="Zwiększ ilość"
          >
            <PlusIconSm />
          </button>
        </div>

        {line.product_id ? (
          <span className="text-xs font-medium text-slate-500">{unitLabel}</span>
        ) : (
          <input
            type="text"
            value={line.product_unit}
            onChange={(e) => onUpdate({ product_unit: e.target.value })}
            placeholder="szt."
            aria-label="Jednostka miary"
            className="w-12 bg-transparent text-center text-xs font-medium text-slate-500 placeholder:text-slate-300 focus:outline-none focus:border-b focus:border-primary"
          />
        )}

        <div className="relative w-24 md:w-28">
          <input
            type="text"
            inputMode="decimal"
            value={line.unit_price_net}
            onChange={(e) => onUpdate({ unit_price_net: toDecimalInput(e.target.value) })}
            onFocus={(e) => e.target.select()}
            placeholder="0,00"
            aria-label={priceLabel}
            className={cn(fieldClass, 'pr-7 text-right font-semibold')}
          />
          <span className="pointer-events-none absolute right-2.5 top-2 text-xs font-medium text-slate-400">zł</span>
        </div>

        {line.product_id ? (
          <span className="hidden rounded-lg bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-500 md:inline">
            {line.vat_rate === 'zw' ? 'ZW' : `VAT ${line.vat_rate}%`}
          </span>
        ) : (
          <select
            value={line.vat_rate}
            onChange={(e) => onUpdate({ vat_rate: e.target.value })}
            aria-label="Stawka VAT"
            className="hidden rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary md:inline"
          >
            {['0', '5', '8', '23', 'zw'].map((r) => (
              <option key={r} value={r}>{r === 'zw' ? 'ZW' : `VAT ${r}%`}</option>
            ))}
          </select>
        )}
        </div>

        <div className="ml-auto flex items-center gap-3 md:ml-0 md:justify-self-end">
          <div className="text-right">
            <p className="text-xs font-bold tabular-nums text-slate-900 md:text-sm">{pln.format(lineGross)}</p>
            <p className="text-[10px] tabular-nums text-slate-400 md:text-[11px]">
              netto: {pln.format(lineNet)}
              <span className="md:hidden"> • {line.vat_rate === 'zw' ? 'ZW' : `VAT ${line.vat_rate}%`}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 md:flex"
            aria-label="Usuń pozycję"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Annotation tooltip ─────────────────────────────────────────────── */

function AnnotationTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none"
        aria-label="Więcej informacji"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-slate-200 bg-white" />
          <p className="text-xs leading-relaxed text-slate-600">{text}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Product search bar ─────────────────────────────────────────────── */

function ProductSearchBar({
  products,
  onSelectProduct,
  onAddEmpty,
  isGross,
}: {
  products: ProductOption[];
  onSelectProduct: (p: ProductOption) => void;
  onAddEmpty: () => void;
  isGross: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 10);
  }, [products, search]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleSelect(p: ProductOption) {
    onSelectProduct(p);
    setSearch('');
    setOpen(false);
  }

  function handleAddFreeForm() {
    if (search.trim()) {
      // Add a free-form line with the typed name
      onAddEmpty();
    } else {
      onAddEmpty();
    }
    setSearch('');
  }

  return (
    <div ref={wrapRef} className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-slate-200/90 bg-slate-50/40 p-3 transition hover:border-primary/40 md:flex-row md:items-center md:p-4">
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <SearchIcon />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Szukaj produktu lub kod SKU (np. Chleb wiejski, Bułka grahamka...)"
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
        {open && (
          <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-2xl border border-border bg-background shadow-lg">
            {suggestions.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">Brak wyników — dodaj ręcznie</li>
            ) : (
              suggestions.map((p) => {
                const price = isGross ? parseNum(p.price_gross) : parseNum(p.price_net);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-muted"
                      onMouseDown={() => handleSelect(p)}
                    >
                      <div>
                        <span className="text-sm font-medium text-foreground">{p.name}</span>
                        {p.sku && <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>}
                      </div>
                      {price > 0 && (
                        <span className="ml-3 shrink-0 text-sm tabular-nums text-muted-foreground">{pln.format(price)}</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={handleAddFreeForm}
        className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-indigo-100 active:scale-95 md:bg-white md:border-slate-200 md:px-5 md:py-2.5 md:text-slate-700 md:hover:bg-slate-50"
      >
        <PlusIconSm />
        <span className="hidden sm:inline">Dodaj pozycję</span>
        <span className="sm:hidden">Dodaj</span>
      </button>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────── */

export function InvoiceManualPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <InvoiceManualPageContent />;
}

function InvoiceManualPageContent() {
  const navigate = useNavigate();
  const { isGross, priceLabel } = usePriceInputMode();

  /* ── Customer ── */
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerNip, setCustomerNip] = useState('');
  const [customerCity, setCustomerCity] = useState('');
  const [customerStreet, setCustomerStreet] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerWrapRef = useRef<HTMLDivElement>(null);

  /* ── Lines ── */
  const [lines, setLines] = useState<LineItem[]>([]);

  /* ── Dates ── */
  const [issueDate, setIssueDate] = useState(todayIso());
  const [saleDate, setSaleDate] = useState(todayIso());
  const [saleDateTo, setSaleDateTo] = useState(todayIso());
  const [saleDateType, setSaleDateType] = useState<'single' | 'period' | 'issue' | 'various'>('single');
  const [paymentTermDays, setPaymentTermDays] = useState(14);

  /* derived — not stored separately */
  const dueDate = addDaysIso(issueDate, paymentTermDays);

  /* ── Payment & KSeF ── */
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('transfer');
  const [invoiceType, setInvoiceType] = useState<KsefInvoiceType>('VAT');
  const [notes, setNotes] = useState('');
  const [ksefOptions, setKsefOptions] = useState<KsefOptionsType>({});
  const [ksefOpen, setKsefOpen] = useState(false);
  const [invoiceNumberOverride, setInvoiceNumberOverride] = useState('');
  const [numberEditingHeader, setNumberEditingHeader] = useState(false);
  const [placeOfIssue, setPlaceOfIssue] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── Next invoice number preview ── */
  const { data: nextNumberData } = useQuery({
    queryKey: ['invoice-next-number', issueDate],
    queryFn: () => invoiceService.nextNumber(issueDate).then((r) => r),
    staleTime: 30_000,
  });

  /* ── Company defaults ── */
  const resolved = useResolvedCompanyId();
  const company = resolved.state === 'ready' ? (resolved.company as Company | undefined) : undefined;

  useEffect(() => {
    if (!company) return;
    setKsefOptions((prev) => ({
      bank_account_iban: company.bank_account_iban ?? '',
      bank_swift: company.bank_swift ?? '',
      bank_name: company.bank_name ?? '',
      ...prev,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.bank_account_iban, company?.bank_swift, company?.bank_name]);

  /* Warn on tab close */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (customerId) e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [customerId]);

  /* ── Data ── */
  const { data: customersData } = useAllActiveCustomersQuery(customerSearch);
  const customers = useMemo(() => customersData?.results ?? [], [customersData]);

  const { data: productsData } = useAllProductsQuery();
  const products = useMemo<ProductOption[]>(
    () => (productsData?.results ?? []).map((p) => ({
      id: p.id, name: p.name, unit: p.unit ?? 'szt', sku: p.sku ?? '',
      vat_rate: p.vat_rate, price_net: p.price_net, price_gross: p.price_gross,
      stock_total: (p as { stock_total?: string | number }).stock_total,
    })),
    [productsData],
  );

  /* ── Close customer dropdown on outside click ── */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (customerWrapRef.current && !customerWrapRef.current.contains(e.target as Node))
        setShowCustomerDropdown(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /* ── Customer select ── */
  function selectCustomer(c: { id: string; name: string; nip?: string | null; city?: string | null; street?: string | null; payment_terms?: number | null }) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerNip(c.nip ?? '');
    setCustomerCity(c.city ?? '');
    setCustomerStreet(c.street ?? '');
    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
    const t = typeof c.payment_terms === 'number' && Number.isFinite(c.payment_terms) ? c.payment_terms : 14;
    // Pick closest preset
    const closest = TERM_OPTIONS.reduce((prev, curr) => Math.abs(curr - t) < Math.abs(prev - t) ? curr : prev);
    setPaymentTermDays(closest);
  }

  function clearCustomer() {
    setCustomerId(''); setCustomerName(''); setCustomerNip(''); setCustomerCity(''); setCustomerStreet('');
    setCustomerSearch('');
  }

  /* ── Lines ── */
  function addProductLine(p: ProductOption) {
    setLines((prev) => [...prev, lineFromProduct(p, isGross)]);
  }

  function addEmptyLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function updateLine(id: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: number) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  /* ── Totals ── */
  const totalGross = useMemo(() => lines.reduce((sum, l) => {
    const qty = parseNum(l.quantity);
    const price = parseNum(l.unit_price_net);
    const vat = parseNum(l.vat_rate);
    return sum + (isGross ? qty * price : qty * price * (1 + vat / 100));
  }, 0), [isGross, lines]);

  const totalNet = useMemo(() => lines.reduce((sum, l) => {
    const qty = parseNum(l.quantity);
    const price = parseNum(l.unit_price_net);
    const vat = parseNum(l.vat_rate);
    const gross = isGross ? qty * price : qty * price * (1 + vat / 100);
    return sum + gross / (1 + vat / 100);
  }, 0), [isGross, lines]);

  const vatGroups = useMemo(() => buildVatGroups(lines, isGross), [lines, isGross]);

  const canSubmit = customerId !== '' && lines.some((l) => l.product_name.trim() && l.unit_price_net);

  function linesLabel(n: number) {
    if (n === 1) return '1 pozycja';
    if (n >= 2 && n <= 4) return `${n} pozycje`;
    return `${n} pozycji`;
  }

  /* ── Submit ── */
  const createManual = useCreateManualInvoiceMutation();

  async function onSubmit() {
    setSubmitError(null);
    if (!customerId) return;
    const validLines = lines.filter((l) => l.product_name.trim() && l.unit_price_net);
    if (validLines.length === 0) { setSubmitError('Dodaj przynajmniej jedną pozycję z ceną.'); return; }
    const items: InvoiceItemWrite[] = validLines.map((l) => ({
      product: l.product_id || undefined,
      product_name: l.product_name,
      product_unit: l.product_unit,
      quantity: l.quantity,
      ...(isGross ? { unit_price_gross: l.unit_price_net } : { unit_price_net: l.unit_price_net }),
      vat_rate: l.vat_rate === 'zw' ? '0' : l.vat_rate,
    }));
    try {
      const inv = await createManual.mutateAsync({
        customer_id: customerId,
        items,
        issue_date: issueDate,
        sale_date: saleDate,
        sale_date_to: saleDateType === 'period' ? saleDateTo : undefined,
        sale_date_type: saleDateType,
        due_date: dueDate,
        payment_method: paymentMethod,
        notes: notes || undefined,
        ...ksefOptions,
        ksef_invoice_type: invoiceType,
        prices_include_vat: isGross,
        invoice_number: invoiceNumberOverride.trim() || undefined,
        place_of_issue: placeOfIssue.trim() || undefined,
      });
      navigate(`/invoices/${inv.id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się wystawić faktury');
    }
  }

  /* ───────────────────────── RENDER ──────────────────────────────── */

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col">

      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/80 px-4 py-3 backdrop-blur-md md:px-8 md:py-0 md:h-20">
        <div className="flex items-center justify-between gap-3 md:h-full">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 active:scale-95 md:h-10 md:w-10"
              aria-label="Wróć"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5}>
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-bold tracking-tight text-slate-900 md:text-xl">
                  <span className="md:hidden">Nowa Faktura</span>
                  <span className="hidden md:inline">Ręcznie — Nowa Faktura</span>
                </h1>
                <span className="inline-flex shrink-0 items-center rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-primary md:px-2.5 md:text-xs">
                  Szkic
                </span>
              </div>
              <p className="truncate text-[11px] text-slate-500 md:text-xs">
                {customerName ? (
                  <>
                    <span className="md:hidden">{customerName}</span>
                    <span className="hidden md:inline">Klient powiązany: <span className="font-medium text-slate-700">{customerName}</span></span>
                  </>
                ) : (
                  'Wybierz klienta i dodaj pozycje'
                )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* Invoice type dropdown — desktop */}
            <div className="hidden md:block">
              <InvoiceTypeDropdown value={invoiceType} onChange={setInvoiceType} />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center md:hidden">
          <InvoiceTypeDropdown value={invoiceType} onChange={setInvoiceType} />
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex flex-col gap-5 px-4 pt-5 pb-[calc(76px+90px+env(safe-area-inset-bottom))] md:pb-[calc(90px+env(safe-area-inset-bottom))]">

        {/* ── Numer faktury + daty ── */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] md:rounded-3xl">
          <div className="grid grid-cols-2 divide-x divide-slate-100 md:grid-cols-4">

            {/* Numer faktury */}
            <div className="flex flex-col gap-1 px-4 py-3.5 md:px-5">
              <span className="text-[10px] font-medium text-muted-foreground">Numer faktury</span>
              {numberEditingHeader ? (
                <input
                  type="text"
                  value={invoiceNumberOverride}
                  onChange={(e) => setInvoiceNumberOverride(e.target.value)}
                  onBlur={() => setNumberEditingHeader(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setNumberEditingHeader(false); }}
                  placeholder={nextNumberData?.next_number ?? '…'}
                  autoFocus
                  className="w-full rounded-md border border-primary/30 bg-transparent px-1.5 py-0.5 text-sm font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setNumberEditingHeader(true)}
                  className="group flex items-center gap-1.5 text-left"
                >
                  <span className="text-sm font-semibold text-foreground">
                    {invoiceNumberOverride || nextNumberData?.next_number || '—'}
                  </span>
                  <svg className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              {!invoiceNumberOverride && (
                <span className="text-[10px] text-muted-foreground/60">Nadany automatycznie</span>
              )}
            </div>

            {/* Data wystawienia */}
            <div className="flex flex-col gap-1 px-4 py-3.5 md:px-5">
              <span className="text-[10px] font-medium text-muted-foreground">Data wystawienia</span>
              <label className="group flex cursor-pointer items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground">{formatDateMed(issueDate)}</span>
                <svg className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round"/></svg>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="sr-only"
                />
              </label>
            </div>

            {/* Data sprzedaży */}
            <div className="flex flex-col gap-1 px-4 py-3.5 md:px-5">
              <span className="text-[10px] font-medium text-muted-foreground">Data sprzedaży</span>
              <label className="group flex cursor-pointer items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground">{formatDateMed(saleDate)}</span>
                <svg className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round"/></svg>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="sr-only"
                />
              </label>
            </div>

            {/* Termin płatności */}
            <div className="flex flex-col gap-1 px-4 py-3.5 md:px-5">
              <span className="text-[10px] font-medium text-muted-foreground">Termin płatności</span>
              <span className="text-sm font-semibold text-foreground">{formatDateMed(dueDate)}</span>
              <span className="text-[10px] text-muted-foreground/60">{paymentTermDays} dni</span>
            </div>

          </div>
        </div>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] md:rounded-3xl md:p-6">
          <div className="mb-2.5 flex items-center justify-between md:mb-4">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Klient</h2>
            {customerId && (
              <button type="button" onClick={clearCustomer} className="flex items-center gap-0.5 text-xs font-semibold text-primary hover:text-primary/80">
                <span className="md:hidden">Zmień</span>
                <span className="hidden md:inline">Zmień klienta</span>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>

          {!customerId ? (
            <div ref={customerWrapRef} className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(''); setShowCustomerDropdown(true); }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="Wyszukaj klienta po nazwie lub NIP…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                autoFocus
              />
              {showCustomerDropdown && customers.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-lg">
                  {customers.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                        onMouseDown={() => selectCustomer(c)}
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.nip && <span className="ml-2 text-xs text-slate-400">NIP: {c.nip}</span>}
                        {c.city && <span className="ml-2 text-xs text-slate-400">{c.city}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 md:gap-4 md:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-primary md:h-12 md:w-12 md:rounded-2xl" aria-hidden>
                <svg className="h-5 w-5 md:h-6 md:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="truncate text-sm font-bold text-slate-900 md:text-base">{customerName}</h3>
                  <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 md:px-2 md:text-[11px]">
                    <span className="md:hidden">Stały odbiorca</span>
                    <span className="hidden md:inline">Aktywny stały odbiorca</span>
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500 md:text-xs">
                  {customerNip && <span>NIP: {customerNip}</span>}
                  {customerNip && (customerCity || customerStreet) && <span> • </span>}
                  {(customerCity || customerStreet) && (
                    <span>{[customerCity, customerStreet].filter(Boolean).join(', ')}</span>
                  )}
                  <span className="hidden md:inline"> • Płatność: Przelew {paymentTermDays} dni</span>
                  <span className="md:hidden"> • Przelew {paymentTermDays} dni</span>
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] md:rounded-3xl md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-slate-900 md:text-base">Pozycje faktury</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 md:hidden">{lines.length}</span>
              </div>
            </div>
            <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 md:inline">
              {linesLabel(lines.length)}
            </span>
            <span className="text-[11px] text-slate-400 md:hidden">Cennik</span>
          </div>

          {lines.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {lines.map((line, i) => (
                <LineRow
                  key={line.id}
                  index={i}
                  line={line}
                  onUpdate={(patch) => updateLine(line.id, patch)}
                  onRemove={() => removeLine(line.id)}
                  isGross={isGross}
                  priceLabel={priceLabel}
                />
              ))}
            </div>
          )}

          <ProductSearchBar
            products={products}
            onSelectProduct={addProductLine}
            onAddEmpty={addEmptyLine}
            isGross={isGross}
          />
        </section>

        <div className="flex flex-col gap-5">

          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] md:rounded-3xl md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 md:text-xs">
                  Podsumowanie kwot
                </h2>
                <p className="mt-2 max-w-md text-[11px] capitalize text-slate-400">
                  Słownie: {plnToWords(totalGross)}
                </p>
                <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Poprawne przeliczenie
                </p>
              </div>
              <div className="w-full space-y-2 text-xs md:w-72">
                <div className="flex items-center justify-between text-slate-500">
                  <span>Wartość netto</span>
                  <span className="font-medium text-slate-800">{pln.format(totalNet)}</span>
                </div>
                {vatGroups.length === 0 ? (
                  <div className="flex items-center justify-between text-slate-500">
                    <span>VAT</span>
                    <span className="font-medium text-slate-800">{pln.format(0)}</span>
                  </div>
                ) : (
                  vatGroups.map((g) => (
                    <div key={g.rate} className="flex items-center justify-between text-slate-500">
                      <span>Stawka VAT {g.rate}</span>
                      <span className="font-medium text-slate-800">{pln.format(g.vatAmt)}</span>
                    </div>
                  ))
                )}
                <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
                  <span className="text-sm font-bold text-slate-900">Do zapłaty (Brutto)</span>
                  <span className="text-2xl font-bold tracking-tight text-primary">{pln.format(totalGross)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Płatność i dostawa ── */}
          <div className="rounded-3xl bg-card p-5 shadow-[0_2px_12px_rgba(26,28,31,0.07)]">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Płatność i dostawa
            </h2>
            <div className="grid gap-3.5 md:grid-cols-3">

              {/* Metoda płatności */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Metoda płatności
                </label>
                <div className="relative">
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod)}
                    className="w-full appearance-none rounded-xl border border-input bg-background px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    {PAYMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><ChevronDownIcon /></span>
                </div>
              </div>

              {/* Termin płatności (dni) */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Termin płatności
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <select
                      value={paymentTermDays}
                      onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                      className="w-full appearance-none rounded-xl border border-input bg-background px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                    >
                      {TERM_OPTIONS.map((d) => (
                        <option key={d} value={d}>{termLabel(d)}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><ChevronDownIcon /></span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    → {formatDateMed(dueDate)}
                  </span>
                </div>
              </div>

              {/* Wybierz datę albo okres (P_6) */}
              <div className="md:col-span-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Wybierz datę albo okres, którego dotyczy faktura
                </label>
                <div className="relative">
                  <select
                    value={saleDateType}
                    onChange={(e) => setSaleDateType(e.target.value as typeof saleDateType)}
                    className="w-full appearance-none rounded-xl border border-input bg-background px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  >
                    <option value="single">Wspólna dla całej faktury data dokonania lub zakończenia dostawy towarów lub wykonania usługi</option>
                    <option value="period">Okres, którego dotyczy faktura (art. 19a ust. 3/4/5)</option>
                    <option value="issue">Data wystawienia jest taka sama jak data wykonania czynności</option>
                    <option value="various">Różne daty dla poszczególnych towarów lub usług</option>
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><ChevronDownIcon /></span>
                </div>
              </div>

              {/* Data dostawy/wykonania — tylko dla 'single' */}
              {saleDateType === 'single' && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Data dostawy / wykonania usługi
                  </label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                    required
                  />
                </div>
              )}

              {/* Zakres dat — tylko dla 'period' */}
              {saleDateType === 'period' && (
                <>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Data początkowa okresu
                    </label>
                    <input
                      type="date"
                      value={saleDate}
                      onChange={(e) => setSaleDate(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Data końcowa okresu
                    </label>
                    <input
                      type="date"
                      value={saleDateTo}
                      onChange={(e) => setSaleDateTo(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                      required
                    />
                  </div>
                </>
              )}

              {/* Adnotacje */}
              <div className="md:col-span-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Adnotacje
                </p>
                <div className="flex flex-wrap gap-3">
                  {/* MPP */}
                  <div className="flex items-center gap-1.5">
                    <label className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                      ksefOptions.annotation_mpp
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : 'border-input bg-background text-foreground hover:border-primary/30',
                    )}>
                      <input
                        type="checkbox"
                        checked={!!ksefOptions.annotation_mpp}
                        onChange={(e) => setKsefOptions((prev) => ({ ...prev, annotation_mpp: e.target.checked }))}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="font-medium">Mechanizm podzielonej płatności</span>
                    </label>
                    <AnnotationTooltip text="Zaznacz gdy wartość faktury przekracza 15 000 zł brutto i dotyczy towarów/usług z załącznika nr 15 do ustawy o VAT. Przy płatności bank automatycznie rozdziela kwotę VAT na specjalny rachunek VAT nabywcy." />
                  </div>
                  {/* Metoda kasowa */}
                  <div className="flex items-center gap-1.5">
                    <label className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                      ksefOptions.annotation_kasowa
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : 'border-input bg-background text-foreground hover:border-primary/30',
                    )}>
                      <input
                        type="checkbox"
                        checked={!!ksefOptions.annotation_kasowa}
                        onChange={(e) => setKsefOptions((prev) => ({ ...prev, annotation_kasowa: e.target.checked }))}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="font-medium">Metoda kasowa</span>
                    </label>
                    <AnnotationTooltip text="Zaznacz jeśli rozliczasz VAT metodą kasową (mały podatnik VAT). Obowiązek podatkowy powstaje dopiero w momencie otrzymania zapłaty od nabywcy, a nie w dniu wystawienia faktury." />
                  </div>
                </div>
              </div>

              {/* Miejsce wystawienia */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Miejsce wystawienia <span className="normal-case font-normal">(opcjonalne)</span>
                </label>
                <input
                  type="text"
                  value={placeOfIssue}
                  onChange={(e) => setPlaceOfIssue(e.target.value)}
                  placeholder="Domyślnie: miasto firmy"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </div>

              {/* Uwagi */}
              <div className="md:col-span-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Uwagi na fakturze
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Np. Numer zamówienia klienta: ZAM/2026/09/88"
                  className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ══ KSeF accordion ══ */}
        <div className="rounded-3xl bg-card shadow-[0_2px_12px_rgba(26,28,31,0.07)] overflow-hidden">
          <button
            type="button"
            onClick={() => setKsefOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Opcje KSeF (adnotacje, oznaczenia…)
            </span>
            <svg viewBox="0 0 24 24" fill="none" className={cn('h-4 w-4 text-muted-foreground transition-transform', ksefOpen && 'rotate-180')} stroke="currentColor" strokeWidth={2}>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {ksefOpen && (
            <div className="border-t border-border/40 px-5 pb-5 pt-4">
              <InvoiceKsefOptions
                value={ksefOptions}
                onChange={(patch) => setKsefOptions((prev) => ({ ...prev, ...patch }))}
                paymentMethod={paymentMethod}
              />
            </div>
          )}
        </div>

        {/* Error */}
        {submitError && (
          <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}
      </div>

      {/* ── Fixed bottom action bar ── */}
      <div className="fixed bottom-[83px] left-0 right-0 z-30 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur md:bottom-0">
        {/* Desktop layout */}
        <div className="hidden items-center gap-3 sm:flex">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            ← Wstecz
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={createManual.isPending || !canSubmit}
            className="rounded-2xl border border-primary/50 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Zapisz jako wersję roboczą
          </button>
          {/* Pill */}
          <div className="ml-auto flex items-center gap-2.5 rounded-full bg-primary/10 px-4 py-1.5">
            <span className="text-[13px] font-semibold tabular-nums text-primary">
              {linesLabel(lines.filter((l) => l.product_name.trim()).length)}
            </span>
            <span className="h-1 w-1 rounded-full bg-primary/40" />
            <span className="text-[13px] font-bold tabular-nums text-primary">{pln.format(totalGross)} brutto</span>
          </div>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={createManual.isPending || !canSubmit}
            className={cn(
              'flex items-center gap-2 rounded-2xl py-2.5 pl-5 pr-4 text-sm font-semibold transition-colors',
              !createManual.isPending && canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            <span>{createManual.isPending ? 'Tworzenie…' : 'Wystaw fakturę'}</span>
            {!createManual.isPending && <span className="text-base">→</span>}
          </button>
        </div>

        {/* Mobile layout */}
        <div className="flex items-center gap-2 sm:hidden">
          {/* Count pill */}
          <div className="flex flex-col items-start rounded-2xl bg-primary/10 px-3 py-1.5 leading-tight">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {lines.filter((l) => l.product_name.trim()).length} pozycji
            </span>
            <span className="text-[13px] font-bold tabular-nums text-primary">{pln.format(totalGross)} brutto</span>
          </div>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={createManual.isPending || !canSubmit}
            className="rounded-2xl border border-primary/50 px-3 py-2.5 text-sm font-semibold text-primary disabled:opacity-50"
          >
            Szkic
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={createManual.isPending || !canSubmit}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-semibold transition-colors',
              !createManual.isPending && canSubmit
                ? 'bg-primary text-primary-foreground'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            {createManual.isPending ? 'Tworzenie…' : 'Wystaw fakturę →'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authStorage } from '@/services/api';
import { invoiceService } from '@/services/invoice.service';
import { useAllProductsQuery } from '@/query/use-products';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useCreateManualInvoiceMutation, useAvailableZalQuery } from '@/query/use-invoices';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import { usePriceInputMode } from '@/hooks/usePriceInputMode';
import { InvoiceKsefOptions } from '@/components/features/invoicing/InvoiceKsefOptions';
import { cn } from '@/lib/utils';
import type {
  AvailableZalInvoice,
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

export function formatDateMed(isoDate: string): string {
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

export function plnToWords(amount: number): string {
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
  { value: 'cash', label: 'Gotówka' },
  { value: 'card', label: 'Karta płatnicza' },
  { value: 'voucher', label: 'Bon' },
  { value: 'check', label: 'Czek' },
  { value: 'credit', label: 'Kredyt' },
  { value: 'mobile', label: 'Płatność mobilna' },
  { value: 'other', label: 'Inna forma płatności' },
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

type SectionIconName = 'hash' | 'calendar' | 'user' | 'list' | 'receipt' | 'card' | 'sliders' | 'file' | 'bank' | 'truck' | 'link' | 'tag' | 'scroll';

function SectionIcon({ name, className = 'h-4 w-4' }: { name: SectionIconName; className?: string }) {
  const props = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;
  switch (name) {
    case 'hash':
      return <svg {...props}><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'calendar':
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" /></svg>;
    case 'user':
      return <svg {...props}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" /><circle cx="12" cy="7" r="4" /></svg>;
    case 'list':
      return <svg {...props}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" /></svg>;
    case 'receipt':
      return <svg {...props}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" strokeLinejoin="round" /><path d="M9 7h6M9 11h6M9 15h4" strokeLinecap="round" /></svg>;
    case 'card':
      return <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" strokeLinecap="round" /></svg>;
    case 'sliders':
      return <svg {...props}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" strokeLinecap="round" /></svg>;
    case 'file':
      return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinejoin="round" /><path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" /></svg>;
    case 'bank':
      return <svg {...props}><path d="M3 10h18M5 10v8M10 10v8M14 10v8M19 10v8M3 18h18M12 3l9 7H3l9-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'truck':
      return <svg {...props}><path d="M1 7h13v10H1zM14 10h5l3 3v4h-8" strokeLinejoin="round" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
    case 'link':
      return <svg {...props}><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1.5 1.5" strokeLinecap="round" /><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7L13 18" strokeLinecap="round" /></svg>;
    case 'tag':
      return <svg {...props}><path d="M20 13l-7 7-9-9V4h7l9 9z" strokeLinejoin="round" /><circle cx="7.5" cy="7.5" r="1" /></svg>;
    case 'scroll':
      return <svg {...props}><path d="M8 4h11a2 2 0 012 2v12a2 2 0 01-2 2H8" strokeLinejoin="round" /><path d="M8 4a2 2 0 00-2 2v14a2 2 0 104 0V6" strokeLinecap="round" /></svg>;
  }
}

export function SectionMark({ name }: { name: SectionIconName }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
      <SectionIcon name={name} />
    </span>
  );
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
    desc: 'Faktura zaliczkowa (ZAL) — wystawiana przed dostawą po otrzymaniu zaliczki. Wymaga późniejszej faktury rozliczeniowej (ROZ).',
  },
  {
    value: 'ROZ',
    label: 'Rozliczeniowa',
    shortLabel: 'Rozliczeniowa',
    desc: 'Faktura rozliczeniowa (ROZ) — rozlicza wcześniej wystawione faktury zaliczkowe (ZAL). Wybierz faktury ZAL do rozliczenia poniżej.',
  },
];

export function InvoiceTypeDropdown({
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
          className="select-pill cursor-pointer"
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

  const fieldClass = 'w-full field-ios-sm';

  return (
    <div className="rounded-xl border border-[#AEAEB2] bg-[#F2F2F7] p-3 md:flex md:items-center md:gap-4 md:p-4">
      <div className="flex min-w-0 items-start justify-between gap-3 md:w-72 md:shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-sm font-bold text-primary md:h-11 md:w-11 md:rounded-2xl md:text-lg" aria-hidden>
            {initial}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {line.product_id ? (
                <p className="break-words text-sm font-semibold text-slate-900">{line.product_name}</p>
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
              <p className="mt-0.5 truncate text-xs text-slate-600">
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
        <div className="flex items-center rounded-lg border border-[#AEAEB2] bg-white p-0.5">
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
            className="w-10 bg-transparent text-center text-sm font-semibold tabular-nums text-slate-900 focus:outline-none"
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
          <span className="text-sm font-medium text-slate-700">{unitLabel}</span>
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
            className={cn(fieldClass, 'bg-white pr-7 text-right font-semibold')}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-600">zł</span>
        </div>

        {line.product_id ? (
          <span className="hidden rounded-lg border border-[#AEAEB2] bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800 md:inline">
            {line.vat_rate === 'zw' ? 'ZW' : `VAT ${line.vat_rate}%`}
          </span>
        ) : (
          <div className="relative hidden md:block">
            <select
              value={line.vat_rate}
              onChange={(e) => onUpdate({ vat_rate: e.target.value })}
              aria-label="Stawka VAT"
              className="select-pill bg-white"
            >
              {['0', '5', '8', '23', 'zw'].map((r) => (
                <option key={r} value={r}>{r === 'zw' ? 'ZW' : `VAT ${r}%`}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
          </div>
        )}
        </div>

        <div className="ml-auto flex items-center gap-3 md:ml-0 md:justify-self-end">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-slate-900">{pln.format(lineGross)}</p>
            <p className="text-xs tabular-nums text-slate-600">
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

/* ─── Faktura details accordion ──────────────────────────────────────── */

export function InvoiceDetailsAccordion({
  footerText, onFooterTextChange,
  dueDateDescription, onDueDateDescriptionChange,
  placeOfIssue, onPlaceOfIssueChange,
}: {
  footerText: string; onFooterTextChange: (v: string) => void;
  dueDateDescription: string; onDueDateDescriptionChange: (v: string) => void;
  placeOfIssue: string; onPlaceOfIssueChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const filledCount = [footerText.trim(), dueDateDescription.trim(), placeOfIssue.trim()].filter(Boolean).length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SectionIcon name="file" />
          </span>
          <span className="text-sm font-semibold text-slate-900">Faktura</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && filledCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{filledCount} ustawione</span>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 md:px-6">

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Stopka faktury</label>
            <textarea
              value={footerText}
              onChange={(e) => onFooterTextChange(e.target.value)}
              rows={3}
              placeholder="Np. Numer zamówienia: ZAM/2026/09/88, dane kontaktowe, informacje o gwarancji…"
              className="field-ios-tall w-full resize-none"
            />
            <p className="mt-1.5 text-xs text-slate-500">{footerText.length} / 3 500 znaków</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Opis terminu płatności</label>
            <input
              type="text"
              value={dueDateDescription}
              onChange={(e) => onDueDateDescriptionChange(e.target.value)}
              placeholder="Np. Płatność przy odbiorze"
              maxLength={256}
              className="field-ios w-full"
            />
            <p className="mt-1.5 text-xs text-slate-500">Zastąpi datę terminu w KSeF</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Miejsce wystawienia</label>
            <input
              type="text"
              value={placeOfIssue}
              onChange={(e) => onPlaceOfIssueChange(e.target.value)}
              placeholder="Np. Kraków"
              className="field-ios w-full"
            />
            <p className="mt-1.5 text-xs text-slate-500">Domyślnie: miasto firmy</p>
          </div>

        </div>
      )}
    </div>
  );
}

/* ─── Annotations section ────────────────────────────────────────────── */

const ANNOTATIONS: {
  key: keyof KsefOptionsType;
  label: string;
  desc: string;
}[] = [
  { key: 'annotation_mpp',        label: 'MPP — Mechanizm podzielonej płatności', desc: 'Wymagany gdy faktura opiewa na ≥15 000 zł brutto i zawiera towary/usługi z załącznika nr 15 do ustawy VAT. Nabywca płaci VAT na osobny rachunek VAT.' },
  { key: 'annotation_kasowa',     label: 'Metoda kasowa',                          desc: 'Zaznacz jeśli rozliczasz VAT metodą kasową (art. 21 ust. 1). Obowiązek podatkowy powstaje z chwilą zapłaty, nie wystawienia faktury.' },
  { key: 'annotation_odwrotne',   label: 'Odwrotne obciążenie',                   desc: 'Podatek VAT rozlicza nabywca (np. złom, odpady, usługi budowlane w podwykonawstwie B2B).' },
  { key: 'annotation_trojstronna',label: 'Procedura trójstronna uproszczona',      desc: 'Wewnątrzwspólnotowe transakcje łańcuchowe z trzema podmiotami z różnych krajów UE (art. 135 ust. 1 pkt 4).' },
  { key: 'annotation_zwolnienie', label: 'Dostawa zwolniona z VAT',               desc: 'Towary/usługi zwolnione z VAT (art. 43 ust. 1, art. 113 ust. 1 i 9 lub art. 82 ust. 3).' },
  { key: 'annotation_marza',      label: 'Procedura marży',                        desc: 'Sprzedaż towarów używanych, dzieł sztuki, antyków lub biur podróży (art. 119/120). VAT od marży, nie od całej ceny.' },
  { key: 'annotation_oss',        label: 'Procedura OSS',                          desc: 'Sprzedaż B2C do konsumentów w innych krajach UE przez platformę OSS (limit 10 000 EUR).' },
  { key: 'annotation_tp',         label: 'TP — Powiązania między stronami',        desc: 'Nabywca i sprzedawca są podmiotami powiązanymi (rodzina, udziały ≥25%, wspólny zarząd). Wymagane w JPK.' },
  { key: 'annotation_fp',         label: 'FP — Faktura do paragonu',               desc: 'Faktura wystawiana na podstawie wcześniej wydrukowanego paragonu z kasy fiskalnej (art. 109 ust. 3d).' },
];

export function AnnotationsSection({
  value,
  onChange,
}: {
  value: KsefOptionsType;
  onChange: (patch: Partial<KsefOptionsType>) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = ANNOTATIONS.filter((a) => value[a.key]).length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SectionIcon name="tag" />
          </span>
          <span className="text-sm font-semibold text-slate-900">Adnotacje VAT</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && activeCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {activeCount} aktywne
            </span>
          )}
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {ANNOTATIONS.map((a) => {
            const isOss = value.annotation_oss;
            const disabledByOss = a.key === 'annotation_marza' && !!isOss;
            return (
            <label key={a.key} className={cn('flex items-start gap-3 px-4 py-3', disabledByOss ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-slate-50/70')}>
              <input
                type="checkbox"
                checked={!!value[a.key]}
                disabled={disabledByOss}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (a.key === 'annotation_oss' && checked) {
                    onChange({ annotation_oss: true, annotation_marza: false });
                  } else {
                    onChange({ [a.key]: checked });
                  }
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <div className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{a.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{a.desc}</span>
                {disabledByOss && (
                  <span className="mt-1 block text-[11px] text-amber-600">Niedostępne gdy zaznaczono Procedurę OSS</span>
                )}
              </div>
            </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Transaction conditions (Warunki transakcji) accordion ─────────── */

type ContractEntry = { date: string; number: string };

export function TransactionConditionsSection({
  contracts,
  onContractsChange,
  purchaseOrders,
  onPurchaseOrdersChange,
}: {
  contracts: ContractEntry[];
  onContractsChange: (v: ContractEntry[]) => void;
  purchaseOrders: ContractEntry[];
  onPurchaseOrdersChange: (v: ContractEntry[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function addContract() {
    onContractsChange([...contracts, { date: '', number: '' }]);
    if (!open) setOpen(true);
  }
  function removeContract(i: number) {
    onContractsChange(contracts.filter((_, idx) => idx !== i));
  }
  function updateContract(i: number, field: 'date' | 'number', val: string) {
    onContractsChange(contracts.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  }
  function addPO() {
    onPurchaseOrdersChange([...purchaseOrders, { date: '', number: '' }]);
    if (!open) setOpen(true);
  }
  function removePO(i: number) {
    onPurchaseOrdersChange(purchaseOrders.filter((_, idx) => idx !== i));
  }
  function updatePO(i: number, field: 'date' | 'number', val: string) {
    onPurchaseOrdersChange(purchaseOrders.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  }

  const filledCount = contracts.filter(c => c.date || c.number).length + purchaseOrders.filter(p => p.date || p.number).length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left hover:bg-slate-50 md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SectionIcon name="scroll" />
          </span>
          <span className="min-w-0 text-sm font-semibold text-slate-900">Warunki transakcji</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && filledCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {filledCount === 1 ? '1 pozycja' : filledCount < 5 ? `${filledCount} pozycje` : `${filledCount} pozycji`}
            </span>
          )}
          <svg viewBox="0 0 24 24" fill="none" className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} stroke="currentColor" strokeWidth={2}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 md:px-6">

          {/* Umowy */}
          <div>
            <p className="mb-2.5 text-sm font-medium text-slate-700">Umowy</p>
            {contracts.map((c, i) => (
              <div key={i} className="mb-2 flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Data umowy</label>
                  <input
                    type="date"
                    value={c.date}
                    onChange={e => updateContract(i, 'date', e.target.value)}
                    className="w-full field-ios-tall"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Numer umowy</label>
                  <input
                    type="text"
                    placeholder="np. UMOWA/2026/001"
                    value={c.number}
                    onChange={e => updateContract(i, 'number', e.target.value)}
                    className="w-full field-ios-tall"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeContract(i)}
                  className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20"
                  aria-label="Usuń umowę"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addContract}
              className="mt-1 text-sm font-medium text-primary hover:underline"
            >
              + Dodaj umowę
            </button>
          </div>

          {/* Zamówienia klienta */}
          <div>
            <p className="mb-2.5 text-sm font-medium text-slate-700">Zamówienia klienta (PO)</p>
            {purchaseOrders.map((p, i) => (
              <div key={i} className="mb-2 flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Data zamówienia</label>
                  <input
                    type="date"
                    value={p.date}
                    onChange={e => updatePO(i, 'date', e.target.value)}
                    className="w-full field-ios-tall"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Numer zamówienia</label>
                  <input
                    type="text"
                    placeholder="np. ZAM/2026/001"
                    value={p.number}
                    onChange={e => updatePO(i, 'number', e.target.value)}
                    className="w-full field-ios-tall"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePO(i)}
                  className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20"
                  aria-label="Usuń zamówienie"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addPO}
              className="mt-1 text-sm font-medium text-primary hover:underline"
            >
              + Dodaj zamówienie
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── ZAL selection section (for ROZ invoices) ───────────────────────── */

export function ZalSelectionSection({
  availableZal,
  selectedIds,
  onChange,
  customerId,
}: {
  availableZal: AvailableZalInvoice[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  customerId: string;
}) {
  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  const totalSelected = availableZal
    .filter((z) => selectedIds.includes(z.id))
    .reduce((sum, z) => sum + parseFloat(z.total_gross || '0'), 0);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
          Faktury zaliczkowe (ZAL) do rozliczenia
        </span>
        {selectedIds.length > 0 && (
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {selectedIds.length} wybrano · {pln.format(totalSelected)}
          </span>
        )}
      </div>

      {!customerId ? (
        <p className="text-xs text-slate-500">Wybierz klienta, aby zobaczyć dostępne faktury zaliczkowe.</p>
      ) : availableZal.length === 0 ? (
        <p className="text-xs text-slate-500">
          Brak nierozliczonych faktur zaliczkowych (ZAL) dla tego klienta.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {availableZal.map((zal) => {
            const checked = selectedIds.includes(zal.id);
            return (
              <label
                key={zal.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                  checked
                    ? 'border-amber-400 bg-amber-100'
                    : 'border-amber-200/70 bg-white hover:bg-amber-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(zal.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600"
                />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">
                    {zal.invoice_number ?? '—'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDateMed(zal.issue_date)} · {pln.format(parseFloat(zal.total_gross))} brutto
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {selectedIds.length === 0 && Boolean(customerId) && availableZal.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700">
          Zaznacz przynajmniej jedną fakturę zaliczkową, aby wystawić fakturę ROZ.
        </p>
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
    <div ref={wrapRef} className="flex flex-col gap-2 rounded-xl border border-dashed border-[#AEAEB2] bg-white p-3 md:flex-row md:items-center md:p-4">
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
  const skipCustomerAutoOpen = useRef(true);

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
  const [paymentReceivedAt, setPaymentReceivedAt] = useState<string | null>(null);
  const [otherPaymentDescription, setOtherPaymentDescription] = useState('');
  const [dueDateDescription, setDueDateDescription] = useState('');
  const [invoiceType, setInvoiceType] = useState<KsefInvoiceType>('VAT');
  const [selectedZalIds, setSelectedZalIds] = useState<string[]>([]);
  const [notes] = useState('');
  const [ksefOptions, setKsefOptions] = useState<KsefOptionsType>({});
  const [contracts, setContracts] = useState<{ date: string; number: string }[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<{ date: string; number: string }[]>([]);
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

  /* ── Available ZAL invoices (for ROZ type) ── */
  const { data: availableZal = [] } = useAvailableZalQuery(
    customerId || null,
    invoiceType === 'ROZ' && Boolean(customerId),
  );

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

  /* Auto-set payment received date for cash payments */
  useEffect(() => {
    if (paymentMethod === 'cash') {
      setPaymentReceivedAt((prev) => prev ?? issueDate);
    } else {
      setPaymentReceivedAt(null);
    }
  }, [paymentMethod, issueDate]);

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
  const amountInWords = plnToWords(totalGross);
  const amountInWordsLabel = amountInWords.charAt(0).toUpperCase() + amountInWords.slice(1);

  const canSubmit =
    customerId !== '' &&
    lines.some((l) => l.product_name.trim() && l.unit_price_net) &&
    (invoiceType !== 'ROZ' || selectedZalIds.length > 0);

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
        advance_invoice_ids: invoiceType === 'ROZ' ? selectedZalIds : undefined,
        payment_received_at: paymentReceivedAt || undefined,
        other_payment_description: paymentMethod === 'other' ? otherPaymentDescription : undefined,
        due_date_description: dueDateDescription.trim() || undefined,
        contracts: contracts.filter(c => c.date || c.number).length > 0
          ? contracts.filter(c => c.date || c.number)
          : undefined,
        purchase_orders: purchaseOrders.filter(p => p.date || p.number).length > 0
          ? purchaseOrders.filter(p => p.date || p.number)
          : undefined,
      });
      navigate(`/invoices/${inv.id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się wystawić faktury');
    }
  }

  /* ───────────────────────── RENDER ──────────────────────────────── */

  return createPortal(
    <div className="fixed inset-x-0 top-0 bottom-[83px] z-30 flex flex-col bg-[#F2F2F7] md:bottom-0 md:left-64">

      <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-3 md:flex md:h-20 md:items-center md:px-8 md:py-0">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
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
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-4">

        {/* ── Numer faktury + data wystawienia ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl">
          <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 md:px-6">

            <div>
              <div className="mb-1.5 flex items-center gap-2.5">
                <SectionMark name="hash" />
                <h2 className="text-sm font-semibold text-slate-900">Numer faktury</h2>
              </div>
              {numberEditingHeader ? (
                <input
                  type="text"
                  value={invoiceNumberOverride}
                  onChange={(e) => setInvoiceNumberOverride(e.target.value)}
                  onBlur={() => setNumberEditingHeader(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setNumberEditingHeader(false); }}
                  placeholder={nextNumberData?.next_number ?? '…'}
                  autoFocus
                  className="field-ios w-full"
                />
              ) : (
                <div className="flex h-[38px] items-center gap-1">
                  <span className="truncate rounded-lg bg-primary/10 px-2.5 py-1 text-base font-semibold tracking-tight text-primary">
                    {invoiceNumberOverride || nextNumberData?.next_number || '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNumberEditingHeader(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary/10"
                    aria-label="Zmień numer faktury"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              )}
              <p className="mt-1.5 text-xs text-slate-500">
                {invoiceNumberOverride ? 'Własny numer' : 'Nadany automatycznie'}
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-2.5">
                <SectionMark name="calendar" />
                <label htmlFor="issue-date" className="text-sm font-semibold text-slate-900">Data wystawienia</label>
              </div>
              <input
                id="issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="date-pill w-full"
              />
            </div>

          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-apple-sm transition hover:shadow-apple-md md:rounded-3xl md:p-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <SectionMark name="user" />
              <h2 className="text-sm font-semibold text-slate-900">Klient</h2>
            </div>
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
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(''); setShowCustomerDropdown(true); }}
                  onClick={() => setShowCustomerDropdown(true)}
                  onFocus={() => {
                    if (skipCustomerAutoOpen.current) {
                      skipCustomerAutoOpen.current = false;
                      return;
                    }
                    setShowCustomerDropdown(true);
                  }}
                  placeholder="Wyszukaj klienta po nazwie lub NIP…"
                  className="field-ios w-full pl-9"
                  autoFocus
                />
              </div>
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

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-apple-sm md:rounded-3xl md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <SectionMark name="list" />
                <h2 className="text-sm font-semibold text-slate-900">Pozycje faktury</h2>
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

        {/* ── Podsumowanie kwot ── */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl">
          <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5 md:px-6">
            <SectionMark name="receipt" />
            <h2 className="text-sm font-semibold text-slate-900">Podsumowanie kwot</h2>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
              <span className="text-sm text-slate-500">Wartość netto</span>
              <span className="text-sm font-medium tabular-nums text-slate-800">{pln.format(totalNet)}</span>
            </div>
            {vatGroups.length === 0 ? (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
                <span className="text-sm text-slate-500">VAT</span>
                <span className="text-sm font-medium tabular-nums text-slate-800">{pln.format(0)}</span>
              </div>
            ) : (
              vatGroups.map((g) => (
                <div key={g.rate} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
                  <span className="text-sm text-slate-500">Stawka VAT {g.rate}</span>
                  <span className="text-sm font-medium tabular-nums text-slate-800">{pln.format(g.vatAmt)}</span>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-slate-100 bg-primary/5 px-4 py-4 md:px-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-slate-800">Do zapłaty</span>
              <span className="text-3xl font-bold tabular-nums tracking-tight text-primary">{pln.format(totalGross)}</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              Słownie: {amountInWordsLabel}
            </p>
          </div>
        </section>

        {/* ── Płatność i dostawa ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl">
          <div className="divide-y divide-slate-100">

            {/* Nagłówek sekcji */}
            <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5 md:px-6">
              <SectionMark name="card" />
              <h2 className="text-sm font-semibold text-slate-900">Płatność i dostawa</h2>
            </div>

            <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">Metoda płatności</label>
                  <div className="relative">
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod)}
                      className="select-pill w-full"
                    >
                      {PAYMENT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">Termin płatności</label>
                  <div className="relative">
                    <select
                      value={paymentTermDays}
                      onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                      className="select-pill w-full"
                    >
                      {TERM_OPTIONS.map((d) => (
                        <option key={d} value={d}>{termLabel(d)}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                  {!dueDateDescription.trim() && (
                    <p className="mt-1.5 text-sm text-slate-700">do {formatDateMed(dueDate)}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-800">Data sprzedaży</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative sm:w-56 sm:shrink-0">
                    <select
                      value={saleDateType}
                      onChange={(e) => setSaleDateType(e.target.value as typeof saleDateType)}
                      className="select-pill w-full"
                    >
                      <option value="single">Konkretna data</option>
                      <option value="period">Okres od–do</option>
                      <option value="issue">= data wystawienia</option>
                      <option value="various">Różne daty</option>
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  </div>
                  {saleDateType === 'single' && (
                    <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="date-pill w-full sm:w-52" required />
                  )}
                  {saleDateType === 'period' && (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="date-pill min-w-0 flex-1" required />
                      <span className="text-base text-slate-500">—</span>
                      <input type="date" value={saleDateTo} onChange={(e) => setSaleDateTo(e.target.value)} className="date-pill min-w-0 flex-1" required />
                    </div>
                  )}
                  {saleDateType === 'issue' && (
                    <p className="text-sm text-slate-800">{formatDateMed(issueDate)}</p>
                  )}
                </div>
              </div>

              {paymentMethod === 'other' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">
                    Opis formy płatności <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={otherPaymentDescription}
                    onChange={(e) => setOtherPaymentDescription(e.target.value)}
                    placeholder="Np. płatność blikiem, kompensata..."
                    maxLength={256}
                    className="w-full field-ios"
                  />
                </div>
              )}

              {paymentMethod === 'cash' && (
                <div className="sm:max-w-xs">
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">Data otrzymania zapłaty</label>
                  <input
                    type="date"
                    value={paymentReceivedAt ?? issueDate}
                    onChange={(e) => setPaymentReceivedAt(e.target.value || null)}
                    className="date-pill w-full"
                  />
                </div>
              )}
            </div>

            {/* Faktury zaliczkowe ZAL */}
            {invoiceType === 'ROZ' && (
              <div className="px-4 py-3.5 md:px-6">
                <ZalSelectionSection
                  availableZal={availableZal}
                  selectedIds={selectedZalIds}
                  onChange={setSelectedZalIds}
                  customerId={customerId}
                />
              </div>
            )}
          </div>
        </section>

        {/* ── Dodatkowe opcje — pola fakultatywne ── */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl">
          <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
            <SectionMark name="sliders" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Dodatkowe opcje</h2>
              <p className="text-xs text-slate-400">Nie są wymagane do wystawienia faktury</p>
            </div>
          </div>
          <div className="divide-y divide-slate-200 border-t border-slate-200">
            <InvoiceDetailsAccordion
              footerText={ksefOptions.footer_text ?? ''}
              onFooterTextChange={(v) => setKsefOptions((prev) => ({ ...prev, footer_text: v }))}
              dueDateDescription={dueDateDescription}
              onDueDateDescriptionChange={setDueDateDescription}
              placeOfIssue={placeOfIssue}
              onPlaceOfIssueChange={setPlaceOfIssue}
            />
            <InvoiceKsefOptions
              value={ksefOptions}
              onChange={(patch) => setKsefOptions((prev) => ({ ...prev, ...patch }))}
              paymentMethod={paymentMethod}
            />
            <AnnotationsSection
              value={ksefOptions}
              onChange={(patch) => setKsefOptions((prev) => ({ ...prev, ...patch }))}
            />
            <TransactionConditionsSection
              contracts={contracts}
              onContractsChange={setContracts}
              purchaseOrders={purchaseOrders}
              onPurchaseOrdersChange={setPurchaseOrders}
            />
          </div>
        </section>

        {/* Error */}
        {submitError && (
          <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}
      </div>
      </div>

      {/* ── Bottom action bar. Sits under the scroller, so it does not move with the form. ── */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-3 pt-3">
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
          <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900">
            {pln.format(totalGross)} brutto
          </span>
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
          <span className="min-w-0 text-sm font-semibold tabular-nums text-slate-900">
            {pln.format(totalGross)}
          </span>
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
    </div>,
    document.body,
  );
}

import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authStorage } from '@/services/api';
import { invoiceService } from '@/services/invoice.service';
import { useAllProductsQuery } from '@/query/use-products';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useEditInvoiceMutation, useAvailableZalQuery, useInvoiceQuery, useInvoicePreviewQuery } from '@/query/use-invoices';
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
  InvoicePreviewLine,
} from '@/types';
import {
  InvoiceDetailsAccordion,
  AnnotationsSection,
  TransactionConditionsSection,
  ZalSelectionSection,
  SectionMark,
  InvoiceTypeDropdown,
  formatDateMed,
  plnToWords,
} from './InvoiceManualPage';

/* ─── Helpers (same as InvoiceManualPage) ──────────────────────────── */

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

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

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toDecimalInput(v: string): string {
  return v.replace(',', '.');
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
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
  pkwiu?: string;
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

let _lineId = 10000;
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

function lineFromPreview(l: InvoicePreviewLine, isGross: boolean): LineItem {
  return {
    id: nextLineId(),
    product_id: '',
    product_name: l.product_name,
    product_unit: l.product_unit,
    quantity: l.quantity,
    unit_price_net: isGross ? (l.unit_price_gross ?? l.unit_price_net) : l.unit_price_net,
    vat_rate: l.vat_rate,
    pkwiu: l.pkwiu || undefined,
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
            <input
              type="text"
              value={line.product_name}
              onChange={(e) => onUpdate({ product_name: e.target.value })}
              placeholder="Nazwa…"
              className="w-full min-w-0 bg-transparent text-xs font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:outline-none md:text-sm"
            />
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

        <input
          type="text"
          value={line.product_unit}
          onChange={(e) => onUpdate({ product_unit: e.target.value })}
          placeholder="szt."
          aria-label="Jednostka miary"
          className="w-12 bg-transparent text-center text-xs font-medium text-slate-500 placeholder:text-slate-300 focus:outline-none focus:border-b focus:border-primary"
        />

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
            placeholder="Szukaj produktu lub kod SKU..."
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
        onClick={onAddEmpty}
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

export function InvoiceEditPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <InvoiceEditPageContent />;
}

function InvoiceEditPageContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isGross, priceLabel } = usePriceInputMode();

  /* ── Load existing invoice ── */
  const { data: invoice, isLoading: invLoading } = useInvoiceQuery(id, Boolean(id));
  const { data: preview, isLoading: prevLoading } = useInvoicePreviewQuery(id, Boolean(id));

  /* ── Populated flag — true once state has been populated from invoice data ── */
  const [populated, setPopulated] = useState(false);

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
  const [dueDate, setDueDate] = useState('');

  /* ── Payment & KSeF ── */
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('transfer');
  const [paymentReceivedAt, setPaymentReceivedAt] = useState<string | null>(null);
  const [otherPaymentDescription, setOtherPaymentDescription] = useState('');
  const [dueDateDescription, setDueDateDescription] = useState('');
  const [invoiceType, setInvoiceType] = useState<KsefInvoiceType>('VAT');
  const [selectedZalIds, setSelectedZalIds] = useState<string[]>([]);
  const [ksefOptions, setKsefOptions] = useState<KsefOptionsType>({});
  const [contracts, setContracts] = useState<{ date: string; number: string }[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<{ date: string; number: string }[]>([]);
  const [invoiceNumberOverride, setInvoiceNumberOverride] = useState('');
  const [numberEditingHeader, setNumberEditingHeader] = useState(false);
  const [placeOfIssue, setPlaceOfIssue] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ── Available ZAL invoices (for ROZ type) ── */
  const { data: availableZal = [] } = useAvailableZalQuery(
    customerId || null,
    invoiceType === 'ROZ' && Boolean(customerId),
  );

  /* ── Company defaults ── */
  const resolved = useResolvedCompanyId();
  const company = resolved.state === 'ready' ? (resolved.company as Company | undefined) : undefined;

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

  /* ── Populate form from loaded invoice ── */
  useEffect(() => {
    if (populated || !invoice || !preview) return;

    // Customer
    setCustomerId(invoice.customer);
    setCustomerName(invoice.customer_name ?? '');
    setCustomerSearch(invoice.customer_name ?? '');
    setCustomerCity((invoice as Record<string, unknown>).customer_city as string ?? '');
    setCustomerStreet((invoice as Record<string, unknown>).customer_street as string ?? '');

    // Dates
    setIssueDate(invoice.issue_date);
    setSaleDate(invoice.sale_date);
    if (invoice.sale_date_to) setSaleDateTo(invoice.sale_date_to);
    setSaleDateType((invoice as Record<string, unknown>).sale_date_type as typeof saleDateType ?? 'single');
    setDueDate(invoice.due_date);

    // Compute payment term days from issue/due dates
    const days = daysBetween(invoice.issue_date, invoice.due_date);
    const closest = TERM_OPTIONS.reduce((prev, curr) => Math.abs(curr - days) < Math.abs(prev - days) ? curr : prev);
    setPaymentTermDays(closest);

    // Payment
    setPaymentMethod(invoice.payment_method);
    setPaymentReceivedAt(invoice.payment_received_at ?? null);
    setOtherPaymentDescription(invoice.other_payment_description ?? '');
    setDueDateDescription(invoice.due_date_description ?? '');

    // Invoice type
    setInvoiceType(invoice.ksef_invoice_type ?? 'VAT');

    // Number
    setInvoiceNumberOverride(invoice.invoice_number ?? '');

    // Place of issue
    setPlaceOfIssue(invoice.place_of_issue ?? '');

    // KSeF options
    setKsefOptions({
      annotation_mpp: invoice.annotation_mpp,
      annotation_kasowa: invoice.annotation_kasowa,
      annotation_odwrotne: invoice.annotation_odwrotne,
      annotation_trojstronna: invoice.annotation_trojstronna,
      annotation_zwolnienie: invoice.annotation_zwolnienie,
      annotation_marza: invoice.annotation_marza,
      annotation_tp: invoice.annotation_tp,
      annotation_fp: invoice.annotation_fp,
      annotation_oss: invoice.annotation_oss,
      bank_account_iban: invoice.bank_account_iban ?? '',
      bank_swift: invoice.bank_swift ?? '',
      bank_name: invoice.bank_name ?? '',
      payment_link: invoice.payment_link ?? '',
      ksef_payment_id: invoice.ksef_payment_id ?? '',
      discount_conditions: invoice.discount_conditions ?? '',
      footer_text: invoice.footer_text ?? '',
    });

    // Contracts and POs
    setContracts(invoice.contracts?.length ? invoice.contracts.map(c => ({ date: c.date ?? '', number: c.number ?? '' })) : []);
    setPurchaseOrders(invoice.purchase_orders?.length ? invoice.purchase_orders.map(p => ({ date: p.date ?? '', number: p.number ?? '' })) : []);

    // Line items from preview
    if (preview.lines?.length) {
      setLines(preview.lines.map((l: InvoicePreviewLine) => lineFromPreview(l, isGross)));
    }

    // ZAL links for ROZ
    if (invoice.advance_invoices_data?.length) {
      setSelectedZalIds(invoice.advance_invoices_data.map(a => a.id));
    }

    setPopulated(true);
  }, [invoice, preview, populated, isGross]);

  /* ── Compute due date from issue date + term days (only when user changes them) ── */
  useEffect(() => {
    if (!populated) return;
    setDueDate(addDaysIso(issueDate, paymentTermDays));
  }, [issueDate, paymentTermDays, populated]);

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

  function updateLine(lineId: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  }

  function removeLine(lineId: number) {
    setLines((prev) => prev.filter((l) => l.id !== lineId));
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

  /* ── Is this invoice linked to orders? ── */
  const hasLinkedOrders = Boolean(
    invoice?.orders_summary?.length ||
    invoice?.order_ids?.length ||
    invoice?.order
  );

  /* ── Submit ── */
  const editMutation = useEditInvoiceMutation();

  async function onSubmit() {
    setSubmitError(null);
    if (!id || !customerId) return;
    const validLines = lines.filter((l) => l.product_name.trim() && l.unit_price_net);
    if (validLines.length === 0) { setSubmitError('Dodaj przynajmniej jedną pozycję z ceną.'); return; }
    const items: Record<string, unknown>[] = validLines.map((l) => ({
      product_name: l.product_name,
      product_unit: l.product_unit,
      quantity: l.quantity,
      ...(isGross ? { unit_price_gross: l.unit_price_net } : { unit_price_net: l.unit_price_net }),
      vat_rate: l.vat_rate === 'zw' ? '0' : l.vat_rate,
      pkwiu: l.pkwiu || undefined,
    }));
    try {
      await editMutation.mutateAsync({
        id,
        data: {
          customer_id: customerId,
          items,
          issue_date: issueDate,
          sale_date: saleDate,
          sale_date_to: saleDateType === 'period' ? saleDateTo : undefined,
          sale_date_type: saleDateType,
          due_date: dueDate,
          payment_method: paymentMethod,
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
        },
      });
      navigate(`/invoices/${id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian');
    }
  }

  /* ── Loading states ── */
  const loading = invLoading || prevLoading;

  if (!id) return <Navigate to="/invoices" replace />;

  if (loading || !populated) {
    return createPortal(
      <div className="fixed inset-x-0 top-0 bottom-[83px] z-30 flex flex-col items-center justify-center bg-[#F2F2F7] md:bottom-0 md:left-64">
        <p className="text-sm text-muted-foreground">Ładowanie faktury...</p>
      </div>,
      document.body,
    );
  }

  if (invoice?.ksef_number) {
    return <Navigate to={`/invoices/${id}`} replace />;
  }

  /* ───────────────────────── RENDER ──────────────────────────────── */

  const invoiceLabel = invoice?.invoice_number || id.slice(0, 8);

  return createPortal(
    <div className="fixed inset-x-0 top-0 bottom-[83px] z-30 flex flex-col bg-[#F2F2F7] md:bottom-0 md:left-64">

      <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-3 md:flex md:h-20 md:items-center md:px-8 md:py-0">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => navigate(`/invoices/${id}`)}
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
                  Edytuj fakturę {invoiceLabel}
                </h1>
              </div>
              <p className="truncate text-[11px] text-slate-500 md:text-xs">
                {customerName ? (
                  <>
                    <span className="md:hidden">{customerName}</span>
                    <span className="hidden md:inline">Klient: <span className="font-medium text-slate-700">{customerName}</span></span>
                  </>
                ) : (
                  'Edycja danych faktury'
                )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
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

        {/* Order linkage warning */}
        {hasLinkedOrders && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Ta faktura jest powiązana z zamówieniem. Edycja spowoduje oznaczenie faktury jako ręcznie zmodyfikowanej.
          </div>
        )}

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
                  placeholder="Numer faktury"
                  autoFocus
                  className="field-ios w-full"
                />
              ) : (
                <div className="flex h-[38px] items-center gap-1">
                  <span className="truncate rounded-lg bg-primary/10 px-2.5 py-1 text-base font-semibold tracking-tight text-primary">
                    {invoiceNumberOverride || '—'}
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
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder="Wyszukaj klienta po nazwie lub NIP…"
                  className="field-ios w-full pl-9"
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
            <>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 md:gap-4 md:p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-primary md:h-12 md:w-12 md:rounded-2xl" aria-hidden>
                  <svg className="h-5 w-5 md:h-6 md:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-slate-900 md:text-base">{customerName}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500 md:text-xs">
                    {customerNip && <span>NIP: {customerNip}</span>}
                    {customerNip && (customerCity || customerStreet) && <span> • </span>}
                    {(customerCity || customerStreet) && (
                      <span>{[customerCity, customerStreet].filter(Boolean).join(', ')}</span>
                    )}
                  </p>
                </div>
              </div>
              {!customerCity && !customerStreet && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p className="text-xs text-amber-700">
                    Klient nie ma zapisanego adresu — KSeF wymaga adresu nabywcy.{' '}
                    <a href={`/customers/${customerId}`} className="font-medium underline">
                      Uzupełnij adres klienta
                    </a>
                    , a następnie wygeneruj fakturę ponownie.
                  </p>
                </div>
              )}
            </>
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
                  {!dueDateDescription.trim() && dueDate && (
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

        {/* ── Dodatkowe opcje ── */}
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

      {/* ── Bottom action bar ── */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-3 pt-3">
        {/* Desktop layout */}
        <div className="hidden items-center gap-3 sm:flex">
          <button
            type="button"
            onClick={() => navigate(`/invoices/${id}`)}
            className="rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Anuluj
          </button>
          <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900">
            {pln.format(totalGross)} brutto
          </span>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={editMutation.isPending || !canSubmit}
            className={cn(
              'flex items-center gap-2 rounded-2xl py-2.5 pl-5 pr-4 text-sm font-semibold transition-colors',
              !editMutation.isPending && canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            <span>{editMutation.isPending ? 'Zapisywanie…' : 'Zapisz zmiany'}</span>
            {!editMutation.isPending && <span className="text-base">→</span>}
          </button>
        </div>

        {/* Mobile layout */}
        <div className="flex items-center gap-2 sm:hidden">
          <span className="min-w-0 text-sm font-semibold tabular-nums text-slate-900">
            {pln.format(totalGross)}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/invoices/${id}`)}
            className="rounded-2xl border border-border px-3 py-2.5 text-sm font-semibold text-foreground"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={editMutation.isPending || !canSubmit}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-semibold transition-colors',
              !editMutation.isPending && canSubmit
                ? 'bg-primary text-primary-foreground'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            {editMutation.isPending ? 'Zapisywanie…' : 'Zapisz zmiany →'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

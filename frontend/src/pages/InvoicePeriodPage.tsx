import { useMemo, useState, useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useOrderListQuery } from '@/query/use-orders';
import {
  useAvailableZalQuery,
  useCreateManualInvoiceMutation,
  useGenerateFromOrdersMutation,
  useInvoicePeriodPreviewWzQuery,
  useInvoiceNextNumberQuery,
} from '@/query/use-invoices';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import { usePriceInputMode } from '@/hooks/usePriceInputMode';
import { InvoiceKsefOptions } from '@/components/features/invoicing/InvoiceKsefOptions';
import {
  AnnotationsSection,
  InvoiceDetailsAccordion,
  InvoiceTypeDropdown,
  SectionMark,
  TransactionConditionsSection,
  ZalSelectionSection,
  formatDateMed,
  plnToWords,
} from '@/pages/InvoiceManualPage';
import { cn } from '@/lib/utils';
import type {
  Order,
  InvoiceKsefOptions as KsefOptionsType,
  InvoiceItemWrite,
  InvoicePaymentMethod,
  KsefInvoiceType,
  Company,
  PeriodPreviewItem,
} from '@/types';

/* ─── Helpers ──────────────────────────────────────────────────────── */

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

const inputCls = 'field-ios';
const cardCls = 'rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl';

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

function todayIso(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function addDaysIso(isoYmd: string, days: number): string {
  const [y, m, d] = isoYmd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return [dt.getFullYear(), String(dt.getMonth() + 1).padStart(2, '0'), String(dt.getDate()).padStart(2, '0')].join('-');
}

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toDecimalInput(v: string): string {
  return v.replace(',', '.');
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(3)).toString();
}

function defaultOrderItemQty(item: OrderItem): string {
  const delivered = parseNum(item.quantity_delivered);
  return formatQty(delivered > 0 ? delivered : parseNum(item.quantity));
}

function linesCountLabel(n: number): string {
  if (n === 1) return '1 pozycja';
  if (n >= 2 && n <= 4) return `${n} pozycje`;
  return `${n} pozycji`;
}

/* ─── OrderItem type (matches server items array) ─────────────────── */

interface OrderItem {
  id: string;
  product_name: string;
  product_unit: string;
  quantity: string | number;
  quantity_delivered?: string | number | null;
  unit_price_net?: string | number;
  vat_rate?: string | number;
}

/* ─── WZ editable item type ────────────────────────────────────────── */

interface EditItem {
  id: number;
  product_id: string | null;
  product_name: string;
  product_unit: string;
  qty: string;
  unit_price_net: string;
  vat_rate: string;
}

let _editId = 1;
function nextEditId() { return _editId++; }

function periodItemToEdit(p: PeriodPreviewItem, isGross = false): EditItem {
  const unitPrice = isGross
    ? (parseNum(p.unit_price_net) * (1 + parseNum(p.vat_rate) / 100)).toFixed(2)
    : p.unit_price_net;
  return {
    id: nextEditId(),
    product_id: p.product_id,
    product_name: p.product_name,
    product_unit: p.product_unit,
    qty: p.qty,
    unit_price_net: unitPrice,
    vat_rate: p.vat_rate,
  };
}

function emptyEditItem(): EditItem {
  return {
    id: nextEditId(),
    product_id: null,
    product_name: '',
    product_unit: 'szt',
    qty: '1',
    unit_price_net: '',
    vat_rate: '23',
  };
}

/* ─── Step dots ─────────────────────────────────────────────────────── */

function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1.5 ml-auto">
      {([1, 2] as const).map((s) => (
        <span
          key={s}
          className={cn(
            'h-2 rounded-full transition-all',
            s === step ? 'w-5 bg-primary' : s < step ? 'w-2 bg-primary/50' : 'w-2 bg-border',
          )}
        />
      ))}
    </div>
  );
}

/* ─── CheckCircle ───────────────────────────────────────────────────── */

function CheckCircle({ checked, partial = false }: { checked: boolean; partial?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : partial
            ? 'border-primary bg-primary/20 text-primary'
            : 'border-border bg-transparent text-transparent',
      )}
    >
      {partial && !checked ? (
        <span className="h-2 w-2 rounded-full bg-primary" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth={3}>
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/* ─── Order row (with item-level checkboxes) ─────────────────────────── */

function OrderRow({
  order,
  selectedItemIds,
  onToggleItem,
  onToggleAll,
}: {
  order: Order;
  selectedItemIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: (order: Order) => void;
}) {
  const items = (order.items ?? []) as OrderItem[];
  const selectedCount = items.filter((i) => selectedItemIds.has(i.id)).length;
  const fullySelected = items.length > 0 && selectedCount === items.length;
  const partial = selectedCount > 0 && !fullySelected;
  const [expanded, setExpanded] = useState(false);

  function itemGross(i: OrderItem) {
    const qty = parseNum(
      i.quantity_delivered && parseNum(i.quantity_delivered) > 0
        ? i.quantity_delivered
        : i.quantity,
    );
    return qty * parseNum(i.unit_price_net) * (1 + parseNum(i.vat_rate) / 100);
  }

  const orderTotalGross = items.reduce((sum, i) => sum + itemGross(i), 0);
  const orderGross = items
    .filter((i) => selectedItemIds.has(i.id))
    .reduce((sum, i) => sum + itemGross(i), 0);

  return (
    <div className={cn(cardCls, 'overflow-hidden transition-all', selectedCount > 0 && 'ring-2 ring-primary/40')}>
      {/* Order header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => onToggleAll(order)} aria-pressed={fullySelected}>
          <CheckCircle checked={fullySelected} partial={partial} />
        </button>

        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpanded((v) => !v)}>
          <p className="font-semibold text-foreground text-sm">
            {order.order_number ?? '—'}
            {order.delivery_date && (
              <span className="ml-2 font-normal text-muted-foreground">· {order.delivery_date}</span>
            )}
          </p>
          {selectedCount > 0 ? (
            <p className="text-[12px] text-primary font-medium">
              {selectedCount === items.length ? 'Wszystkie pozycje' : `${selectedCount} z ${items.length} pozycji`}
              {' · '}{pln.format(orderGross)}
            </p>
          ) : (
            <p className="text-[12px] text-muted-foreground tabular-nums">
              {items.length} {items.length === 1 ? 'pozycja' : items.length < 5 ? 'pozycje' : 'pozycji'}
              {orderTotalGross > 0 && <> · {pln.format(orderTotalGross)}</>}
            </p>
          )}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} stroke="currentColor" strokeWidth={2}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Item rows */}
      {expanded && items.length > 0 && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {items.map((item) => {
            const sel = selectedItemIds.has(item.id);
            const qty = parseNum(
              item.quantity_delivered && parseNum(item.quantity_delivered) > 0
                ? item.quantity_delivered
                : item.quantity,
            );
            const gross = itemGross(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggleItem(item.id)}
                className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors', sel && 'bg-primary/5')}
              >
                <CheckCircle checked={sel} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{item.product_name}</p>
                  <p className="text-[12px] text-muted-foreground tabular-nums">
                    {qty % 1 === 0 ? qty : qty.toFixed(2)} {item.product_unit}
                    {item.unit_price_net && (
                      <> · {pln.format(gross)}</>
                    )}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── WZ editable item row ──────────────────────────────────────────── */

function EditItemRow({
  item,
  onUpdate,
  onRemove,
  isGross,
  priceLabel,
}: {
  item: EditItem;
  onUpdate: (patch: Partial<EditItem>) => void;
  onRemove: () => void;
  isGross: boolean;
  priceLabel: string;
}) {
  const [expanded, setExpanded] = useState(item.product_name === '');

  const gross = isGross
    ? parseNum(item.qty) * parseNum(item.unit_price_net)
    : parseNum(item.qty) * parseNum(item.unit_price_net) * (1 + parseNum(item.vat_rate) / 100);

  return (
    <div className={cn(cardCls, 'overflow-hidden')}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {item.product_name || <span className="italic text-muted-foreground">Brak nazwy</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="tabular-nums">{item.qty} {item.product_unit}</span>
            {item.unit_price_net && (
              <>
                <span>·</span>
                <span className="tabular-nums">{parseNum(item.unit_price_net).toFixed(2)} zł/szt</span>
                <span>·</span>
                <span className="font-medium text-foreground tabular-nums">{pln.format(gross)}</span>
              </>
            )}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 pb-4 pt-3 flex flex-col gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800">Produkt / opis</label>
            <input type="text" value={item.product_name} onChange={(e) => onUpdate({ product_name: e.target.value })} placeholder="Nazwa produktu…" className={inputCls} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-800">Ilość</label>
              <input type="text" inputMode="decimal" value={item.qty} onChange={(e) => onUpdate({ qty: toDecimalInput(e.target.value) })} onFocus={(e) => e.target.select()} className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-800">J.m.</label>
              <input type="text" value={item.product_unit} onChange={(e) => onUpdate({ product_unit: e.target.value })} placeholder="szt" className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-800">{priceLabel}</label>
              <input type="text" inputMode="decimal" value={item.unit_price_net} onChange={(e) => onUpdate({ unit_price_net: toDecimalInput(e.target.value) })} onFocus={(e) => e.target.select()} placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-800">VAT %</label>
              <input type="number" min="0" max="100" step="1" value={item.vat_rate} onChange={(e) => onUpdate({ vat_rate: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Brutto: <span className="font-semibold text-foreground">{pln.format(gross)}</span></span>
            <button type="button" onClick={onRemove} className="text-xs text-destructive hover:underline">Usuń</button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ─── Step 2 line (quantity editable, price from the source document) ─ */

function PeriodQtyRow({
  name, unit, qty, unitPrice, vatRate, priceIsGross, onQty,
}: {
  name: string;
  unit: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
  priceIsGross: boolean;
  onQty: (qty: string) => void;
}) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const unitLabel = unit === 'szt' ? 'szt.' : (unit || 'szt.');
  const qtyN = parseNum(qty);
  const price = parseNum(unitPrice);
  const vat = parseNum(vatRate);
  const lineGross = priceIsGross ? qtyN * price : qtyN * price * (1 + vat / 100);
  const lineNet = lineGross / (1 + vat / 100);

  function adjustQty(delta: number) {
    const next = Math.max(0.01, qtyN + delta);
    onQty(formatQty(next));
  }

  return (
    <div className="rounded-xl border border-[#AEAEB2] bg-[#F2F2F7] p-3 md:flex md:items-center md:gap-4 md:p-4">
      <div className="flex min-w-0 items-center gap-3 md:w-72 md:shrink-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-sm font-bold text-primary md:h-11 md:w-11 md:rounded-2xl md:text-lg" aria-hidden>
          {initial}
        </div>
        <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{name}</p>
      </div>
      <div className="mt-2.5 flex flex-1 flex-wrap items-center gap-2 border-t border-slate-200/50 pt-2.5 md:mt-0 md:border-0 md:pt-0">
        <div className="flex items-center rounded-lg border border-[#AEAEB2] bg-white p-0.5">
          <button
            type="button"
            onClick={() => adjustQty(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 md:h-8 md:w-8 md:rounded-xl"
            aria-label="Zmniejsz ilość"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M5 12h14" strokeLinecap="round" /></svg>
          </button>
          <input
            type="text"
            inputMode="decimal"
            value={qty}
            onChange={(e) => onQty(toDecimalInput(e.target.value))}
            onFocus={(e) => e.target.select()}
            aria-label={`Ilość ${name}`}
            className="w-10 bg-transparent text-center text-sm font-semibold tabular-nums text-slate-900 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => adjustQty(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white transition hover:bg-primary/90 md:h-8 md:w-8 md:rounded-xl"
            aria-label="Zwiększ ilość"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
          </button>
        </div>
        <span className="text-sm font-medium text-slate-700">{unitLabel}</span>
        <span className="inline-flex w-24 items-center justify-end rounded-lg border border-[#AEAEB2] bg-white px-2.5 py-1.5 text-sm font-semibold tabular-nums text-slate-900 md:w-28">
          {price.toFixed(2)}
          <span className="ml-1 font-medium text-slate-600">zł</span>
        </span>
        <span className="rounded-lg border border-[#AEAEB2] bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800">
          {vatRate === 'zw' ? 'ZW' : `VAT ${vatRate}%`}
        </span>
        <div className="ml-auto text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-900">{pln.format(lineGross)}</p>
          <p className="text-xs tabular-nums text-slate-600">netto: {pln.format(lineNet)}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────── */

export function InvoicePeriodPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InvoicePeriodPageContent />;
}

function InvoicePeriodPageContent() {
  const navigate = useNavigate();
  const { isGross, priceLabel } = usePriceInputMode();

  const [step, setStep] = useState<1 | 2>(1);

  /* Customer */
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const skipCustomerAutoOpen = useRef(true);
  const customerPaymentTerms = useRef<number>(14);
  const customerWrapRef = useRef<HTMLDivElement>(null);

  /* Source + date range */
  const [source, setSource] = useState<'orders' | 'wz'>('orders');
  const [dateFrom, setDateFrom] = useState<string>(todayIso);
  const [dateTo, setDateTo] = useState<string>(todayIso);

  /* Orders mode — search filter */
  const [orderSearch, setOrderSearch] = useState('');

  /* Orders mode — item-level selection */
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [itemQtyOverrides, setItemQtyOverrides] = useState<Record<string, string>>({});

  /* WZ mode — aggregated editable items */
  const [wzLoaded, setWzLoaded] = useState(false);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const lastWzLoadRef = useRef<{ dateFrom: string; dateTo: string } | null>(null);

  /* Summary panel */
  const [summaryOpen, setSummaryOpen] = useState(false);

  /* Step 2 — dates / KSeF */
  const [issueDate, setIssueDate] = useState(todayIso());
  const [saleDate, setSaleDate] = useState(dateFrom);  // pre-fill from date range
  const [saleDateTo, setSaleDateTo] = useState(dateTo);  // pre-fill from date range
  const [saleDateType, setSaleDateType] = useState<'single' | 'period' | 'issue' | 'various'>('period');  // period default for period invoicing
  const [paymentTermDays, setPaymentTermDays] = useState(14);
  const dueDate = addDaysIso(issueDate, paymentTermDays);
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('transfer');
  const [paymentReceivedAt, setPaymentReceivedAt] = useState<string | null>(null);
  const [otherPaymentDescription, setOtherPaymentDescription] = useState('');
  const [invoiceType, setInvoiceType] = useState<KsefInvoiceType>('VAT');
  const [invoiceNumberOverride, setInvoiceNumberOverride] = useState('');
  const [numberEditing, setNumberEditing] = useState(false);
  const [placeOfIssue, setPlaceOfIssue] = useState('');
  const [dueDateDescription, setDueDateDescription] = useState('');
  const [contracts, setContracts] = useState<{ date: string; number: string }[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<{ date: string; number: string }[]>([]);
  const [selectedZalIds, setSelectedZalIds] = useState<string[]>([]);
  const [ksefOptions, setKsefOptions] = useState<KsefOptionsType>({});
  const [showWzNumbers, setShowWzNumbers] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* Company for KSeF defaults */
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

  /* Warn on browser tab close when form has data */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!customerId) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [customerId]);

  /* ── Next number preview (step 2) ── */
  const { data: nextNumData } = useInvoiceNextNumberQuery(issueDate, step === 2);
  const { data: availableZal = [] } = useAvailableZalQuery(
    customerId || null,
    invoiceType === 'ROZ' && Boolean(customerId),
  );

  useEffect(() => {
    if (paymentMethod === 'cash') setPaymentReceivedAt((prev) => prev ?? issueDate);
  }, [paymentMethod, issueDate]);

  /* ── Queries ── */

  const { data: customersData } = useAllActiveCustomersQuery(customerSearch);
  const customers = useMemo(() => customersData?.results ?? [], [customersData]);

  /* Orders — loaded whenever customer + dates are set (source === 'orders') */
  const { data: ordersData, isLoading: ordersLoading } = useOrderListQuery(1, {
    customer: customerId,
    delivery_date_after: dateFrom,
    delivery_date_before: dateTo,
    ordering: '-delivery_date',
    page_size: 200,
  });
  const ordersAll: Order[] = useMemo(() => (source === 'orders' && customerId ? ordersData?.results ?? [] : []), [ordersData, source, customerId]);
  const orders: Order[] = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return ordersAll;
    return ordersAll.filter((o) => (o.order_number ?? '').toLowerCase().includes(q));
  }, [ordersAll, orderSearch]);

  /* WZ preview — only when explicitly loaded */
  const wzPreview = useInvoicePeriodPreviewWzQuery(
    customerId, dateFrom, dateTo,
    wzLoaded && source === 'wz',
  );

  useEffect(() => {
    if (!wzPreview.data) return;
    setEditItems(wzPreview.data.map((p) => periodItemToEdit(p, isGross)));
    lastWzLoadRef.current = { dateFrom, dateTo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wzPreview.data]);

  /* Stale warning for WZ */
  const isWzStale =
    wzLoaded &&
    lastWzLoadRef.current !== null &&
    (lastWzLoadRef.current.dateFrom !== dateFrom || lastWzLoadRef.current.dateTo !== dateTo);

  /* Close customer dropdown on outside click */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (customerWrapRef.current && !customerWrapRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);


  /* Reset selection when source or date range changes */
  useEffect(() => {
    setSelectedItemIds(new Set());
    setEditItems([]);
    setWzLoaded(false);
    setOrderSearch('');
    setSummaryOpen(false);
    lastWzLoadRef.current = null;
  }, [source, dateFrom, dateTo, customerId]);

  /* ── Order selection helpers ── */

  function getOrderItems(order: Order): OrderItem[] {
    return (order.items ?? []) as OrderItem[];
  }

  function getOrderItemIds(order: Order): string[] {
    return getOrderItems(order).map((i) => i.id);
  }

  function isOrderFullySelected(order: Order): boolean {
    const ids = getOrderItemIds(order);
    return ids.length > 0 && ids.every((id) => selectedItemIds.has(id));
  }

  function toggleOrderAllItems(order: Order) {
    const ids = getOrderItemIds(order);
    const allSel = isOrderFullySelected(order);
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function orderItemQty(item: OrderItem): string {
    return itemQtyOverrides[item.id] ?? defaultOrderItemQty(item);
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  const allItemIds = useMemo(() => orders.flatMap((o) => getOrderItemIds(o)), [orders]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleAllItems() {
    const allSel = allItemIds.length > 0 && allItemIds.every((id) => selectedItemIds.has(id));
    setSelectedItemIds(allSel ? new Set() : new Set(allItemIds));
  }

  /* Active order IDs (orders with ≥1 selected item) */
  const activeOrderIds = orders
    .filter((o) => getOrderItemIds(o).some((id) => selectedItemIds.has(id)))
    .map((o) => o.id);

  /* ── Totals ── */

  const ordersTotalGross = useMemo(() => {
    let total = 0;
    for (const order of orders) {
      for (const item of getOrderItems(order)) {
        if (!selectedItemIds.has(item.id)) continue;
        const qty = parseNum(orderItemQty(item));
        total += qty * parseNum(item.unit_price_net) * (1 + parseNum(item.vat_rate) / 100);
      }
    }
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIds, orders, itemQtyOverrides]);

  const wzTotalGross = useMemo(
    () => editItems.reduce((sum, i) => {
      const qty = parseNum(i.qty);
      const price = parseNum(i.unit_price_net);
      const vat = parseNum(i.vat_rate);
      return sum + (isGross ? qty * price : qty * price * (1 + vat / 100));
    }, 0),
    [isGross, editItems],
  );

  const totalGross = source === 'orders' ? ordersTotalGross : wzTotalGross;
  const totalNet = useMemo(() => {
    const rows = source === 'orders'
      ? orders.flatMap((order) => getOrderItems(order).filter((item) => selectedItemIds.has(item.id)).map((item) => ({
          qty: parseNum(orderItemQty(item)),
          price: parseNum(item.unit_price_net),
          vat: parseNum(item.vat_rate),
        })))
      : editItems.map((i) => ({ qty: parseNum(i.qty), price: parseNum(i.unit_price_net), vat: parseNum(i.vat_rate) }));
    return rows.reduce((sum, row) => {
      const gross = isGross ? row.qty * row.price : row.qty * row.price * (1 + row.vat / 100);
      return sum + gross / (1 + row.vat / 100);
    }, 0);
  }, [source, orders, selectedItemIds, editItems, isGross, itemQtyOverrides]);
  const vatGroups = useMemo(() => {
    const map = new Map<string, number>();
    const rows = source === 'orders'
      ? orders.flatMap((order) => getOrderItems(order).filter((item) => selectedItemIds.has(item.id)).map((item) => ({
          qty: parseNum(orderItemQty(item)),
          price: parseNum(item.unit_price_net),
          vat: parseNum(item.vat_rate),
          rate: String(item.vat_rate),
        })))
      : editItems.map((i) => ({
          qty: parseNum(i.qty),
          price: parseNum(i.unit_price_net),
          vat: parseNum(i.vat_rate),
          rate: i.vat_rate,
        }));
    for (const row of rows) {
      const gross = isGross ? row.qty * row.price : row.qty * row.price * (1 + row.vat / 100);
      const net = gross / (1 + row.vat / 100);
      const key = row.rate === 'zw' ? 'ZW' : `${row.rate}%`;
      map.set(key, (map.get(key) ?? 0) + (gross - net));
    }
    return [...map.entries()];
  }, [source, orders, selectedItemIds, editItems, isGross, itemQtyOverrides]);
  const amountInWords = plnToWords(totalGross);
  const amountInWordsLabel = amountInWords ? amountInWords.charAt(0).toUpperCase() + amountInWords.slice(1) : '';

  /* Auto-fill sale date */
  useEffect(() => {
    if (source === 'orders') {
      if (selectedItemIds.size === 0) return;
      const selOrders = orders.filter((o) => getOrderItemIds(o).some((id) => selectedItemIds.has(id)));
      const dates = selOrders.map((o) => o.delivery_date).filter(Boolean).sort();
      if (dates.length > 0) setSaleDate(dates[dates.length - 1] as string);
    } else {
      setSaleDate(dateTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIds, dateTo, source]);

  /* ── Helpers ── */

  function selectCustomer(c: { id: string; name: string; payment_terms?: number | null }) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
    const t = typeof c.payment_terms === 'number' && Number.isFinite(c.payment_terms) ? c.payment_terms : 14;
    customerPaymentTerms.current = t;
    setPaymentTermDays(TERM_OPTIONS.reduce((prev, curr) => Math.abs(curr - t) < Math.abs(prev - t) ? curr : prev));
  }

  function handleWzLoad() {
    setWzLoaded(false);
    setEditItems([]);
    lastWzLoadRef.current = null;
    setTimeout(() => setWzLoaded(true), 0);
  }

  function updateEditItem(id: number, patch: Partial<EditItem>) {
    setEditItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeEditItem(id: number) {
    setEditItems((prev) => prev.filter((item) => item.id !== id));
  }

  /* Summary lines — aggregated per product for the summary panel */
  interface SummaryLine { name: string; unit: string; qty: number; gross: number; }
  const summaryLines = useMemo((): SummaryLine[] => {
    if (source === 'wz') {
      return editItems.map((i) => {
        const qty = parseNum(i.qty);
        const price = parseNum(i.unit_price_net);
        const vat = parseNum(i.vat_rate);
        return {
          name: i.product_name || 'Brak nazwy',
          unit: i.product_unit,
          qty,
          gross: isGross ? qty * price : qty * price * (1 + vat / 100),
        };
      });
    }
    const map = new Map<string, SummaryLine>();
    for (const order of orders) {
      for (const item of (order.items ?? []) as OrderItem[]) {
        if (!selectedItemIds.has(item.id)) continue;
        const qty = parseNum(orderItemQty(item));
        const gross = qty * parseNum(item.unit_price_net) * (1 + parseNum(item.vat_rate) / 100);
        const existing = map.get(item.product_name);
        if (existing) {
          existing.qty += qty;
          existing.gross += gross;
        } else {
          map.set(item.product_name, { name: item.product_name, unit: item.product_unit, qty, gross });
        }
      }
    }
    return [...map.values()];
  }, [source, selectedItemIds, orders, editItems, itemQtyOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Can proceed to step 2 */
  const canGoStep2 = customerId !== '' && (source === 'orders'
    ? orders.some((order) => getOrderItems(order).some((item) => selectedItemIds.has(item.id) && parseNum(orderItemQty(item)) > 0))
    : editItems.length > 0 && editItems.every((i) => i.product_name.trim() !== '' && i.unit_price_net !== '' && parseNum(i.qty) > 0));

  /* ── Submit ── */

  const generateFromOrders = useGenerateFromOrdersMutation();
  const createManual = useCreateManualInvoiceMutation();

  const filledContracts = contracts.filter((c) => c.date || c.number);
  const filledOrders = purchaseOrders.filter((p) => p.date || p.number);
  const invoiceExtras = {
    ...ksefOptions,
    ksef_invoice_type: invoiceType,
    prices_include_vat: isGross,
    invoice_number: invoiceNumberOverride.trim() || undefined,
    place_of_issue: placeOfIssue.trim() || undefined,
    advance_invoice_ids: invoiceType === 'ROZ' ? selectedZalIds : undefined,
    payment_received_at: paymentMethod === 'cash' ? (paymentReceivedAt || issueDate) : undefined,
    other_payment_description: paymentMethod === 'other' ? otherPaymentDescription : undefined,
    due_date_description: dueDateDescription.trim() || undefined,
    contracts: filledContracts.length > 0 ? filledContracts : undefined,
    purchase_orders: filledOrders.length > 0 ? filledOrders : undefined,
    show_wz_numbers: showWzNumbers,
  };

  async function onSubmit() {
    setSubmitError(null);
    try {
      if (source === 'orders') {
        if (activeOrderIds.length === 0) { setSubmitError('Zaznacz co najmniej jedną pozycję.'); return; }
        const itemQuantities: Record<string, string> = {};
        for (const order of orders) {
          for (const item of getOrderItems(order)) {
            if (!selectedItemIds.has(item.id)) continue;
            const qty = orderItemQty(item);
            if (qty !== defaultOrderItemQty(item)) itemQuantities[item.id] = qty;
          }
        }
        const inv = await generateFromOrders.mutateAsync({
          order_ids: activeOrderIds,
          order_item_ids: [...selectedItemIds],
          ...(Object.keys(itemQuantities).length > 0 ? { item_quantities: itemQuantities } : {}),
          issue_date: issueDate,
          sale_date: saleDate,
          sale_date_to: saleDateType === 'period' ? saleDateTo : undefined,
          sale_date_type: saleDateType,
          due_date: dueDate,
          payment_method: paymentMethod,
          ...invoiceExtras,
        });
        navigate(`/invoices/${inv.id}`);
      } else {
        if (!customerId || editItems.length === 0) return;
        const items: InvoiceItemWrite[] = editItems.map((i) => ({
          product: i.product_id ?? undefined,
          product_name: i.product_name,
          product_unit: i.product_unit,
          quantity: i.qty,
          ...(isGross
            ? { unit_price_gross: i.unit_price_net }
            : { unit_price_net: i.unit_price_net }),
          vat_rate: i.vat_rate,
        }));
        const inv = await createManual.mutateAsync({
          customer_id: customerId,
          items,
          issue_date: issueDate,
          sale_date: saleDate,
          sale_date_to: saleDateType === 'period' ? saleDateTo : undefined,
          sale_date_type: saleDateType,
          due_date: dueDate,
          payment_method: paymentMethod,
          ...invoiceExtras,
        });
        navigate(`/invoices/${inv.id}`);
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się');
    }
  }

  const isSubmitting = generateFromOrders.isPending || createManual.isPending;

  /* ─────────────────────────── RENDER ──────────────────────────────── */

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => (step > 1 ? setStep(1) : navigate(-1))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 md:h-10 md:w-10"
              aria-label="Wróć"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5}>
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight text-slate-900 md:text-xl">Faktura zbiorcza</h1>
              <p className="truncate text-xs text-slate-500">
                {customerName || 'Wybierz klienta i dokumenty'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {step === 2 && <InvoiceTypeDropdown value={invoiceType} onChange={setInvoiceType} />}
            <StepDots step={step} />
          </div>
        </div>
      </header>

      <div className={cn(
          'flex flex-col gap-3 px-4 pt-4',
          step === 1
            ? 'pb-[calc(83px+16px+env(safe-area-inset-bottom))] md:pb-6'
            : 'pb-[calc(83px+80px+env(safe-area-inset-bottom))] md:pb-[calc(80px+env(safe-area-inset-bottom))]',
        )}>

        {/* ── Step 1: Customer + Source + Dates + List ── */}
        {step === 1 && (
          <>
            {/* Customer */}
            <div className={cn(cardCls, 'p-4 md:p-6')}>
              <div className="mb-3 flex items-center gap-2.5">
                <SectionMark name="user" />
                <h2 className="text-sm font-semibold text-slate-900">Klient</h2>
              </div>
              <div ref={customerWrapRef} className="relative">
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => { setCustomerSearch(e.target.value); setCustomerId(''); setCustomerName(''); setShowCustomerDropdown(true); }}
                  onClick={() => setShowCustomerDropdown(true)}
                  onFocus={() => {
                    if (skipCustomerAutoOpen.current) {
                      skipCustomerAutoOpen.current = false;
                      return;
                    }
                    setShowCustomerDropdown(true);
                  }}
                  placeholder="Wyszukaj klienta…"
                  className={inputCls}
                  autoFocus
                />
                {showCustomerDropdown && customers.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
                    {customers.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={() => selectCustomer(c)}>
                          <span className="font-medium">{c.name}</span>
                          {c.nip && <span className="ml-2 text-xs text-muted-foreground">NIP: {c.nip}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {customerId && (
                <p className="mt-1.5 text-xs text-muted-foreground">Wybrany: <span className="font-medium text-foreground">{customerName}</span></p>
              )}
            </div>

            {/* Source toggle */}
            <div className={cn(cardCls, 'p-4 md:p-6')}>
              <div className="mb-3 flex items-center gap-2.5">
                <SectionMark name="list" />
                <h2 className="text-sm font-semibold text-slate-900">Źródło danych</h2>
              </div>
              <div className="flex gap-2 rounded-xl bg-muted p-1">
                {(['orders', 'wz'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(s)}
                    className={cn(
                      'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
                      source === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s === 'orders' ? 'Z zamówień' : 'Z WZ dokumentów'}
                  </button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div className={cn(cardCls, 'p-4 md:p-6')}>
              <div className="mb-3 flex items-center gap-2.5">
                <SectionMark name="calendar" />
                <h2 className="text-sm font-semibold text-slate-900">Zakres dat</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">Od</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="date-pill w-full" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">Do</label>
                  <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setSaleDate(e.target.value); }} className="date-pill w-full" />
                </div>
              </div>

              {/* WZ load button */}
              {source === 'wz' && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleWzLoad}
                    disabled={!customerId || wzPreview.isFetching}
                    className={cn(
                      'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                      customerId && !wzPreview.isFetching
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'cursor-not-allowed bg-muted text-muted-foreground',
                    )}
                  >
                    {wzPreview.isFetching ? (
                      <span className="flex items-center gap-2">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Ładowanie…
                      </span>
                    ) : 'Załaduj wyniki'}
                  </button>
                  {isWzStale && (
                    <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      Zmieniono zakres — załaduj ponownie
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Orders mode: list with checkboxes ── */}
            {source === 'orders' && customerId && (
              <>
                {/* Search by order number */}
                <div className="relative">
                  <svg viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
                    <circle cx="11" cy="11" r="8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Szukaj po numerze zamówienia…"
                    className="field-ios w-full pl-9"
                  />
                </div>

                <div className="flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Zamówienia — {customerName}
                    {ordersAll.length > 0 && (
                      <span className="ml-1 text-foreground">
                        ({orderSearch ? `${orders.length} z ${ordersAll.length}` : ordersAll.length})
                      </span>
                    )}
                  </h2>
                  {orders.length > 0 && (
                    <button type="button" onClick={toggleAllItems} className="text-xs font-semibold text-primary">
                      {allItemIds.length > 0 && allItemIds.every((id) => selectedItemIds.has(id)) ? 'Odznacz' : 'Zaznacz wszystkie'}
                    </button>
                  )}
                </div>

                {ordersLoading && (
                  <div className="flex items-center justify-center py-10">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                )}

                {!ordersLoading && ordersAll.length === 0 && (
                  <div className={cn(cardCls, 'px-4 py-8 text-center')}>
                    <p className="text-sm text-slate-600">Brak zamówień w wybranym zakresie dat.</p>
                  </div>
                )}

                {!ordersLoading && ordersAll.length > 0 && orders.length === 0 && (
                  <div className={cn(cardCls, 'px-4 py-8 text-center')}>
                    <p className="text-sm text-slate-600">Brak wyników dla „{orderSearch}".</p>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      selectedItemIds={selectedItemIds}
                      onToggleItem={toggleItem}
                      onToggleAll={toggleOrderAllItems}
                    />
                  ))}
                </div>
              </>
            )}

            {/* ── WZ mode: aggregated editable items ── */}
            {source === 'wz' && wzLoaded && !wzPreview.isFetching && (
              <>
                {editItems.length === 0 ? (
                  <div className={cn(cardCls, 'px-4 py-8 text-center')}>
                    <p className="text-sm text-slate-600">Brak WZ w wybranym zakresie dat.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-1">
                      <h2 className="text-sm font-semibold text-slate-900">
                        Pozycje ({editItems.length})
                      </h2>
                      <span className="text-xs text-muted-foreground">Kliknij, by edytować</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {editItems.map((item) => (
                        <EditItemRow
                          key={item.id}
                          item={item}
                          onUpdate={(patch) => updateEditItem(item.id, patch)}
                          onRemove={() => removeEditItem(item.id)}
                          isGross={isGross}
                          priceLabel={priceLabel}
                        />
                      ))}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setEditItems((prev) => [...prev, emptyEditItem()])}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  Dodaj pozycję
                </button>
              </>
            )}

            {/* Summary sits in the page flow, under the list. Opening it pushes Dalej down. */}
            {canGoStep2 && (
              <div className="mt-1 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 px-4">
                <button
                  type="button"
                  onClick={() => setSummaryOpen((v) => !v)}
                  className="flex w-full items-center justify-between py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-foreground tabular-nums">{pln.format(totalGross)}</span>
                    <span className="text-[12px] text-muted-foreground">
                      · {summaryLines.length} {summaryLines.length === 1 ? 'produkt' : summaryLines.length < 5 ? 'produkty' : 'produktów'}
                    </span>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" className={cn('h-4 w-4 text-muted-foreground transition-transform duration-300', summaryOpen && 'rotate-180')} stroke="currentColor" strokeWidth={2}>
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: summaryOpen ? '1fr' : '0fr' }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-col gap-1.5 border-t border-primary/15 pb-3 pt-2">
                      {summaryLines.map((line, i) => (
                        <div key={i} className="grid grid-cols-[1fr_4.5rem_5.5rem] items-baseline gap-x-2">
                          <span className="min-w-0 truncate text-sm text-foreground">{line.name}</span>
                          <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                            {line.qty % 1 === 0 ? line.qty : line.qty.toFixed(3).replace(/\.?0+$/, '')} {line.unit}
                          </span>
                          <span className="text-right text-[12px] tabular-nums font-medium text-foreground">
                            {pln.format(line.gross)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canGoStep2}
              className={cn('w-full rounded-2xl py-2.5 text-sm font-semibold transition-colors', canGoStep2 ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'cursor-not-allowed bg-muted text-muted-foreground')}
            >
              Dalej →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <section className={cardCls}>
              <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 md:px-6">
                <div>
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <SectionMark name="hash" />
                    <h2 className="text-sm font-semibold text-slate-900">Numer faktury</h2>
                  </div>
                  {numberEditing ? (
                    <input
                      type="text"
                      value={invoiceNumberOverride}
                      onChange={(e) => setInvoiceNumberOverride(e.target.value)}
                      onBlur={() => setNumberEditing(false)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setNumberEditing(false); }}
                      placeholder={nextNumData?.next_number ?? '…'}
                      autoFocus
                      className="field-ios w-full"
                    />
                  ) : (
                    <div className="flex h-[38px] items-center gap-1">
                      <span className="truncate rounded-lg bg-primary/10 px-2.5 py-1 text-base font-semibold tracking-tight text-primary">
                        {invoiceNumberOverride || nextNumData?.next_number || '—'}
                      </span>
                      <button type="button" onClick={() => setNumberEditing(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary/10" aria-label="Zmień numer faktury">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-slate-500">{invoiceNumberOverride ? 'Własny numer' : 'Nadany automatycznie'}</p>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <SectionMark name="calendar" />
                    <label htmlFor="period-issue-date" className="text-sm font-semibold text-slate-900">Data wystawienia</label>
                  </div>
                  <input id="period-issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="date-pill w-full" />
                </div>
              </div>
            </section>

            <section className={cn(cardCls, 'p-4 md:p-6')}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <SectionMark name="list" />
                  <h2 className="text-sm font-semibold text-slate-900">Pozycje faktury</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {linesCountLabel(source === 'orders'
                    ? orders.reduce((n, order) => n + getOrderItems(order).filter((item) => selectedItemIds.has(item.id)).length, 0)
                    : editItems.length)}
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                {source === 'orders'
                  ? orders.flatMap((order) => getOrderItems(order).filter((item) => selectedItemIds.has(item.id)).map((item) => (
                    <PeriodQtyRow
                      key={item.id}
                      name={item.product_name}
                      unit={item.product_unit}
                      qty={orderItemQty(item)}
                      unitPrice={String(item.unit_price_net ?? '')}
                      vatRate={String(item.vat_rate ?? '0')}
                      priceIsGross={false}
                      onQty={(qty) => setItemQtyOverrides((prev) => ({ ...prev, [item.id]: qty }))}
                    />
                  )))
                  : editItems.map((item) => (
                    <PeriodQtyRow
                      key={item.id}
                      name={item.product_name || 'Brak nazwy'}
                      unit={item.product_unit}
                      qty={item.qty}
                      unitPrice={item.unit_price_net}
                      vatRate={item.vat_rate}
                      priceIsGross={isGross}
                      onQty={(qty) => updateEditItem(item.id, { qty })}
                    />
                  ))}
              </div>
            </section>

            <section className={cn(cardCls, 'overflow-hidden')}>
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
                ) : vatGroups.map(([rate, vatAmt]) => (
                  <div key={rate} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
                    <span className="text-sm text-slate-500">Stawka VAT {rate}</span>
                    <span className="text-sm font-medium tabular-nums text-slate-800">{pln.format(vatAmt)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 bg-primary/5 px-4 py-4 md:px-6">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-800">Do zapłaty</span>
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-primary">{pln.format(totalGross)}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">Słownie: {amountInWordsLabel}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {source === 'orders'
                    ? `${activeOrderIds.length} zamówień · ${selectedItemIds.size} pozycji`
                    : `${editItems.length} pozycji z WZ`}
                  {customerName ? ` · ${customerName}` : ''}
                </p>
              </div>
            </section>

            <section className={cardCls}>
              <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5 md:px-6">
                <SectionMark name="card" />
                <h2 className="text-sm font-semibold text-slate-900">Płatność i dostawa</h2>
              </div>
              <div className="flex flex-col gap-4 border-t border-slate-100 px-4 py-4 md:px-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-800">Metoda płatności</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod)} className="select-pill w-full">
                      {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-800">Termin płatności</label>
                    <select value={paymentTermDays} onChange={(e) => setPaymentTermDays(Number(e.target.value))} className="select-pill w-full">
                      {TERM_OPTIONS.map((d) => <option key={d} value={d}>{d} dni</option>)}
                    </select>
                    {!dueDateDescription.trim() && <p className="mt-1.5 text-sm text-slate-700">do {formatDateMed(dueDate)}</p>}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800">Data sprzedaży</label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select value={saleDateType} onChange={(e) => setSaleDateType(e.target.value as typeof saleDateType)} className="select-pill w-full sm:w-56">
                      <option value="single">Konkretna data</option>
                      <option value="period">Okres od–do</option>
                      <option value="issue">= data wystawienia</option>
                      <option value="various">Różne daty</option>
                    </select>
                    {saleDateType === 'single' && (
                      <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="date-pill w-full sm:w-52" />
                    )}
                    {saleDateType === 'period' && (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="date-pill w-full sm:w-52" />
                        <span className="text-slate-500">—</span>
                        <input type="date" value={saleDateTo} onChange={(e) => setSaleDateTo(e.target.value)} className="date-pill w-full sm:w-52" />
                      </div>
                    )}
                    {saleDateType === 'issue' && <p className="text-sm text-slate-800">{formatDateMed(issueDate)}</p>}
                  </div>
                </div>
                {paymentMethod === 'other' && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-800">Opis formy płatności</label>
                    <input type="text" value={otherPaymentDescription} onChange={(e) => setOtherPaymentDescription(e.target.value)} maxLength={256} placeholder="Np. płatność blikiem, kompensata..." className="field-ios w-full" />
                  </div>
                )}
                {paymentMethod === 'cash' && (
                  <div className="sm:max-w-xs">
                    <label className="mb-1.5 block text-sm font-medium text-slate-800">Data otrzymania zapłaty</label>
                    <input type="date" value={paymentReceivedAt ?? issueDate} onChange={(e) => setPaymentReceivedAt(e.target.value || null)} className="date-pill w-full" />
                  </div>
                )}
                {invoiceType === 'ROZ' && (
                  <ZalSelectionSection availableZal={availableZal} selectedIds={selectedZalIds} onChange={setSelectedZalIds} customerId={customerId} />
                )}
              </div>
            </section>

            <section className={cn(cardCls, 'overflow-hidden')}>
              <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
                <SectionMark name="sliders" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Dodatkowe opcje</h2>
                  <p className="text-xs text-slate-500">Nie są wymagane do wystawienia faktury</p>
                </div>
              </div>
              <div className="divide-y divide-slate-200 border-t border-slate-200">
                <label className="flex items-center justify-between gap-3 px-4 py-3.5 md:px-6">
                  <span className="text-sm font-medium text-slate-800">Pokaż numery WZ z dostaw</span>
                  <input type="checkbox" checked={showWzNumbers} onChange={(e) => setShowWzNumbers(e.target.checked)} className="h-4 w-4 accent-primary" />
                </label>
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

            {submitError && (
              <p className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {submitError}
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Fixed bottom bar (step 2 only — step 1 summary lives under the list) ── */}
      {step === 2 && (
      <div className="fixed bottom-[83px] left-0 right-0 z-40 border-t border-slate-200 bg-white px-4 pb-3 pt-3 md:bottom-0 md:left-64">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <button type="button" onClick={() => setStep(1)} className="rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted">
            ← Wstecz
          </button>
          <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900">{pln.format(totalGross)} brutto</span>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={isSubmitting || !canGoStep2}
            className={cn(
              'rounded-2xl py-2.5 pl-5 pr-4 text-sm font-semibold',
              !isSubmitting && canGoStep2 ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            {isSubmitting ? 'Tworzenie…' : 'Wystaw fakturę'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

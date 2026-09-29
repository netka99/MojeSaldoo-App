import { useMemo, useState, useEffect, useRef } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { useOrderListQuery } from '@/query/use-orders';
import { useAllActiveCustomersQuery } from '@/query/use-customers';
import { useGenerateFromOrdersMutation, useInvoiceNextNumberQuery } from '@/query/use-invoices';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';
import { InvoiceKsefOptions } from '@/components/features/invoicing/InvoiceKsefOptions';
import { cn } from '@/lib/utils';
import type { Order, InvoiceKsefOptions as KsefOptionsType, InvoicePaymentMethod, Company } from '@/types';

/* ─── Types ──────────────────────────────────────────────────────────── */

interface OrderItem {
  id: string;
  product_name: string;
  product_unit: string;
  quantity: string | number;
  quantity_delivered?: string | number | null;
  vat_rate?: string | number;
  unit_price_net?: string | number;
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

const PAYMENT_OPTIONS: { value: InvoicePaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Przelew' },
  { value: 'cash', label: 'Gotówka' },
  { value: 'card', label: 'Karta' },
];

const inputCls =
  'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50';

const selectCls =
  'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50';

function todayIso(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseNum(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/* ─── Step indicator ─────────────────────────────────────────────────── */

const STEP_LABELS = ['Pozycje', 'Daty'];

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && (
              <div className={cn('h-px w-4 transition-colors', done ? 'bg-primary' : 'bg-border')} />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : done
                    ? 'bg-primary/30 text-primary'
                    : 'bg-border text-muted-foreground',
                )}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth={3}>
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  idx
                )}
              </span>
              <span
                className={cn(
                  'hidden text-[9px] font-semibold uppercase tracking-wide sm:block',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
      <span className="ml-2 text-[11px] font-medium text-muted-foreground">
        Krok {step} z 3
      </span>
    </div>
  );
}

/* ─── CheckCircle ────────────────────────────────────────────────────── */

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

/* ─── DatesSection ───────────────────────────────────────────────────── */

function DatesSection({
  issueDate,
  saleDate,
  saleDateTo,
  saleDateType,
  dueDate,
  paymentMethod,
  showWzNumbers,
  onIssueDate,
  onSaleDate,
  onSaleDateTo,
  onSaleDateType,
  onDueDate,
  onPaymentMethod,
  onShowWzNumbers,
}: {
  issueDate: string;
  saleDate: string;
  saleDateTo: string;
  saleDateType: 'single' | 'period' | 'issue' | 'various';
  dueDate: string;
  paymentMethod: InvoicePaymentMethod;
  showWzNumbers: boolean;
  onIssueDate: (v: string) => void;
  onSaleDate: (v: string) => void;
  onSaleDateTo: (v: string) => void;
  onSaleDateType: (v: 'single' | 'period' | 'issue' | 'various') => void;
  onDueDate: (v: string) => void;
  onPaymentMethod: (v: InvoicePaymentMethod) => void;
  onShowWzNumbers: (v: boolean) => void;
}) {
  return (
    <div className="rounded-2xl bg-surface-card p-4 shadow-soft">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Dane faktury
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Data wystawienia
          </label>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => onIssueDate(e.target.value)}
            className={inputCls}
            required
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Wybierz datę albo okres, którego dotyczy faktura
          </label>
          <select
            value={saleDateType}
            onChange={(e) => onSaleDateType(e.target.value as typeof saleDateType)}
            className={selectCls}
          >
            <option value="single">Wspólna data dokonania lub zakończenia dostawy towarów lub wykonania usługi</option>
            <option value="period">Okres, którego dotyczy faktura (art. 19a ust. 3/4/5)</option>
            <option value="issue">Data wystawienia = data wykonania czynności</option>
            <option value="various">Różne daty dla poszczególnych towarów lub usług</option>
          </select>
        </div>
        {saleDateType === 'single' && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Data dostawy / wykonania usługi
            </label>
            <input type="date" value={saleDate} onChange={(e) => onSaleDate(e.target.value)} className={inputCls} required />
          </div>
        )}
        {saleDateType === 'period' && (
          <>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Data początkowa okresu
              </label>
              <input type="date" value={saleDate} onChange={(e) => onSaleDate(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Data końcowa okresu
              </label>
              <input type="date" value={saleDateTo} onChange={(e) => onSaleDateTo(e.target.value)} className={inputCls} required />
            </div>
          </>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Termin płatności
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => onDueDate(e.target.value)}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Forma płatności
          </label>
          <select
            value={paymentMethod}
            onChange={(e) => onPaymentMethod(e.target.value as InvoicePaymentMethod)}
            className={selectCls}
          >
            {PAYMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={showWzNumbers}
              onChange={(e) => onShowWzNumbers(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span>Pokaż numery dokumentów WZ na fakturze</span>
          </label>
        </div>
      </div>
    </div>
  );
}

/* ─── Main content ───────────────────────────────────────────────────── */

function InvoiceFromOrdersPageContent() {
  const navigate = useNavigate();

  /* Step state */
  const [step, setStep] = useState<1 | 2>(1);

  /* Step 1 — customer */
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerWrapRef = useRef<HTMLDivElement>(null);
  const customerPaymentTerms = useRef<number>(14);

  /* Step 2 — item-level selection */
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

  /* Step 3 — dates / KSeF */
  const [issueDate, setIssueDate] = useState(todayIso());
  const [saleDate, setSaleDate] = useState(todayIso());
  const [saleDateTo, setSaleDateTo] = useState(todayIso());
  const [saleDateType, setSaleDateType] = useState<'single' | 'period' | 'issue' | 'various'>('single');
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(), 14));
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('transfer');
  const [ksefOptions, setKsefOptions] = useState<KsefOptionsType>({});
  const [ksefOpen, setKsefOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [showWzNumbers, setShowWzNumbers] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* Warn on browser tab close when form has data */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!customerId) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [customerId]);

  /* ── Next number preview (step 3) ── */
  const { data: nextNumData } = useInvoiceNextNumberQuery(issueDate, step === 2);

  /* ── Data ── */

  const { data: customersData } = useAllActiveCustomersQuery(customerSearch);
  const customers = useMemo(() => customersData?.results ?? [], [customersData]);

  const { data: ordersData, isLoading: ordersLoading } = useOrderListQuery(1, {
    customer: customerId,
    without_invoice: true,
    ordering: '-delivery_date',
    page_size: 200,
  });
  const orders: Order[] = useMemo(() => ordersData?.results ?? [], [ordersData]);

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

  /* ── Per-order helpers ── */

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

  function isOrderPartiallySelected(order: Order): boolean {
    const ids = getOrderItemIds(order);
    return ids.some((id) => selectedItemIds.has(id)) && !isOrderFullySelected(order);
  }

  function toggleOrderAllItems(order: Order) {
    const ids = getOrderItemIds(order);
    const allSelected = isOrderFullySelected(order);
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  const allItemIds = useMemo(
    () => orders.flatMap((o) => getOrderItemIds(o)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );

  function toggleAllItems() {
    const allSelected = allItemIds.length > 0 && allItemIds.every((id) => selectedItemIds.has(id));
    setSelectedItemIds(allSelected ? new Set() : new Set(allItemIds));
  }

  /* ── Financial summary ── */

  const totalGross = useMemo(() => {
    let total = 0;
    for (const order of orders) {
      for (const item of getOrderItems(order)) {
        if (!selectedItemIds.has(item.id)) continue;
        const qty = parseNum(
          item.quantity_delivered && parseNum(item.quantity_delivered) > 0
            ? item.quantity_delivered
            : item.quantity,
        );
        const price = parseNum(item.unit_price_net);
        const vat = parseNum(item.vat_rate);
        total += qty * price * (1 + vat / 100);
      }
    }
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIds, orders]);

  /* Product summary (for step 3 summary card) */
  const productSummary = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; qty: number }>();
    for (const order of orders) {
      for (const item of getOrderItems(order)) {
        if (!selectedItemIds.has(item.id)) continue;
        const key = item.product_name;
        const qty = parseNum(
          item.quantity_delivered && parseNum(item.quantity_delivered) > 0
            ? item.quantity_delivered
            : item.quantity,
        );
        const ex = map.get(key);
        if (ex) {
          ex.qty += qty;
        } else {
          map.set(key, { name: item.product_name, unit: item.product_unit, qty });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIds, orders]);

  /* Auto-fill sale date when selection changes */
  useEffect(() => {
    if (selectedItemIds.size === 0) return;
    const selectedOrders = orders.filter((o) =>
      getOrderItemIds(o).some((id) => selectedItemIds.has(id)),
    );
    const dates = selectedOrders.map((o) => o.delivery_date).filter(Boolean).sort();
    if (dates.length > 0) setSaleDate(dates[dates.length - 1] as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemIds]);

  /* Active order IDs (orders with ≥1 selected item) */
  const activeOrderIds = orders
    .filter((o) => getOrderItemIds(o).some((id) => selectedItemIds.has(id)))
    .map((o) => o.id);

  /* ── Customer selection ── */

  function selectCustomer(c: { id: string; name: string; payment_terms?: number | null }) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
    const t =
      typeof c.payment_terms === 'number' && Number.isFinite(c.payment_terms)
        ? c.payment_terms
        : 14;
    customerPaymentTerms.current = t;
    setDueDate(addDaysIso(issueDate, t));
    setSelectedItemIds(new Set());
  }

  /* ── Submit ── */

  const generate = useGenerateFromOrdersMutation();

  async function onSubmit() {
    setSubmitError(null);
    if (activeOrderIds.length === 0) {
      setSubmitError('Zaznacz pozycje.');
      return;
    }
    try {
      const inv = await generate.mutateAsync({
        order_ids: activeOrderIds,
        order_item_ids: [...selectedItemIds],
        issue_date: issueDate,
        sale_date: saleDate,
        sale_date_to: saleDateType === 'period' ? saleDateTo : undefined,
        sale_date_type: saleDateType,
        due_date: dueDate,
        payment_method: paymentMethod,
        show_wz_numbers: showWzNumbers,
        ...ksefOptions,
      });
      navigate(`/invoices/${inv.id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Nie udało się');
    }
  }

  /* ── Back handler ── */

  function handleBack() {
    if (step === 1) {
      navigate(-1);
    } else {
      setStep((prev) => (prev - 1) as 1 | 2);
    }
  }

  /* ── Render ── */

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={handleBack}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          aria-label="Wróć"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            Nowa faktura · Z zamówień
          </h1>
        </div>
        <StepIndicator step={step} />
      </div>

      {/* ── Step 1: Customer + Items ── */}
      {step === 1 && (
        <div className="flex flex-col gap-4 px-4 pt-4 pb-[calc(76px+96px+env(safe-area-inset-bottom))] md:pb-[calc(96px+env(safe-area-inset-bottom))]">
          {/* Customer */}
          <div className="rounded-2xl bg-surface-card p-4 shadow-soft">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Klient
            </h2>
            <div ref={customerWrapRef} className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerId('');
                  setCustomerName('');
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="Wyszukaj klienta…"
                className={inputCls}
                autoComplete="off"
              />
              {showCustomerDropdown && customers.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
                  {customers.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={() => selectCustomer(c)}
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.nip && (
                          <span className="ml-2 text-xs text-muted-foreground">NIP: {c.nip}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {customerId && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Wybrany: <span className="font-medium text-foreground">{customerName}</span>
              </p>
            )}
          </div>

          {/* Orders section header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {customerId
                ? `Zamówienia klienta — ${customerName} (${orders.length})`
                : 'Wybierz najpierw klienta'}
            </h2>
            {orders.length > 0 && !ordersLoading && (
              <button
                type="button"
                onClick={toggleAllItems}
                className="text-xs font-semibold text-primary"
              >
                {allItemIds.length > 0 && allItemIds.every((id) => selectedItemIds.has(id))
                  ? 'Odznacz'
                  : 'Zaznacz wszystkie'}
              </button>
            )}
          </div>

          {/* Loading */}
          {ordersLoading && (
            <div className="flex items-center justify-center py-12">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {/* Empty */}
          {!ordersLoading && orders.length === 0 && (
            <p className="rounded-2xl bg-surface-card px-4 py-8 text-center text-sm text-muted-foreground shadow-soft">
              Brak zamówień bez wystawionej faktury dla tego klienta
            </p>
          )}

          {/* Order rows */}
          {!ordersLoading && (
            <div className="flex flex-col gap-2">
              {orders.map((order) => {
                const items = getOrderItems(order);
                const fullySelected = isOrderFullySelected(order);
                const partiallySelected = isOrderPartiallySelected(order);
                const expanded = expandedOrderIds.has(order.id);

                return (
                  <div
                    key={order.id}
                    className={cn(
                      'rounded-2xl bg-surface-card shadow-soft transition-all overflow-hidden',
                      (fullySelected || partiallySelected) && 'ring-2 ring-primary/40',
                    )}
                  >
                    {/* Order header row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleOrderAllItems(order)}
                        aria-pressed={fullySelected}
                        className="shrink-0"
                      >
                        <CheckCircle checked={fullySelected} partial={partiallySelected} />
                      </button>

                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() =>
                          setExpandedOrderIds((prev) => {
                            const next = new Set(prev);
                            next.has(order.id) ? next.delete(order.id) : next.add(order.id);
                            return next;
                          })
                        }
                      >
                        <p className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="font-semibold text-foreground">
                            {order.order_number ?? '—'}
                          </span>
                          {order.delivery_date && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{order.delivery_date}</span>
                            </>
                          )}
                        </p>
                        {(fullySelected || partiallySelected) && (
                          <p className="mt-0.5 text-[11px] font-medium text-primary">
                            {fullySelected
                              ? `Wszystkie (${items.length})`
                              : `${items.filter((i) => selectedItemIds.has(i.id)).length} z ${items.length}`}
                          </p>
                        )}
                      </button>

                      {items.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedOrderIds((prev) => {
                              const next = new Set(prev);
                              next.has(order.id) ? next.delete(order.id) : next.add(order.id);
                              return next;
                            })
                          }
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            className={cn(
                              'h-4 w-4 transition-transform',
                              expanded && 'rotate-180',
                            )}
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Item rows */}
                    {expanded && items.length > 0 && (
                      <div className="border-t border-border/40 divide-y divide-border/30">
                        {items.map((item) => {
                          const itemSel = selectedItemIds.has(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => toggleItem(item.id)}
                              className={cn(
                                'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                                itemSel ? 'bg-primary/5' : 'hover:bg-muted/40',
                              )}
                            >
                              <CheckCircle checked={itemSel} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {item.product_name}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {item.quantity_delivered &&
                                  parseNum(item.quantity_delivered) > 0
                                    ? item.quantity_delivered
                                    : item.quantity}{' '}
                                  {item.product_unit}
                                  {item.unit_price_net != null && (
                                    <>
                                      {' · '}
                                      {pln.format(
                                        parseNum(item.unit_price_net) *
                                          parseNum(
                                            item.quantity_delivered &&
                                            parseNum(item.quantity_delivered) > 0
                                              ? item.quantity_delivered
                                              : item.quantity,
                                          ) *
                                          (1 + parseNum(item.vat_rate) / 100),
                                      )}
                                    </>
                                  )}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom bar */}
          <div className="fixed left-0 right-0 z-30 bottom-[83px] md:bottom-0 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
            {selectedItemIds.size > 0 && (
              <p className="mb-1.5 text-center text-xs font-medium text-primary">
                {selectedItemIds.size}{' '}
                {selectedItemIds.size === 1
                  ? 'pozycja'
                  : selectedItemIds.size < 5
                  ? 'pozycje'
                  : 'pozycji'}{' '}
                — {pln.format(totalGross)}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-none rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                ← Wstecz
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selectedItemIds.size === 0}
                className={cn(
                  'flex-1 rounded-xl py-3 text-base font-semibold transition-colors',
                  selectedItemIds.size > 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'cursor-not-allowed bg-muted text-muted-foreground',
                )}
              >
                Dalej →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Dates / KSeF / Submit ── */}
      {step === 2 && (
        <div className="flex flex-col gap-5 px-4 pt-4 pb-[calc(76px+96px+env(safe-area-inset-bottom))] md:pb-[calc(96px+env(safe-area-inset-bottom))]">
          {/* Collapsible summary */}
          <div className="rounded-2xl bg-surface-card shadow-soft overflow-hidden">
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Wybrane pozycje ({selectedItemIds.size}) — {pln.format(totalGross)}
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  summaryOpen && 'rotate-180',
                )}
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {summaryOpen && productSummary.length > 0 && (
              <div className="border-t border-border/40 px-4 pb-4 pt-3">
                <div className="flex flex-col gap-1.5">
                  {productSummary.map((p) => (
                    <div key={p.name} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-foreground">{p.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                        {Number.isInteger(p.qty) ? p.qty : p.qty.toFixed(2)} {p.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Next number preview */}
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Numer faktury zostanie nadany: </span>
            <span className="font-mono font-semibold">{nextNumData?.next_number ?? '—'}</span>
          </div>

          {/* Dates */}
          <DatesSection
            issueDate={issueDate}
            saleDate={saleDate}
            saleDateTo={saleDateTo}
            saleDateType={saleDateType}
            dueDate={dueDate}
            paymentMethod={paymentMethod}
            showWzNumbers={showWzNumbers}
            onIssueDate={setIssueDate}
            onSaleDate={setSaleDate}
            onSaleDateTo={setSaleDateTo}
            onSaleDateType={setSaleDateType}
            onDueDate={setDueDate}
            onPaymentMethod={setPaymentMethod}
            onShowWzNumbers={setShowWzNumbers}
          />

          {/* KSeF accordion */}
          <div className="rounded-2xl bg-surface-card shadow-soft overflow-hidden">
            <button
              type="button"
              onClick={() => setKsefOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Opcje KSeF (opcjonalne)
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  ksefOpen && 'rotate-180',
                )}
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {ksefOpen && (
              <div className="border-t border-border/40 px-4 pb-4 pt-3">
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
            <p
              className="rounded-2xl border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {submitError}
            </p>
          )}

          {/* Bottom bar */}
          <div className="fixed left-0 right-0 z-30 bottom-[83px] md:bottom-0 border-t border-border/40 bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-none rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                ← Wstecz
              </button>
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={generate.isPending || activeOrderIds.length === 0}
                className={cn(
                  'flex-1 rounded-xl py-3 text-base font-semibold transition-colors',
                  !generate.isPending && activeOrderIds.length > 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'cursor-not-allowed bg-muted text-muted-foreground',
                )}
              >
                {generate.isPending
                  ? 'Tworzenie faktury…'
                  : `Wystaw fakturę — ${pln.format(totalGross)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Export ─────────────────────────────────────────────────────────── */

export function InvoiceFromOrdersPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InvoiceFromOrdersPageContent />;
}

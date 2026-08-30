import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import {
  INVOICE_KSEF_STATUS_LABELS_PL,
  invoiceKsefStatusFilterOptions,
} from '@/constants/invoiceKsefStatusPl';
import { useCustomerListQuery } from '@/query/use-customers';
import {
  useInvoiceListQuery,
  useMarkPaidInvoiceMutation,
  useInvoiceSummaryQuery,
  type InvoiceListFilters,
} from '@/query/use-invoices';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { Invoice, InvoiceKsefStatus, InvoiceStatus } from '@/types';

const PAGE_SIZE = 20;
const CUSTOMER_SEARCH_DEBOUNCE_MS = 350;

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
const plMoney = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function formatGross(value: string | number): string {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  return plMoney.format(n);
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się załadować faktur';
}

// ─── Exported helpers (tests depend on these) ────────────────────────────────

export function invoiceStatusBadgeClassName(status: InvoiceStatus): string {
  switch (status) {
    case 'draft':     return 'bg-surface-container text-on-surface';
    case 'issued':    return 'bg-blue-100 text-blue-800';
    case 'sent':      return 'bg-indigo-100 text-indigo-900';
    case 'paid':      return 'bg-green-100 text-green-800';
    case 'overdue':   return 'bg-amber-100 text-amber-900';
    case 'cancelled': return 'bg-red-100 text-red-800';
    default:          return 'bg-surface-container text-on-surface';
  }
}

export function invoiceKsefStatusBadgeClassName(status: InvoiceKsefStatus): string {
  switch (status) {
    case 'not_sent':  return 'bg-surface-container text-on-surface-variant';
    case 'pending':   return 'bg-amber-100 text-amber-900';
    case 'sent':      return 'bg-blue-100 text-blue-800';
    case 'accepted':  return 'bg-green-100 text-green-800';
    case 'rejected':  return 'bg-red-100 text-red-800';
    default:          return 'bg-surface-container text-on-surface-variant';
  }
}

export function paymentLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'paid':      return 'Opłacona';
    case 'overdue':   return 'Przeterminowana';
    case 'cancelled': return 'Anulowana';
    default:          return 'Nieopłacona';
  }
}

export function paymentBadgeClassName(status: InvoiceStatus): string {
  switch (status) {
    case 'paid':      return 'bg-green-100 text-green-800';
    case 'overdue':   return 'bg-red-100 text-red-800';
    case 'cancelled': return 'bg-surface-container text-on-surface-variant';
    default:          return 'bg-amber-50 text-amber-800';
  }
}

// ─── Tab model ───────────────────────────────────────────────────────────────

/**
 * Each tab maps to either a single `status` value or a `status__in` multi-value.
 * `filterStatus` = single status string (or empty = all)
 * `filterStatusIn` = comma-separated statuses for the status__in param
 */
type StatusTab = {
  label: string;
  /** Single-status filter value, used as tab identity key */
  key: string;
  filterStatus?: InvoiceStatus;
  filterStatusIn?: string;
};

const STATUS_TABS: StatusTab[] = [
  { label: 'Wszystkie',       key: '' },
  { label: 'Nieopłacone',     key: 'unpaid',      filterStatusIn: 'issued,sent' },
  { label: 'Przeterminowane', key: 'overdue',      filterStatus: 'overdue' },
  { label: 'Opłacone',        key: 'paid',         filterStatus: 'paid' },
  { label: 'Szkice',          key: 'draft',        filterStatus: 'draft' },
];

export function buildInvoiceListFilters(
  tabKey: string,
  ksefStatus: '' | InvoiceKsefStatus,
  customerId: string,
  dateFrom: string,
  dateTo: string,
  isCorrection?: boolean,
): InvoiceListFilters {
  const filters: InvoiceListFilters = {};
  const tab = STATUS_TABS.find(t => t.key === tabKey);
  if (tab?.filterStatusIn)            filters['status__in'] = tab.filterStatusIn;
  else if (tab?.filterStatus)         filters.status = tab.filterStatus;
  if (ksefStatus)                     filters.ksef_status = ksefStatus;
  if (customerId)                     filters.customer = customerId;
  if (dateFrom)                       filters.issue_date_after = dateFrom;
  if (dateTo)                         filters.issue_date_before = dateTo;
  if (isCorrection !== undefined)     filters.is_correction = isCorrection;
  return filters;
}

// ─── KSeF status dot ─────────────────────────────────────────────────────────

function KsefDot({ status }: { status: InvoiceKsefStatus }) {
  const dot: Record<InvoiceKsefStatus, string> = {
    accepted: 'bg-emerald-500',
    pending:  'bg-amber-400',
    sent:     'bg-blue-500',
    rejected: 'bg-red-500',
    not_sent: 'bg-gray-300',
  };
  const textColor: Record<InvoiceKsefStatus, string> = {
    accepted: 'text-emerald-700',
    pending:  'text-amber-700',
    sent:     'text-blue-700',
    rejected: 'text-red-600',
    not_sent: 'text-gray-400',
  };
  const label: Record<InvoiceKsefStatus, string> = {
    accepted: 'Przyjęta',
    pending:  'Oczekuje',
    sent:     'W KSeF',
    rejected: 'Błąd',
    not_sent: '—',
  };
  return (
    <span className="flex items-center gap-1.5" title={INVOICE_KSEF_STATUS_LABELS_PL[status]}>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot[status])} />
      <span className={cn('text-[12px] font-medium', textColor[status])}>
        {label[status]}
      </span>
    </span>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconSearch() {
  return (
    <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5', className)} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg className="h-3.5 w-3.5 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}


type OpenColumn = 'ksef' | 'payment' | 'invoice_type' | 'issue_date' | 'due_date' | 'total_gross' | null;

function SortableHeader({
  label,
  field,
  ordering: currentOrdering,
  openColumn,
  colRef,
  onSort,
  onOpen,
  align = 'left',
  ascLabel,
  descLabel,
  ascShort,
  descShort,
}: {
  label: string;
  field: string;
  ordering: string;
  openColumn: OpenColumn;
  colRef: React.RefObject<HTMLDivElement>;
  onSort: (f: string | '') => void;
  onOpen: (col: OpenColumn) => void;
  align?: 'left' | 'right';
  /** Custom labels for asc/desc options. Defaults to Rosnąco/Malejąco. */
  ascLabel?: string;
  descLabel?: string;
  /** Short label shown in header when active. Defaults to first word of ascLabel/descLabel. */
  ascShort?: string;
  descShort?: string;
}) {
  const isAsc = currentOrdering === field;
  const isDesc = currentOrdering === `-${field}`;
  const isActive = isAsc || isDesc;
  const isOpen = openColumn === field;

  const asc = ascLabel ?? 'Rosnąco';
  const desc = descLabel ?? 'Malejąco';
  const activeShort = isAsc ? (ascShort ?? asc) : isDesc ? (descShort ?? desc) : null;

  return (
    <th scope="col" className="whitespace-nowrap px-4 py-3">
      <div ref={colRef} className="relative">
        <button
          type="button"
          onClick={() => onOpen(isOpen ? null : field as OpenColumn)}
          className={cn(
            'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors select-none',
            align === 'right' && 'ml-auto',
            isActive || isOpen ? 'text-[#5856D6]' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          {label}
          {activeShort && (
            <span className="normal-case font-normal text-[10px] text-[#5856D6]">({activeShort})</span>
          )}
          <IconChevronDown />
        </button>
        {isOpen && (
          <div className={cn(
            'absolute top-full z-30 mt-1 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}>
            <button
              type="button"
              onClick={() => { onSort(''); onOpen(null); }}
              className={cn('flex w-full items-center px-3 py-2 text-[13px] text-left transition-colors', !isActive ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50')}
            >
              Domyślnie
            </button>
            <button
              type="button"
              onClick={() => { onSort(field); onOpen(null); }}
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors', isAsc ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50')}
            >
              <span>↑</span> {asc}
            </button>
            <button
              type="button"
              onClick={() => { onSort(`-${field}`); onOpen(null); }}
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors', isDesc ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50')}
            >
              <span>↓</span> {desc}
            </button>
          </div>
        )}
      </div>
    </th>
  );
}

// ─── Page shell ──────────────────────────────────────────────────────────────

export function InvoicesPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InvoicesPageContent />;
}

// ─── Main content ────────────────────────────────────────────────────────────

function InvoicesPageContent() {
  const canInvoices = usePermission('can_manage_invoices');

  // primary tab
  const [activeTab, setActiveTab] = useState('');

  // column header filters / sort
  const [ordering, setOrdering] = useState('');
  const [ksefStatus, setKsefStatus] = useState<'' | InvoiceKsefStatus>('');
  const [openColumnFilter, setOpenColumnFilter] = useState<OpenColumn>(null);

  // date range filter (always visible)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // correction type filter (on Nr faktury column header)
  const [correctionFilter, setCorrectionFilter] = useState<boolean | undefined>(undefined);

  // pagination
  const [page, setPage] = useState(1);
  const resetPage = () => setPage(1);

  // client autocomplete
  const [customerId, setCustomerId] = useState('');
  const [customerSearchInput, setCustomerSearchInput] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState('');
  const customerWrapRef = useRef<HTMLDivElement>(null);
  const ksefColumnRef = useRef<HTMLDivElement>(null);
  const paymentColumnRef = useRef<HTMLDivElement>(null);
  const invoiceTypeRef = useRef<HTMLDivElement>(null);
  const issueDateRef = useRef<HTMLDivElement>(null);
  const dueDateRef = useRef<HTMLDivElement>(null);
  const totalGrossRef = useRef<HTMLDivElement>(null);

  const columnRefs: Record<NonNullable<OpenColumn>, React.RefObject<HTMLDivElement>> = {
    ksef: ksefColumnRef,
    payment: paymentColumnRef,
    invoice_type: invoiceTypeRef,
    issue_date: issueDateRef,
    due_date: dueDateRef,
    total_gross: totalGrossRef,
  };

  useEffect(() => {
    if (!openColumnFilter) return;
    function handleMouseDown(e: MouseEvent) {
      const activeRef = columnRefs[openColumnFilter!];
      if (activeRef.current && !activeRef.current.contains(e.target as Node)) {
        setOpenColumnFilter(null);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [openColumnFilter]);

  useEffect(() => {
    const h = window.setTimeout(() => setCustomerSearch(customerSearchInput.trim()), CUSTOMER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(h);
  }, [customerSearchInput]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (customerWrapRef.current && !customerWrapRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const { data: customersData, isFetching: customersLoading } = useCustomerListQuery(1, customerSearch);
  const customerOptions = customersData?.results ?? [];
  const selectedCustomer = customerId ? customerOptions.find(c => c.id === customerId) : null;
  const displayedCustomerName = selectedCustomer
    ? (selectedCustomer.company_name || selectedCustomer.name)
    : selectedCustomerLabel;

  function selectCustomer(id: string, label: string) {
    setCustomerId(id);
    setSelectedCustomerLabel(label);
    setCustomerSearchInput('');
    setShowCustomerDropdown(false);
    resetPage();
  }

  function clearCustomer() {
    setCustomerId('');
    setSelectedCustomerLabel('');
    setCustomerSearchInput('');
    resetPage();
  }

  // data
  const listFilters = buildInvoiceListFilters(activeTab, ksefStatus, customerId, dateFrom, dateTo, correctionFilter);
  const { data, isFetching, isError, error, refetch } = useInvoiceListQuery(page, {
    ...listFilters,
    ...(ordering && { ordering }),
  });
  const { data: summary, isLoading: summaryLoading } = useInvoiceSummaryQuery();
  const items = data?.results ?? [];
  const count = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));


  // reset page on any filter/sort change
  useEffect(() => { resetPage(); }, [activeTab, ksefStatus, customerId, dateFrom, dateTo, correctionFilter, ordering]);

  // expanded rows (product preview)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleExpand(id: string) {
    setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // bulk mark-paid
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [pendingPaidIds, setPendingPaidIds] = useState<Set<string>>(new Set());
  const markPaidMutation = useMarkPaidInvoiceMutation();
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selectableItems = items.filter(r => r.status !== 'paid' && r.status !== 'cancelled');
  const selectedOnPage = selectableItems.filter(r => selectedIds.has(r.id));
  const allSelected = selectableItems.length > 0 && selectedOnPage.length === selectableItems.length;
  const someSelected = selectedIds.size > 0;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedOnPage.length > 0 && !allSelected;
  }, [selectedOnPage.length, allSelected]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [page, activeTab, ksefStatus, customerId, dateFrom, dateTo, correctionFilter, ordering]);

  function exitSelectionMode() { setSelectionMode(false); setSelectedIds(new Set()); }
  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableItems.map(r => r.id)));
  }

  async function handleMarkSelectedPaid() {
    setIsMarkingPaid(true);
    try { await Promise.all(Array.from(selectedIds).map(id => markPaidMutation.mutateAsync(id))); exitSelectionMode(); }
    finally { setIsMarkingPaid(false); }
  }

  async function handleSingleMarkPaid(id: string) {
    setPendingPaidIds(prev => new Set(prev).add(id));
    try { await markPaidMutation.mutateAsync(id); }
    finally { setPendingPaidIds(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-full pb-16"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", background: '#F5F5F7' }}
    >
      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-[28px] font-bold tracking-tight text-gray-900">Faktury</h1>
          {canInvoices && (
            <Link
              to="/invoices/new"
              className="flex items-center gap-1.5 rounded-full bg-[#5856D6] px-4 py-2 text-[14px] font-semibold text-white shadow-sm hover:bg-[#4744C4] active:scale-95 transition-all"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              Nowa faktura
            </Link>
          )}
        </div>

        {/* ── KPI cards ───────────────────────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {([
            {
              label: 'Nieopłacone',
              count: summary?.unpaid_count ?? 0,
              total: summary?.unpaid_total ?? '0',
              tabKey: 'unpaid',
              labelColor: '#B45309',
              accent: '#C45500',
              ring: '#FF9500',
              bg: '#FFFBEB',
            },
            {
              label: 'Przeterminowane',
              count: summary?.overdue_count ?? 0,
              total: summary?.overdue_total ?? '0',
              tabKey: 'overdue',
              labelColor: '#B91C1C',
              accent: '#C0392B',
              ring: '#FF3B30',
              bg: '#FEF2F2',
            },
            {
              label: 'Opłacone — ten miesiąc',
              count: summary?.paid_this_month_count ?? 0,
              total: summary?.paid_this_month_total ?? '0',
              tabKey: 'paid',
              labelColor: '#166534',
              accent: '#1D7A3A',
              ring: '#34C759',
              bg: '#F0FDF4',
            },
          ] as const).map(tile => {
            const active = activeTab === tile.tabKey;
            return (
              <button
                key={tile.label}
                type="button"
                onClick={() => { setActiveTab(active ? '' : tile.tabKey); resetPage(); }}
                className={cn(
                  'flex flex-col rounded-xl p-3.5 text-left shadow-sm border transition-all hover:shadow-md active:scale-[0.98]',
                  active ? 'border-transparent' : 'border-gray-100',
                )}
                style={{
                  backgroundColor: tile.bg,
                  ...(active ? { boxShadow: `0 0 0 2px ${tile.ring}` } : {}),
                }}
              >
                <span className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: tile.labelColor }}>
                  {tile.label}
                </span>
                {summaryLoading ? (
                  <span className="text-xl font-bold text-gray-200">—</span>
                ) : (
                  <>
                    <span className="text-[22px] font-bold leading-none text-gray-900">{tile.count}</span>
                    <span className="mt-1.5 text-[12px] font-medium" style={{ color: tile.accent }}>
                      {formatGross(tile.total)}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Status tabs ─────────────────────────────────────────────────── */}
        <div className="mb-5 border-b border-gray-200">
          <div
            className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            role="tablist"
            aria-label="Filtruj po statusie płatności"
          >
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => { setActiveTab(tab.key); resetPage(); }}
                className={cn(
                  'shrink-0 whitespace-nowrap px-4 pb-3 pt-1 text-[14px] font-medium transition-colors border-b-2',
                  activeTab === tab.key
                    ? 'border-[#5856D6] text-[#5856D6]'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Search bar ──────────────────────────────────────────────────── */}
        <div className="mb-3">
          <div ref={customerWrapRef} className="relative">
            {customerId ? (
              <div className="flex items-center gap-2 rounded-lg border border-[#5856D6]/30 bg-[#5856D6]/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-[#5856D6]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
                </svg>
                <span className="flex-1 text-[14px] font-medium text-gray-900">{displayedCustomerName}</span>
                <button type="button" onClick={clearCustomer} aria-label="Usuń filtr klienta" className="rounded p-0.5 text-gray-400 hover:text-gray-600">
                  <IconX />
                </button>
              </div>
            ) : (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                  <IconSearch />
                </span>
                <input
                  type="text"
                  id="invoice-customer-search"
                  placeholder="Szukaj klienta, NIP, nr faktury…"
                  value={customerSearchInput}
                  onChange={e => { setCustomerSearchInput(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => customerSearchInput.length > 0 && setShowCustomerDropdown(true)}
                  autoComplete="off"
                  aria-label="Szukaj klienta"
                  aria-expanded={showCustomerDropdown && customerOptions.length > 0}
                  aria-haspopup="listbox"
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-[14px] text-gray-900 placeholder-gray-400 shadow-sm focus:border-[#5856D6]/40 focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
                />
                {customersLoading && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>
                )}
              </div>
            )}
            {!customerId && showCustomerDropdown && customerOptions.length > 0 && (
              <ul
                role="listbox"
                aria-label="Wyniki wyszukiwania klientów"
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg"
              >
                {customerOptions.map(c => (
                  <li key={c.id} role="option" aria-selected={c.id === customerId}>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectCustomer(c.id, c.company_name || c.name)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[12px] font-semibold text-gray-600">
                        {(c.company_name || c.name).charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-gray-900">{c.company_name || c.name}</span>
                        {c.nip && <span className="text-[12px] text-gray-400">NIP {c.nip}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Date range bar (always visible) ─────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 shrink-0">
            Data wystawienia:
          </span>
          <div className="flex items-center gap-1.5">
            <input
              id="invoice-issue-from"
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); resetPage(); }}
              aria-label="Data wystawienia od"
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[13px] text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20',
                dateFrom ? 'border-[#5856D6]/40 bg-[#5856D6]/5 text-[#5856D6]' : 'border-gray-200 bg-white',
              )}
            />
            <span className="text-[12px] text-gray-400">—</span>
            <input
              id="invoice-issue-to"
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); resetPage(); }}
              aria-label="Data wystawienia do"
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[13px] text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20',
                dateTo ? 'border-[#5856D6]/40 bg-[#5856D6]/5 text-[#5856D6]' : 'border-gray-200 bg-white',
              )}
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); resetPage(); }}
                aria-label="Wyczyść zakres dat"
                className="rounded p-0.5 text-gray-400 hover:text-gray-600"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1.5">
            {[
              { label: 'Ten miesiąc', fn: () => {
                const now = new Date();
                setDateFrom(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`);
                setDateTo(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()).padStart(2,'0')}`);
                resetPage();
              }},
              { label: 'Poprzedni', fn: () => {
                const now = new Date();
                const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                setDateFrom(`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-01`);
                const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
                setDateTo(`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`);
                resetPage();
              }},
              { label: 'Ten rok', fn: () => {
                const y = new Date().getFullYear();
                setDateFrom(`${y}-01-01`);
                setDateTo(`${y}-12-31`);
                resetPage();
              }},
            ].map(({ label, fn }) => (
              <button
                key={label}
                type="button"
                onClick={fn}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── List header ─────────────────────────────────────────────────── */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wide">
            {isFetching ? 'Ładowanie…' : `Znaleziono: ${count}`}
          </span>
          {!selectionMode && selectableItems.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectionMode(true)}
              className="text-[13px] font-medium text-[#5856D6] hover:underline"
            >
              Oznacz opłacone
            </button>
          )}
        </div>

        {/* ── Bulk selection bar ──────────────────────────────────────────── */}
        {selectionMode && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <span className="text-[14px] font-medium text-gray-700">
              {someSelected
                ? `${selectedIds.size} ${selectedIds.size === 1 ? 'faktura zaznaczona' : 'faktury zaznaczone'}`
                : 'Zaznacz faktury, które zostały opłacone'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isMarkingPaid || !someSelected}
                onClick={() => void handleMarkSelectedPaid()}
                aria-label={someSelected ? `Oznacz ${selectedIds.size} faktur jako opłacone` : 'Oznacz zaznaczone faktury jako opłacone'}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm disabled:opacity-40 active:scale-95 transition-transform hover:bg-emerald-700"
              >
                {isMarkingPaid ? 'Oznaczam…' : 'Oznacz jako opłacone'}
              </button>
              <button
                type="button"
                disabled={isMarkingPaid}
                onClick={exitSelectionMode}
                className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-[13px] font-medium text-gray-600 active:scale-95 transition-transform disabled:opacity-40 hover:bg-gray-50"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}

        {isError && (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 border border-red-100" role="alert">
            <p className="text-[14px] text-red-600">{queryErrorMessage(error)}</p>
            <button type="button" onClick={() => void refetch()} className="text-[13px] font-medium text-red-700 underline">
              Spróbuj ponownie
            </button>
          </div>
        )}

        {/* ── Mobile cards ────────────────────────────────────────────────── */}
        <div className="space-y-2 md:hidden">
          {items.map((row: Invoice) => (
            <div key={row.id} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-start gap-3 px-4 py-3.5">
                {selectionMode && row.status !== 'paid' && row.status !== 'cancelled' && (
                  <input
                    type="checkbox"
                    aria-label={`Zaznacz fakturę ${row.invoice_number ?? row.id.slice(0, 8)}`}
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#5856D6]"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link to={`/invoices/${row.id}`} className="text-[15px] font-semibold text-[#5856D6]">
                          {row.invoice_number ?? row.id.slice(0, 8)}
                        </Link>
                        {row.is_correction && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">KOR</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-gray-500">{row.order.customer_name || '—'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-semibold text-gray-900">{formatGross(row.total_gross)}</p>
                      <span className={cn(
                        'text-[12px] font-medium',
                        row.status === 'paid' ? 'text-emerald-700' : row.status === 'overdue' ? 'text-red-600' : 'text-amber-700',
                      )}>
                        {paymentLabel(row.status)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] text-gray-400">Termin: {formatDate(row.due_date)}</span>
                      <KsefDot status={row.ksef_status} />
                    </div>
                    {!selectionMode && row.status !== 'paid' && row.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => void handleSingleMarkPaid(row.id)}
                        disabled={pendingPaidIds.has(row.id)}
                        aria-label={`Oznacz fakturę ${row.invoice_number ?? row.id.slice(0, 8)} jako opłaconą`}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-[12px] font-semibold text-white shadow-sm disabled:opacity-50 active:scale-95 transition-transform hover:bg-emerald-700"
                      >
                        {pendingPaidIds.has(row.id) ? '…' : 'Opłać'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Desktop table ───────────────────────────────────────────────── */}
        <div className="hidden overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm md:block">
          <table className="min-w-full text-sm" aria-label="Lista faktur">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                {selectionMode && (
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      aria-label="Zaznacz wszystkie faktury na stronie"
                      checked={allSelected}
                      disabled={selectableItems.length === 0}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 cursor-pointer accent-[#5856D6] disabled:cursor-default disabled:opacity-30"
                    />
                  </th>
                )}
                <th scope="col" className="whitespace-nowrap px-4 py-3">
                  <div ref={invoiceTypeRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenColumnFilter(prev => prev === 'invoice_type' ? null : 'invoice_type')}
                      className={cn(
                        'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                        correctionFilter !== undefined || openColumnFilter === 'invoice_type' ? 'text-[#5856D6]' : 'text-gray-500 hover:text-gray-700',
                      )}
                    >
                      Nr faktury
                      {correctionFilter !== undefined && <span className="h-1.5 w-1.5 rounded-full bg-[#5856D6]" aria-hidden="true" />}
                      <IconChevronDown />
                    </button>
                    {openColumnFilter === 'invoice_type' && (
                      <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                        {([
                          { label: 'Wszystkie', value: undefined },
                          { label: 'Korekty FV-KOR', value: true },
                          { label: 'Tylko zwykłe', value: false },
                        ] as { label: string; value: boolean | undefined }[]).map(({ label, value }) => (
                          <button
                            key={String(value)}
                            type="button"
                            onClick={() => { setCorrectionFilter(value); setOpenColumnFilter(null); resetPage(); }}
                            className={cn('flex w-full items-center px-3 py-2 text-[13px] text-left transition-colors', correctionFilter === value ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50')}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Klient</th>
                <SortableHeader label="Data wystawienia" field="issue_date" ordering={ordering} openColumn={openColumnFilter} colRef={issueDateRef} onSort={f => { setOrdering(f); resetPage(); }} onOpen={setOpenColumnFilter} ascLabel="Najstarsze" descLabel="Najnowsze" ascShort="Najstarsze" descShort="Najnowsze" />
                <SortableHeader label="Termin płatności" field="due_date" ordering={ordering} openColumn={openColumnFilter} colRef={dueDateRef} onSort={f => { setOrdering(f); resetPage(); }} onOpen={setOpenColumnFilter} ascLabel="Najwcześniejszy" descLabel="Najpóźniejszy" ascShort="Najwcześniej" descShort="Najpóźniej" />
                <SortableHeader label="Wartość brutto" field="total_gross" ordering={ordering} openColumn={openColumnFilter} colRef={totalGrossRef} onSort={f => { setOrdering(f); resetPage(); }} onOpen={setOpenColumnFilter} align="right" />
                <th scope="col" className="whitespace-nowrap px-4 py-3">
                  <div ref={paymentColumnRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenColumnFilter(prev => prev === 'payment' ? null : 'payment')}
                      className={cn(
                        'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                        openColumnFilter === 'payment' ? 'text-[#5856D6]' : 'text-gray-500 hover:text-gray-700',
                      )}
                    >
                      Płatność
                      <IconChevronDown />
                    </button>
                    {openColumnFilter === 'payment' && (
                      <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                        {([
                          { label: 'Wszystkie', key: '' },
                          { label: 'Nieopłacone', key: 'unpaid' },
                          { label: 'Przeterminowane', key: 'overdue' },
                          { label: 'Opłacone', key: 'paid' },
                        ] as const).map(({ label, key }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => { setActiveTab(key); setOpenColumnFilter(null); resetPage(); }}
                            className={cn(
                              'flex w-full items-center px-3 py-2 text-[13px] text-left transition-colors',
                              activeTab === key ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 min-w-[90px]">
                  <div ref={ksefColumnRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenColumnFilter(prev => prev === 'ksef' ? null : 'ksef')}
                      className={cn(
                        'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                        ksefStatus || openColumnFilter === 'ksef' ? 'text-[#5856D6]' : 'text-gray-500 hover:text-gray-700',
                      )}
                    >
                      KSeF
                      {ksefStatus && <span className="h-1.5 w-1.5 rounded-full bg-[#5856D6]" aria-hidden="true" />}
                      <IconChevronDown />
                    </button>
                    {openColumnFilter === 'ksef' && (
                      <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => { setKsefStatus(''); setOpenColumnFilter(null); resetPage(); }}
                          className={cn('flex w-full items-center px-3 py-2 text-[13px] text-left transition-colors', !ksefStatus ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50')}
                        >
                          Wszystkie
                        </button>
                        {invoiceKsefStatusFilterOptions.map(o => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => { setKsefStatus(o.value); setOpenColumnFilter(null); resetPage(); }}
                            className={cn('flex w-full items-center px-3 py-2 text-[13px] text-left transition-colors', ksefStatus === o.value ? 'text-[#5856D6] font-semibold' : 'text-gray-700 hover:bg-gray-50')}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row: Invoice) => (<>
                <tr key={row.id} className={cn('group border-b border-gray-50 transition-colors', expandedRows.has(row.id) ? 'bg-gray-50/70' : 'hover:bg-gray-50/70')}>
                  {selectionMode && (
                    <td className="w-10 px-4 py-3.5">
                      {row.status !== 'paid' && row.status !== 'cancelled' ? (
                        <input
                          type="checkbox"
                          aria-label={`Zaznacz fakturę ${row.invoice_number ?? row.id.slice(0, 8)}`}
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="h-4 w-4 cursor-pointer accent-[#5856D6]"
                        />
                      ) : (
                        <span className="block h-4 w-4" />
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <Link to={`/invoices/${row.id}`} className="text-[14px] font-semibold text-[#5856D6] hover:underline">
                          {row.invoice_number ?? row.id.slice(0, 8)}
                        </Link>
                        {row.is_correction && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">KOR</span>
                        )}
                      </div>
                      {row.is_correction && row.corrects_invoice_id && (
                        <Link to={`/invoices/${row.corrects_invoice_id}`} className="text-[12px] text-gray-400 hover:text-[#5856D6] hover:underline">
                          Koryguje: {row.corrects_invoice_number ?? row.corrects_invoice_id.slice(0, 8)}
                        </Link>
                      )}
                      {!row.is_correction && row.corrections?.length > 0 && row.corrections.map(c => (
                        <Link key={c.id} to={`/invoices/${c.id}`} className="text-[12px] text-amber-600 hover:underline">
                          Korekta: {c.invoice_number ?? c.id.slice(0, 8)}
                        </Link>
                      ))}
                      <Link to={`/orders/${row.order.id}`} className="text-[12px] text-gray-400 hover:text-[#5856D6] hover:underline">
                        Zamówienie
                      </Link>
                    </div>
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3.5 text-[14px] text-gray-600" title={row.order.customer_name}>
                    {row.order.customer_name || '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[14px] text-gray-500">{formatDate(row.issue_date)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[14px] text-gray-500">{formatDate(row.due_date)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right text-[14px] font-semibold tabular-nums text-gray-900">
                    {formatGross(row.total_gross)}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'text-[13px] font-medium',
                        row.status === 'paid' ? 'text-emerald-700'
                          : row.status === 'overdue' ? 'text-red-600'
                          : row.status === 'cancelled' ? 'text-gray-400'
                          : 'text-amber-700',
                      )}>
                        {paymentLabel(row.status)}
                      </span>
                      {!selectionMode && row.status !== 'paid' && row.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => void handleSingleMarkPaid(row.id)}
                          disabled={pendingPaidIds.has(row.id)}
                          aria-label={`Oznacz fakturę ${row.invoice_number ?? row.id.slice(0, 8)} jako opłaconą`}
                          className={cn(
                            'rounded-md bg-emerald-600 px-2.5 py-0.5 text-[12px] font-semibold text-white shadow-sm transition-all disabled:opacity-50 hover:bg-emerald-700',
                            pendingPaidIds.has(row.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                          )}
                        >
                          {pendingPaidIds.has(row.id) ? '…' : 'Opłać'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <KsefDot status={row.ksef_status} />
                      {row.items?.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(row.id)}
                          aria-label={expandedRows.has(row.id) ? 'Zwiń produkty' : 'Pokaż produkty'}
                          className="text-gray-300 transition-colors hover:text-gray-500"
                        >
                          <svg
                            className={cn('h-4 w-4 transition-transform', expandedRows.has(row.id) && 'rotate-180')}
                            viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                          >
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedRows.has(row.id) && row.items?.length > 0 && (
                  <tr className="bg-gray-50/50">
                    <td colSpan={selectionMode ? 8 : 7} className="px-6 pb-3 pt-0">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="pb-1.5 pt-2 text-left font-medium text-gray-400 w-full">Produkt</th>
                            <th className="pb-1.5 pt-2 text-right font-medium text-gray-400 whitespace-nowrap pr-6">Ilość</th>
                            <th className="pb-1.5 pt-2 text-right font-medium text-gray-400 whitespace-nowrap pr-6">Cena netto</th>
                            <th className="pb-1.5 pt-2 text-right font-medium text-gray-400 whitespace-nowrap pr-6">VAT</th>
                            <th className="pb-1.5 pt-2 text-right font-medium text-gray-400 whitespace-nowrap">Razem brutto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.items.map(item => (
                            <tr key={item.id} className="border-b border-gray-50 last:border-0">
                              <td className="py-1.5 text-gray-700">{item.product_name}</td>
                              <td className="py-1.5 text-right tabular-nums text-gray-500 pr-6">
                                {Number(item.quantity)} {item.product_unit}
                              </td>
                              <td className="py-1.5 text-right tabular-nums text-gray-500 pr-6">
                                {formatGross(item.unit_price_net)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums text-gray-400 pr-6">
                                {item.vat_rate}%
                              </td>
                              <td className="py-1.5 text-right tabular-nums font-medium text-gray-800">
                                {formatGross(item.line_gross)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </>))}
              {!isFetching && items.length === 0 && !isError && (
                <tr>
                  <td
                    colSpan={selectionMode ? 8 : 7}
                    className="h-64 py-16 text-center text-[15px] text-gray-400"
                  >
                    Brak faktur spełniających kryteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-between">
            <span className="text-[13px] text-gray-400">
              Strona <span className="font-medium text-gray-700">{page}</span> z <span className="font-medium text-gray-700">{totalPages}</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-[13px] font-medium text-gray-700 shadow-sm disabled:opacity-30 active:scale-95 transition-transform hover:bg-gray-50"
              >
                Poprzednia
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-[13px] font-medium text-gray-700 shadow-sm disabled:opacity-30 active:scale-95 transition-transform hover:bg-gray-50"
              >
                Następna
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

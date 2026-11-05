/**
 * WarehouseMovesPage — internal warehouse movement documents: RW and MM.
 *
 * Route: /warehouse-moves
 *
 * PZ/PZ-KOR are managed via /purchase-documents (linked to supplier invoices).
 * WZ/ZW/WZ-KOR are managed via /delivery.
 * This page shows only internal warehouse moves.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useDeliveryByRangeQuery } from '@/query/use-delivery';
import { authStorage } from '@/services/api';
import { DELIVERY_STATUS_LABELS_PL, deliveryStatusFilterOptions } from '@/constants/deliveryStatusPl';
import { ReportExpandIcon, reportPresetClass } from '@/lib/reportSurface';
import { cn } from '@/lib/utils';
import type { DeliveryDocument, DeliveryDocumentStatus, DeliveryDocumentType, DeliveryItem } from '@/types';
import { createPortal } from 'react-dom';

const PAGE_SIZE = 20;
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

const MOVE_TYPES = new Set<DeliveryDocumentType>(['RW', 'MM']);

const DOC_TYPE_FILTER_OPTIONS: { value: DeliveryDocumentType; label: string }[] = [
  { value: 'RW', label: 'RW — Rozchód wewnętrzny' },
  { value: 'MM', label: 'MM — Przesunięcie międzymagazynowe' },
];

const DOC_TYPE_LABELS_PL: Partial<Record<DeliveryDocumentType, string>> = {
  RW: 'RW',
  MM: 'MM',
};

type ListColumn = 'number' | 'type' | 'status' | 'notes';

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function currentMonthRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: todayIso() };
}

function thisWeekRange(): { from: string; to: string } {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function prevMonthRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function statusBadgeClass(status: DeliveryDocumentStatus): string {
  switch (status) {
    case 'draft':      return 'bg-surface-container text-on-surface';
    case 'saved':      return 'bg-blue-100 text-blue-800';
    case 'in_transit': return 'bg-amber-100 text-amber-900';
    case 'delivered':  return 'bg-green-100 text-green-800';
    case 'cancelled':  return 'bg-red-100 text-red-800';
    default:           return 'bg-surface-container text-on-surface';
  }
}

function fmtQty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function productLabel(item: DeliveryItem): string {
  return item.product_name?.trim() || item.product_id.slice(0, 8);
}

function includesFold(haystack: string, needle: string): boolean {
  const q = needle.trim().toLocaleLowerCase('pl');
  if (!q) return true;
  return haystack.toLocaleLowerCase('pl').includes(q);
}

function compareNewestNumberFirst(a: DeliveryDocument, b: DeliveryDocument): number {
  const na = a.document_number?.trim() ?? '';
  const nb = b.document_number?.trim() ?? '';
  if (na && nb) return nb.localeCompare(na, 'pl', { numeric: true });
  if (na) return -1;
  if (nb) return 1;
  return (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

function compareNewestDateFirst(a: DeliveryDocument, b: DeliveryDocument): number {
  const da = a.issue_date ?? '';
  const db = b.issue_date ?? '';
  if (da !== db) return db.localeCompare(da);
  return (b.document_number?.trim() ?? '').localeCompare(a.document_number?.trim() ?? '', 'pl', { numeric: true });
}

function toggleInSet<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function FilterSearch({ label, value, onChange, placeholder, autoFocus = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean;
}) {
  return (
    <input type="search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} aria-label={label} className="field-ios-sm w-full" autoFocus={autoFocus} />
  );
}

function CheckList<T extends string>({ options, selected, onToggle, emptyText }: {
  options: { value: T; label: string }[]; selected: Set<T>; onToggle: (v: T) => void; emptyText: string;
}) {
  if (options.length === 0) return <p className="px-1 py-2 text-xs text-slate-500">{emptyText}</p>;
  return (
    <ul className="max-h-52 space-y-0.5 overflow-y-auto">
      {options.map((o) => (
        <li key={o.value}>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary"
              checked={selected.has(o.value)} onChange={() => onToggle(o.value)} />
            <span className="min-w-0 truncate">{o.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function ClearFilterButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="text-xs font-medium text-primary hover:underline">Wyczyść</button>;
}

function ColumnFilterTh({ label, active, open, onToggle, align = 'left', children }: {
  label: string; active: boolean; open: boolean; onToggle: () => void; align?: 'left' | 'right'; children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const preferred = align === 'right' ? rect.right - width : rect.left;
      const left = Math.min(window.innerWidth - width - 8, Math.max(8, preferred));
      setPos({ top: rect.bottom + 4, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, align]);

  return (
    <th scope="col" className="whitespace-nowrap px-3 py-3 text-left">
      <div data-column-filter="">
        <button ref={buttonRef} type="button" aria-expanded={open} aria-haspopup="dialog"
          aria-label={active ? `${label}, filtr włączony` : undefined}
          onClick={onToggle}
          className={cn('flex items-center gap-1 text-xs font-semibold uppercase tracking-wide',
            active || open ? 'text-primary' : 'text-slate-500 hover:text-slate-700')}
        >
          {label}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
          <svg className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && pos && createPortal(
          <div data-column-filter="" role="dialog" aria-label={`Filtr: ${label}`}
            className="fixed z-40 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-apple-md"
            style={{ top: pos.top, left: pos.left }}>
            {children}
          </div>,
          document.body,
        )}
      </div>
    </th>
  );
}

function ExpandableMoveRow({ row }: { row: DeliveryDocument }) {
  const [expanded, setExpanded] = useState(false);
  const hasItems = (row.items?.length ?? 0) > 0;

  return (
    <>
      <tr
        className={cn('border-b border-slate-100 hover:bg-slate-50', hasItems && 'cursor-pointer', expanded && 'border-b-0')}
        onClick={(e) => {
          if (!hasItems) return;
          if ((e.target as HTMLElement).closest('a, button, input')) return;
          setExpanded((v) => !v);
        }}
      >
        <td className="w-8 px-2 py-3">
          {hasItems && (
            <button type="button" aria-label={expanded ? 'Zwiń pozycje' : 'Rozwiń pozycje'} aria-expanded={expanded}
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <ReportExpandIcon open={expanded} />
            </button>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3">
          <Link to={`/delivery/${row.id}`} className="text-sm font-semibold text-primary hover:underline">
            {row.document_number ?? row.id.slice(0, 8)}
          </Link>
        </td>
        <td className="whitespace-nowrap px-3 py-3">
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            row.document_type === 'RW' ? 'bg-red-100 text-red-800' : 'bg-purple-100 text-purple-800')}>
            {DOC_TYPE_LABELS_PL[row.document_type] ?? row.document_type}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-500">{formatIssueDate(row.issue_date)}</td>
        <td className="px-3 py-3">
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', statusBadgeClass(row.status))}>
            {DELIVERY_STATUS_LABELS_PL[row.status] ?? row.status}
          </span>
        </td>
        <td className="max-w-[280px] truncate px-3 py-3 text-sm text-slate-500" title={row.notes ?? undefined}>
          {row.notes?.trim() || '—'}
        </td>
      </tr>
      {expanded && hasItems && (
        <tr className="border-b border-slate-100 bg-slate-50/40">
          <td className="w-8 px-2" />
          <td colSpan={99} className="px-3 pb-3 pt-1">
            <div className="inline-grid w-80 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8 gap-y-1 text-sm">
              {row.items.map((item) => (
                <Fragment key={item.id}>
                  <span className="truncate text-slate-600" title={productLabel(item)}>{productLabel(item)}</span>
                  <span className="tabular-nums text-slate-600">
                    {fmtQty(item.quantity_actual ?? item.quantity_planned)}{' '}
                    {item.product_unit?.trim() || 'szt.'}
                  </span>
                </Fragment>
              ))}
            </div>
          </td>
          <td /><td /><td /><td />
        </tr>
      )}
    </>
  );
}

export function WarehouseMovesPage() {
  const { pathname } = { pathname: '/warehouse-moves' };
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }
  return <WarehouseMovesPageContent />;
}

function WarehouseMovesPageContent() {
  const canRW = usePermission('can_manage_stock_moves');
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultFrom = currentMonthRange().from;
  const defaultTo = currentMonthRange().to;
  const dateFrom = searchParams.get('from') ?? defaultFrom;
  const dateTo = searchParams.get('to') ?? defaultTo;
  const setDateFrom = (v: string) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('from', v); return n; }, { replace: true });
  const setDateTo = (v: string) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('to', v); return n; }, { replace: true });

  const sortBy = (searchParams.get('sort') as 'number' | 'date' | null) ?? 'number';
  const setSortBy = (s: 'number' | 'date') => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('sort', s); return n; }, { replace: true });

  const [listStatuses, setListStatuses] = useState<Set<DeliveryDocumentStatus>>(() => new Set());
  const [listTypes, setListTypes] = useState<Set<DeliveryDocumentType>>(() => new Set());
  const [listNumberQuery, setListNumberQuery] = useState('');
  const [listNotesQuery, setListNotesQuery] = useState('');
  const [openColumn, setOpenColumn] = useState<ListColumn | null>(null);
  const [listPage, setListPage] = useState(1);

  const { data, isFetching, isError, error, refetch } = useDeliveryByRangeQuery(dateFrom, dateTo);

  const allDocs = useMemo(
    () => [...(data?.results ?? [])].filter((d) => MOVE_TYPES.has(d.document_type)).sort(
      sortBy === 'date' ? compareNewestDateFirst : compareNewestNumberFirst,
    ),
    [data?.results, sortBy],
  );

  const filteredDocs = useMemo(() => {
    const numQ = listNumberQuery.trim();
    const notesQ = listNotesQuery.trim();
    return allDocs.filter((doc) => {
      if (listTypes.size > 0 && !listTypes.has(doc.document_type)) return false;
      if (listStatuses.size > 0 && !listStatuses.has(doc.status)) return false;
      if (numQ && !includesFold(doc.document_number?.trim() || '', numQ)) return false;
      if (notesQ && !includesFold(doc.notes?.trim() || '', notesQ)) return false;
      return true;
    });
  }, [allDocs, listTypes, listStatuses, listNumberQuery, listNotesQuery]);

  useEffect(() => { setListPage(1); }, [listTypes, listStatuses, listNumberQuery, listNotesQuery, dateFrom, dateTo]);

  useEffect(() => {
    if (!openColumn) return;
    function onPointerDown(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('[data-column-filter]')) return;
      setOpenColumn(null);
    }
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') setOpenColumn(null); }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [openColumn]);

  const toggleColumn = (col: ListColumn) => setOpenColumn((c) => (c === col ? null : col));

  const numberFilterActive = listNumberQuery.trim().length > 0;
  const typeFilterActive = listTypes.size > 0;
  const statusFilterActive = listStatuses.size > 0;
  const notesFilterActive = listNotesQuery.trim().length > 0;
  const activeFilterCount = [numberFilterActive, typeFilterActive, statusFilterActive, notesFilterActive].filter(Boolean).length;

  const clearFilters = () => {
    setListTypes(new Set()); setListStatuses(new Set()); setListNumberQuery(''); setListNotesQuery('');
  };

  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / PAGE_SIZE));
  const pagedDocs = filteredDocs.slice((listPage - 1) * PAGE_SIZE, listPage * PAGE_SIZE);

  const setRange = (from: string, to: string) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('from', from); n.set('to', to); return n; }, { replace: true });
  const isActiveRange = (from: string, to: string) => dateFrom === from && dateTo === to;

  const today = todayIso();
  const thisWeek = thisWeekRange();
  const thisMonth = currentMonthRange();
  const prevMonth = prevMonthRange();

  const quickRanges = [
    { label: 'Dziś', from: today, to: today },
    { label: 'Ten tydzień', from: thisWeek.from, to: thisWeek.to },
    { label: 'Ten miesiąc', from: thisMonth.from, to: thisMonth.to },
    { label: 'Poprzedni miesiąc', from: prevMonth.from, to: prevMonth.to },
  ];

  const rrCount = allDocs.filter((d) => d.document_type === 'RW').length;
  const mmCount = allDocs.filter((d) => d.document_type === 'MM').length;

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Ruchy magazynowe</h1>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {canRW && (
              <>
                <Link to="/delivery/new-mm" className="w-full sm:w-auto">
                  <Button variant="outline" className="w-full sm:w-auto">+ Nowe MM</Button>
                </Link>
                <Link to="/delivery/new-rw" className="w-full sm:w-auto">
                  <Button variant="outline" className="w-full sm:w-auto">+ Nowe RW</Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Date range bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:rounded-3xl">
          <div className="relative">
            <select
              aria-label="Szybki zakres dat"
              value={quickRanges.find(({ from, to }) => isActiveRange(from, to))?.label ?? 'custom'}
              onChange={(e) => { const r = quickRanges.find((x) => x.label === e.target.value); if (r) setRange(r.from, r.to); }}
              className="select-pill border-[#D4D2EE] bg-white font-normal text-slate-900 focus:border-primary focus:bg-white"
            >
              <option value="custom">Własny zakres</option>
              {quickRanges.map(({ label }) => <option key={label} value={label}>{label}</option>)}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Data wystawienia od" className="date-pill border-[#D4D2EE] bg-white font-normal text-slate-900 focus:border-primary focus:bg-white" />
          <span className="text-slate-400">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            aria-label="Data wystawienia do" className="date-pill border-[#D4D2EE] bg-white font-normal text-slate-900 focus:border-primary focus:bg-white" />
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            {isFetching ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            ) : (
              <>
                {rrCount > 0 && <span>{rrCount} RW</span>}
                {rrCount > 0 && mmCount > 0 && <span>·</span>}
                {mmCount > 0 && <span>{mmCount} MM</span>}
                {rrCount === 0 && mmCount === 0 && <span>0 dokumentów</span>}
              </>
            )}
          </div>
        </div>

        {isError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3" role="alert">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Nie udało się załadować dokumentów'}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Spróbuj ponownie</Button>
          </div>
        )}

        {!isError && (
          <Card className="w-full shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <CardTitle className="text-xl sm:text-[1.5rem]">Lista dokumentów</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isFetching ? 'Ładowanie…' : `Znaleziono: ${filteredDocs.length}`}
                </p>
              </div>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters} className="shrink-0 text-sm font-medium text-primary hover:underline">
                  Wyczyść filtry
                </button>
              )}
            </CardHeader>
            <CardContent className="pt-6">
              {/* Sort */}
              <div className="mb-4 flex items-center gap-2">
                <span className="text-xs text-slate-500">Sortuj:</span>
                <button type="button" onClick={() => setSortBy('number')}
                  className={cn('rounded-lg px-2.5 py-1 text-xs font-medium', sortBy === 'number' ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100')}>
                  Numer ↓
                </button>
                <button type="button" onClick={() => setSortBy('date')}
                  className={cn('rounded-lg px-2.5 py-1 text-xs font-medium', sortBy === 'date' ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100')}>
                  Data ↓
                </button>
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
                <table className="min-w-full border-collapse text-sm" aria-label="Lista ruchów magazynowych">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white">
                      <th scope="col" className="w-8 px-2 py-3" />
                      <ColumnFilterTh label="Numer dokumentu" active={numberFilterActive} open={openColumn === 'number'} onToggle={() => toggleColumn('number')}>
                        <div className="space-y-2">
                          <FilterSearch label="Szukaj numeru" value={listNumberQuery} onChange={setListNumberQuery} placeholder="Zawiera…" autoFocus />
                          {numberFilterActive && <ClearFilterButton onClick={() => setListNumberQuery('')} />}
                        </div>
                      </ColumnFilterTh>
                      <ColumnFilterTh label="Typ" active={typeFilterActive} open={openColumn === 'type'} onToggle={() => toggleColumn('type')}>
                        <div className="space-y-2">
                          <CheckList options={DOC_TYPE_FILTER_OPTIONS} selected={listTypes}
                            onToggle={(v) => setListTypes((c) => toggleInSet(c, v))} emptyText="Brak typów" />
                          {typeFilterActive && <ClearFilterButton onClick={() => setListTypes(new Set())} />}
                        </div>
                      </ColumnFilterTh>
                      <th scope="col" className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Data wyst.</th>
                      <ColumnFilterTh label="Status" active={statusFilterActive} open={openColumn === 'status'} onToggle={() => toggleColumn('status')}>
                        <div className="space-y-2">
                          <CheckList options={deliveryStatusFilterOptions} selected={listStatuses}
                            onToggle={(v) => setListStatuses((c) => toggleInSet(c, v))} emptyText="Brak statusów" />
                          {statusFilterActive && <ClearFilterButton onClick={() => setListStatuses(new Set())} />}
                        </div>
                      </ColumnFilterTh>
                      <ColumnFilterTh label="Uwagi" active={notesFilterActive} open={openColumn === 'notes'} onToggle={() => toggleColumn('notes')} align="right">
                        <div className="space-y-2">
                          <FilterSearch label="Szukaj w uwagach" value={listNotesQuery} onChange={setListNotesQuery} placeholder="Zawiera…" autoFocus />
                          {notesFilterActive && <ClearFilterButton onClick={() => setListNotesQuery('')} />}
                        </div>
                      </ColumnFilterTh>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {pagedDocs.map((row) => <ExpandableMoveRow key={row.id} row={row} />)}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <ul className="divide-y divide-border md:hidden">
                {pagedDocs.map((row) => (
                  <li key={row.id} className="py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link to={`/delivery/${row.id}`} className="font-medium text-primary hover:underline">
                          {row.document_number ?? row.id.slice(0, 8)}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">{formatIssueDate(row.issue_date)}</p>
                        {row.notes?.trim() && <p className="mt-0.5 text-xs text-slate-500 truncate">{row.notes}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          row.document_type === 'RW' ? 'bg-red-100 text-red-800' : 'bg-purple-100 text-purple-800')}>
                          {DOC_TYPE_LABELS_PL[row.document_type] ?? row.document_type}
                        </span>
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', statusBadgeClass(row.status))}>
                          {DELIVERY_STATUS_LABELS_PL[row.status] ?? row.status}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {!isFetching && pagedDocs.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Brak dokumentów RW/MM dla wybranego okresu.
                </p>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
                  <span>Strona {listPage} z {totalPages}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={listPage <= 1} onClick={() => setListPage((p) => p - 1)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">
                      ← Poprzednia
                    </button>
                    <button type="button" disabled={listPage >= totalPages} onClick={() => setListPage((p) => p + 1)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">
                      Następna →
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

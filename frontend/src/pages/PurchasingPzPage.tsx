/**
 * PurchasingPzPage — list of PZ (goods receipt) documents.
 *
 * Route: /purchasing/pz
 * Module guard: purchasing
 *
 * Flow:
 *   Supplier delivers goods → create PZ (stock enters warehouse)
 *   Invoice arrives later (KSeF / FZ) → link it to this PZ
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { usePzListQuery, useLinkPzToDocumentMutation, useLinkInvoiceToPzMutation, useDeliveryQuery } from '@/query/use-delivery';
import { usePurchaseDocumentListQuery } from '@/query/use-purchase-documents';
import { useKsefInboxQuery, useKsefInboxParseQuery } from '@/query/use-invoices';
import type { ReceivedInvoiceMeta } from '@/services/ksef.service';
import { authStorage } from '@/services/api';
import { DELIVERY_STATUS_LABELS_PL } from '@/constants/deliveryStatusPl';
import { ReportExpandIcon, reportPresetClass } from '@/lib/reportSurface';
import { cn } from '@/lib/utils';
import type { DeliveryDocument, DeliveryDocumentStatus, DeliveryItem } from '@/types';
import { createPortal } from 'react-dom';

const PAGE_SIZE = 20;
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

function currentMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: todayIso() };
}

function thisWeekRange() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function prevMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function statusBadgeClass(status: DeliveryDocumentStatus): string {
  switch (status) {
    case 'draft':      return 'bg-slate-100 text-slate-600';
    case 'saved':      return 'bg-blue-100 text-blue-800';
    case 'in_transit': return 'bg-amber-100 text-amber-900';
    case 'delivered':  return 'bg-green-100 text-green-800';
    case 'cancelled':  return 'bg-red-100 text-red-800';
    default:           return 'bg-slate-100 text-slate-600';
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

// ── Link Invoice Modal ────────────────────────────────────────────────────────

function threeMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

const plCurrency = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2 });
function fmtPln(v: number | string | null | undefined) {
  const n = parseFloat(String(v ?? ''));
  return Number.isNaN(n) ? '—' : plCurrency.format(n);
}
function diffPct(a: number, b: number) {
  if (b === 0) return 0;
  return Math.abs((a - b) / b) * 100;
}

/** Expandable comparison panel for a single KSeF invoice vs PZ items */
function KsefCompareRow({
  inv,
  pzItems,
  onLink,
  busy,
}: {
  inv: ReceivedInvoiceMeta;
  pzItems: DeliveryItem[];
  onLink: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: parsed, isPending: parsing } = useKsefInboxParseQuery(inv.ksefNumber, open);

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          aria-label={open ? 'Zwiń' : 'Rozwiń pozycje'}
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
        >
          <svg className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">{inv.invoiceNumber}</p>
          <p className="text-xs text-slate-500">{inv.seller?.name || '—'} · {formatDate(inv.issueDate)} · {fmtPln(inv.grossAmount)}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onLink}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          Powiąż
        </button>
      </div>

      {/* Comparison table */}
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-3 pt-2">
          {parsing && <p className="py-3 text-center text-xs text-slate-400">Ładowanie pozycji…</p>}
          {!parsing && parsed && (
            <>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Porównanie pozycji</p>
              <div className="grid grid-cols-2 gap-4">
                {/* PZ side */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">PZ — przyjęto</p>
                  <div className="space-y-1">
                    {pzItems.length === 0 && <p className="text-xs text-slate-400 italic">Brak pozycji</p>}
                    {pzItems.map((item) => {
                      const qty = parseFloat(String(item.quantity_actual ?? item.quantity_planned)) || 0;
                      const cost = item.unit_cost != null ? parseFloat(String(item.unit_cost)) : null;
                      return (
                        <div key={item.id} className="rounded-md bg-white px-2.5 py-1.5 text-xs shadow-sm ring-1 ring-slate-100">
                          <p className="font-medium text-slate-800 truncate">{item.product_name || item.product_id.slice(0, 8)}</p>
                          <p className="text-slate-500">
                            {fmtQty(qty)} {item.product_unit || 'szt.'}
                            {cost !== null && <span className="ml-2">{fmtPln(cost)}/szt.</span>}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Invoice side */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">Faktura — naliczono</p>
                  <div className="space-y-1">
                    {parsed.lines.map((line, i) => {
                      // Find matching PZ item by product name similarity
                      const matchedPz = pzItems.find((p) =>
                        (p.product_name || '').toLocaleLowerCase('pl').includes(line.name.toLocaleLowerCase('pl').slice(0, 6)),
                      );
                      const pzQty = matchedPz ? parseFloat(String(matchedPz.quantity_actual ?? matchedPz.quantity_planned)) || 0 : null;
                      const pzCost = matchedPz?.unit_cost != null ? parseFloat(String(matchedPz.unit_cost)) : null;
                      const qtyDiff = pzQty !== null && diffPct(line.quantity, pzQty) > 2;
                      const priceDiff = pzCost !== null && diffPct(line.unit_net_price, pzCost) > 2;
                      return (
                        <div key={i} className={cn(
                          'rounded-md px-2.5 py-1.5 text-xs shadow-sm ring-1',
                          (qtyDiff || priceDiff) ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-100',
                        )}>
                          <p className="font-medium text-slate-800 truncate">{line.name}</p>
                          <p className={cn('text-slate-500', qtyDiff && 'text-amber-700 font-medium')}>
                            {fmtQty(line.quantity)} {line.unit}
                            {qtyDiff && <span className="ml-1 text-amber-600">⚠</span>}
                            <span className={cn('ml-2', priceDiff && 'text-amber-700 font-medium')}>
                              {fmtPln(line.unit_net_price)}/szt.
                              {priceDiff && <span className="ml-1 text-amber-600">⚠</span>}
                            </span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* Totals */}
              <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                <span className="text-slate-500">Suma netto faktury:</span>
                <span className="font-semibold text-slate-800">{fmtPln(inv.netAmount)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LinkInvoiceModal({
  pz,
  onClose,
  onLinked,
}: {
  pz: DeliveryDocument;
  onClose: () => void;
  onLinked: () => void;
}) {
  const linkFz = useLinkPzToDocumentMutation();
  const linkKsef = useLinkInvoiceToPzMutation();
  const [tab, setTab] = useState<'fz' | 'ksef'>('ksef');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fetch full PZ detail to get items with unit_cost
  const { data: pzDetail } = useDeliveryQuery(pz.id);
  const pzItems = pzDetail?.items ?? [];

  // FZ tab — unlinked purchase documents
  const { data: fzPage, isPending: fzPending } = usePurchaseDocumentListQuery(1, {
    doc_type: 'FZ',
    has_pz: false,
    ...(pz.from_supplier_id ? { supplier: pz.from_supplier_id } : {}),
  });
  const fzInvoices = fzPage?.results ?? [];

  // KSeF tab — last 3 months, filter client-side to those without active PZ
  const { data: ksefData, isPending: ksefPending } = useKsefInboxQuery(
    threeMonthsAgo(), todayIso(), 1, true,
  );
  const ksefInvoices = useMemo(() => {
    const all = ksefData?.invoices ?? [];
    return all.filter((inv) =>
      (inv.pzDocuments ?? []).filter((p) => p.status !== 'cancelled').length === 0,
    );
  }, [ksefData]);

  const filteredFz = useMemo(() => {
    const q = search.trim();
    if (!q) return fzInvoices;
    return fzInvoices.filter((inv) =>
      includesFold(inv.invoice_number || '', q) ||
      includesFold(inv.supplier_name || '', q),
    );
  }, [fzInvoices, search]);

  const filteredKsef = useMemo(() => {
    const q = search.trim();
    if (!q) return ksefInvoices;
    return ksefInvoices.filter((inv) =>
      includesFold(inv.invoiceNumber || '', q) ||
      includesFold(inv.seller?.name || '', q),
    );
  }, [ksefInvoices, search]);

  const isPending = tab === 'fz' ? fzPending : ksefPending;
  const isEmpty = tab === 'fz' ? filteredFz.length === 0 : filteredKsef.length === 0;

  const handleLinkFz = async (invoiceId: string) => {
    setError(null);
    try {
      await linkFz.mutateAsync({ invoiceId, pzId: pz.id });
      onLinked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się powiązać.');
    }
  };

  const handleLinkKsef = async (ksefInvoiceId: string) => {
    setError(null);
    try {
      await linkKsef.mutateAsync({ pzId: pz.id, ksefInvoiceId });
      onLinked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się powiązać.');
    }
  };

  const busy = linkFz.isPending || linkKsef.isPending;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Powiąż fakturę z PZ"
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-apple-md"
        style={{ maxHeight: 'min(92vh, 760px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Powiąż fakturę z PZ</p>
            <p className="text-xs text-slate-500">{pz.document_number} · {pz.supplier_name || '—'}</p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Zamknij">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-slate-100">
          {(['ksef', 'fz'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setSearch(''); setError(null); }}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                tab === t ? 'border-b-2 border-primary text-primary' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {t === 'ksef' ? 'Z KSeF' : 'Faktura FZ'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Szukaj po numerze lub dostawcy…"
              className="field-ios w-full pl-9"
            />
          </div>
        </div>

        {/* PZ items summary */}
        {pzItems.length > 0 && (
          <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-4 py-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">PZ — pozycje przyjęte</p>
            <div className="flex flex-wrap gap-2">
              {pzItems.map((item) => (
                <span key={item.id} className="rounded-md bg-white px-2 py-0.5 text-xs ring-1 ring-slate-200">
                  {item.product_name || '—'} · {fmtQty(parseFloat(String(item.quantity_actual ?? item.quantity_planned)))} {item.product_unit || 'szt.'}
                  {item.unit_cost != null && <span className="text-slate-400"> @ {fmtPln(item.unit_cost)}</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending && <p className="py-8 text-center text-sm text-slate-400">Ładowanie…</p>}
          {!isPending && isEmpty && (
            <p className="py-8 text-center text-sm text-slate-400">
              {tab === 'ksef'
                ? 'Brak faktur KSeF bez powiązanego PZ (ostatnie 3 miesiące).'
                : `Brak faktur FZ bez powiązanego PZ${pz.supplier_name ? ` od ${pz.supplier_name}` : ''}.`}
            </p>
          )}
          {!isPending && tab === 'fz' && filteredFz.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">{inv.invoice_number || inv.id.slice(0, 8)}</p>
                <p className="text-xs text-slate-500">{inv.supplier_name || '—'} · {formatDate(inv.issue_date)}{inv.total_gross != null && <span> · {fmtPln(inv.total_gross)}</span>}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => void handleLinkFz(inv.id)}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                Powiąż
              </button>
            </div>
          ))}
          {!isPending && tab === 'ksef' && filteredKsef.map((inv) => (
            <KsefCompareRow
              key={inv.id}
              inv={inv}
              pzItems={pzItems}
              onLink={() => void handleLinkKsef(inv.id)}
              busy={busy}
            />
          ))}
        </div>

        {error && <p className="shrink-0 px-4 pb-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}

// ── Expandable PZ row ─────────────────────────────────────────────────────────

function ExpandablePzRow({
  row,
  onLinkInvoice,
}: {
  row: DeliveryDocument;
  onLinkInvoice: (row: DeliveryDocument) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasItems = (row.items?.length ?? 0) > 0;
  const linkedDocs = row.linked_purchase_documents ?? [];
  const ksefRefs = row.ksef_invoice_refs ?? (row.ksef_invoice_ref ? [row.ksef_invoice_ref] : []);
  const hasInvoice = linkedDocs.length > 0 || ksefRefs.length > 0;

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
        {/* expand */}
        <td className="w-8 px-2 py-3">
          {hasItems && (
            <button type="button" aria-label={expanded ? 'Zwiń' : 'Rozwiń'} aria-expanded={expanded}
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <ReportExpandIcon open={expanded} />
            </button>
          )}
        </td>

        {/* number */}
        <td className="whitespace-nowrap px-3 py-3">
          <Link to={`/delivery/${row.id}`} className="text-sm font-semibold text-primary hover:underline">
            {row.document_number ?? row.id.slice(0, 8)}
          </Link>
          {row.external_document_number?.trim() && (
            <p className="mt-0.5 text-xs text-slate-400">{row.external_document_number}</p>
          )}
        </td>

        {/* date */}
        <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-500">{formatDate(row.issue_date)}</td>

        {/* supplier */}
        <td className="max-w-[200px] truncate px-3 py-3 text-sm text-slate-600" title={row.supplier_name ?? undefined}>
          {row.supplier_name?.trim() || '—'}
        </td>

        {/* status */}
        <td className="whitespace-nowrap px-3 py-3">
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', statusBadgeClass(row.status))}>
            {DELIVERY_STATUS_LABELS_PL[row.status] ?? row.status}
          </span>
        </td>

        {/* linked invoices */}
        <td className="px-3 py-3">
          {hasInvoice ? (
            <div className="flex flex-wrap gap-1">
              {ksefRefs.map((ref) => (
                <Link
                  key={ref.id}
                  to={`/purchase-documents?q=${encodeURIComponent(ref.invoice_number || ref.ksef_number)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium text-primary hover:underline"
                  title={`KSeF: ${ref.ksef_number}`}
                >
                  {ref.invoice_number || ref.ksef_number.slice(0, 12)}
                </Link>
              ))}
              {linkedDocs.map((pd) => (
                <Link
                  key={pd.id}
                  to={`/purchase-documents`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium text-primary hover:underline"
                  title={pd.invoice_number}
                >
                  {pd.invoice_number || pd.id.slice(0, 8)}
                </Link>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onLinkInvoice(row); }}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 hover:border-primary hover:text-primary"
            >
              + Powiąż fakturę
            </button>
          )}
        </td>
      </tr>

      {/* expanded items */}
      {expanded && hasItems && (
        <tr className="border-b border-slate-100 bg-slate-50/40">
          <td className="w-8 px-2" />
          <td colSpan={99} className="px-3 pb-3 pt-1">
            <div className="inline-grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-6 gap-y-1 text-sm">
              {row.items!.map((item) => (
                <Fragment key={item.id}>
                  <span className="truncate text-slate-600" title={productLabel(item)}>{productLabel(item)}</span>
                  <span className="tabular-nums text-slate-600 whitespace-nowrap">
                    {fmtQty(item.quantity_actual ?? item.quantity_planned)}{' '}
                    {item.product_unit?.trim() || 'szt.'}
                  </span>
                  <span className="tabular-nums text-slate-400 whitespace-nowrap">
                    {item.unit_cost != null ? `${fmtPln(item.unit_cost)}/szt.` : ''}
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

// ── Column filter helpers ─────────────────────────────────────────────────────

function FilterSearch({ label, value, onChange, placeholder, autoFocus = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean;
}) {
  return (
    <input type="search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} aria-label={label} className="field-ios-sm w-full" autoFocus={autoFocus} />
  );
}

function ClearFilterButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="text-xs font-medium text-primary hover:underline">Wyczyść</button>;
}

type ListColumn = 'number' | 'supplier' | 'status' | 'invoice';

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

// ── Page ──────────────────────────────────────────────────────────────────────

export function PurchasingPzPage() {
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: '/purchasing/pz' }} />;
  }
  return <PurchasingPzPageContent />;
}

function PurchasingPzPageContent() {
  const canPurchasing = usePermission('can_manage_purchasing');
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultFrom = currentMonthRange().from;
  const defaultTo = currentMonthRange().to;
  const dateFrom = searchParams.get('from') ?? defaultFrom;
  const dateTo = searchParams.get('to') ?? defaultTo;
  const setDateFrom = (v: string) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('from', v); return n; }, { replace: true });
  const setDateTo = (v: string) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('to', v); return n; }, { replace: true });
  const sortBy = (searchParams.get('sort') as 'number' | 'date' | null) ?? 'number';
  const setSortBy = (s: 'number' | 'date') => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('sort', s); return n; }, { replace: true });

  const [listNumberQuery, setListNumberQuery] = useState('');
  const [listSupplierQuery, setListSupplierQuery] = useState('');
  const [listStatuses, setListStatuses] = useState<Set<DeliveryDocumentStatus>>(() => new Set());
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [openColumn, setOpenColumn] = useState<ListColumn | null>(null);
  const [listPage, setListPage] = useState(1);
  const [linkModalPz, setLinkModalPz] = useState<DeliveryDocument | null>(null);

  const { data: pzDocs = [], isFetching, isError, error, refetch } = usePzListQuery(dateFrom, dateTo);

  const sorted = useMemo(
    () => [...pzDocs].sort(sortBy === 'date' ? compareNewestDateFirst : compareNewestNumberFirst),
    [pzDocs, sortBy],
  );

  const STATUS_OPTIONS: { value: DeliveryDocumentStatus; label: string }[] = [
    { value: 'draft', label: 'Szkic' },
    { value: 'saved', label: 'Zapisany' },
    { value: 'delivered', label: 'Dostarczono' },
    { value: 'cancelled', label: 'Anulowany' },
  ];

  const filtered = useMemo(() => {
    const numQ = listNumberQuery.trim();
    const supQ = listSupplierQuery.trim();
    return sorted.filter((doc) => {
      if (numQ && !includesFold(doc.document_number?.trim() || '', numQ)) return false;
      if (supQ && !includesFold(doc.supplier_name?.trim() || '', supQ)) return false;
      if (listStatuses.size > 0 && !listStatuses.has(doc.status)) return false;
      const docHasInvoice =
        (doc.linked_purchase_documents ?? []).length > 0 ||
        (doc.ksef_invoice_refs ?? (doc.ksef_invoice_ref ? [doc.ksef_invoice_ref] : [])).length > 0;
      if (invoiceFilter === 'linked' && !docHasInvoice) return false;
      if (invoiceFilter === 'unlinked' && docHasInvoice) return false;
      return true;
    });
  }, [sorted, listNumberQuery, listSupplierQuery, listStatuses, invoiceFilter]);

  useEffect(() => { setListPage(1); }, [listNumberQuery, listSupplierQuery, listStatuses, invoiceFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!openColumn) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-column-filter]')) return;
      setOpenColumn(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenColumn(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [openColumn]);

  const toggleColumn = (col: ListColumn) => setOpenColumn((c) => (c === col ? null : col));

  const numberFilterActive = listNumberQuery.trim().length > 0;
  const supplierFilterActive = listSupplierQuery.trim().length > 0;
  const statusFilterActive = listStatuses.size > 0;
  const invoiceFilterActive = invoiceFilter !== 'all';
  const activeFilterCount = [numberFilterActive, supplierFilterActive, statusFilterActive, invoiceFilterActive].filter(Boolean).length;
  const clearFilters = () => { setListNumberQuery(''); setListSupplierQuery(''); setListStatuses(new Set()); setInvoiceFilter('all'); };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((listPage - 1) * PAGE_SIZE, listPage * PAGE_SIZE);

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

  const unlinkedCount = pzDocs.filter((d) =>
    (d.linked_purchase_documents ?? []).length === 0 &&
    (d.ksef_invoice_refs ?? (d.ksef_invoice_ref ? [d.ksef_invoice_ref] : [])).length === 0,
  ).length;

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto w-full max-w-6xl space-y-3">

        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Przyjęcia (PZ)</h1>
            {unlinkedCount > 0 && !isFetching && (
              <p className="mt-0.5 text-xs text-amber-600">
                {unlinkedCount} {unlinkedCount === 1 ? 'PZ bez faktury' : 'PZ bez faktury'} w tym okresie
              </p>
            )}
          </div>
          {canPurchasing && (
            <Link to="/delivery/new-pz" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto">+ Nowe PZ</Button>
            </Link>
          )}
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
            aria-label="Data od" className="date-pill border-[#D4D2EE] bg-white font-normal text-slate-900 focus:border-primary focus:bg-white" />
          <span className="text-slate-400">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            aria-label="Data do" className="date-pill border-[#D4D2EE] bg-white font-normal text-slate-900 focus:border-primary focus:bg-white" />
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            {isFetching
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
              : <span>{pzDocs.length} PZ</span>}
          </div>
        </div>

        {isError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3" role="alert">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Nie udało się załadować dokumentów'}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Spróbuj ponownie</Button>
          </div>
        )}

        {/* Quick invoice filter */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 md:rounded-3xl">
          {(['all', 'unlinked', 'linked'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setInvoiceFilter(v)}
              aria-pressed={invoiceFilter === v}
              className={cn(reportPresetClass, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                invoiceFilter === v
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
              {v === 'all' ? 'Wszystkie' : v === 'unlinked' ? 'Bez faktury' : 'Z fakturą'}
            </button>
          ))}
        </div>

        {!isError && (
          <Card className="w-full shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <CardTitle className="text-xl sm:text-[1.5rem]">Lista przyjęć</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isFetching ? 'Ładowanie…' : `Znaleziono: ${filtered.length}`}
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
                {(['number', 'date'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSortBy(s)}
                    className={cn('rounded-lg px-2.5 py-1 text-xs font-medium', sortBy === s ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100')}>
                    {s === 'number' ? 'Numer ↓' : 'Data ↓'}
                  </button>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
                <table className="min-w-full border-collapse text-sm" aria-label="Lista przyjęć PZ">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white">
                      <th scope="col" className="w-8 px-2 py-3" />
                      <ColumnFilterTh label="Numer dokumentu" active={numberFilterActive} open={openColumn === 'number'} onToggle={() => toggleColumn('number')}>
                        <div className="space-y-2">
                          <FilterSearch label="Szukaj numeru" value={listNumberQuery} onChange={setListNumberQuery} placeholder="Zawiera…" autoFocus />
                          {numberFilterActive && <ClearFilterButton onClick={() => setListNumberQuery('')} />}
                        </div>
                      </ColumnFilterTh>
                      <th scope="col" className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Data wyst.</th>
                      <ColumnFilterTh label="Dostawca" active={supplierFilterActive} open={openColumn === 'supplier'} onToggle={() => toggleColumn('supplier')}>
                        <div className="space-y-2">
                          <FilterSearch label="Szukaj dostawcy" value={listSupplierQuery} onChange={setListSupplierQuery} placeholder="Wpisz fragment nazwy" autoFocus />
                          {supplierFilterActive && <ClearFilterButton onClick={() => setListSupplierQuery('')} />}
                        </div>
                      </ColumnFilterTh>
                      <ColumnFilterTh label="Status" active={statusFilterActive} open={openColumn === 'status'} onToggle={() => toggleColumn('status')}>
                        <div className="space-y-2">
                          <ul className="max-h-52 space-y-0.5 overflow-y-auto">
                            {STATUS_OPTIONS.map((o) => (
                              <li key={o.value}>
                                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary"
                                    checked={listStatuses.has(o.value)}
                                    onChange={() => setListStatuses((c) => toggleInSet(c, o.value))} />
                                  <span>{o.label}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                          {statusFilterActive && <ClearFilterButton onClick={() => setListStatuses(new Set())} />}
                        </div>
                      </ColumnFilterTh>
                      <ColumnFilterTh label="Faktura" active={invoiceFilterActive} open={openColumn === 'invoice'} onToggle={() => toggleColumn('invoice')} align="right">
                        <div className="space-y-1">
                          {(['all', 'unlinked', 'linked'] as const).map((v) => (
                            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                              <input type="radio" name="invoice-filter" className="h-4 w-4 accent-primary"
                                checked={invoiceFilter === v} onChange={() => setInvoiceFilter(v)} />
                              <span>{v === 'all' ? 'Wszystkie' : v === 'unlinked' ? 'Bez faktury' : 'Z fakturą'}</span>
                            </label>
                          ))}
                          {invoiceFilterActive && <ClearFilterButton onClick={() => setInvoiceFilter('all')} />}
                        </div>
                      </ColumnFilterTh>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {paged.map((row) => (
                      <ExpandablePzRow key={row.id} row={row} onLinkInvoice={setLinkModalPz} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <ul className="divide-y divide-border md:hidden">
                {paged.map((row) => {
                  const linkedDocs = row.linked_purchase_documents ?? [];
                  return (
                    <li key={row.id} className="py-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link to={`/delivery/${row.id}`} className="font-medium text-primary hover:underline">
                            {row.document_number ?? row.id.slice(0, 8)}
                          </Link>
                          <p className="mt-0.5 text-xs text-slate-500">{formatDate(row.issue_date)} · {row.supplier_name || '—'}</p>
                          {linkedDocs.length > 0 ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {linkedDocs.map((pd) => pd.invoice_number || pd.id.slice(0, 8)).join(', ')}
                            </p>
                          ) : (
                            <button type="button" onClick={() => setLinkModalPz(row)}
                              className="mt-1 text-xs font-medium text-amber-600 hover:underline">
                              + Powiąż fakturę
                            </button>
                          )}
                        </div>
                        <span className={cn('shrink-0 inline-block rounded-full px-2 py-0.5 text-xs font-medium', statusBadgeClass(row.status))}>
                          {DELIVERY_STATUS_LABELS_PL[row.status] ?? row.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {!isFetching && paged.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">Brak dokumentów PZ dla wybranego okresu.</p>
              )}

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
                  <span>Strona {listPage} z {totalPages}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={listPage <= 1} onClick={() => setListPage((p) => p - 1)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">← Poprzednia</button>
                    <button type="button" disabled={listPage >= totalPages} onClick={() => setListPage((p) => p + 1)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">Następna →</button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {linkModalPz && (
        <LinkInvoiceModal
          pz={linkModalPz}
          onClose={() => setLinkModalPz(null)}
          onLinked={() => setLinkModalPz(null)}
        />
      )}
    </div>
  );
}

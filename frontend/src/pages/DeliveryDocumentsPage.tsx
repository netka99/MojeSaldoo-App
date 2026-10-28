import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery } from '@/query/use-companies';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useDeliveryByRangeQuery,
  type DeliveryListFilters,
} from '@/query/use-delivery';
import { authStorage } from '@/services/api';
import { deliveryService } from '@/services/delivery.service';
import { DELIVERY_STATUS_LABELS_PL, deliveryStatusFilterOptions } from '@/constants/deliveryStatusPl';
import { openMultiWZPrintWindow } from '@/lib/openMultiWZPrintWindow';
import { ReportExpandIcon } from '@/lib/reportSurface';
import { cn } from '@/lib/utils';
import type { DeliveryDocument, DeliveryDocumentStatus, DeliveryDocumentType, DeliveryItem, UserPermissions } from '@/types';
import { createPortal } from 'react-dom';

const PAGE_SIZE = 20;

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function queryErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Nie udało się załadować dokumentów';
}

/** Highest document number first (WZ/2026/0009 before 0001). */
function compareDeliveryDocumentsNewestNumberFirst(a: DeliveryDocument, b: DeliveryDocument): number {
  const na = a.document_number?.trim() ?? '';
  const nb = b.document_number?.trim() ?? '';
  if (na && nb) return nb.localeCompare(na, 'pl', { numeric: true });
  if (na) return -1;
  if (nb) return 1;
  return (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

/** Newest issue date first; tiebreak by document number descending. */
function compareDeliveryDocumentsNewestDateFirst(a: DeliveryDocument, b: DeliveryDocument): number {
  const da = a.issue_date ?? '';
  const db = b.issue_date ?? '';
  if (da !== db) return db.localeCompare(da);
  // tiebreak by number
  const na = a.document_number?.trim() ?? '';
  const nb = b.document_number?.trim() ?? '';
  return nb.localeCompare(na, 'pl', { numeric: true });
}

/** Returns a context-aware Polish label for the status, accounting for document type. */
export function deliveryStatusLabel(status: DeliveryDocumentStatus, documentType?: DeliveryDocumentType): string {
  // WZ-KOR/PZ-KOR with "delivered" status means the correction was applied — show "Skorygowano"
  if (status === 'delivered' && (documentType === 'WZ-KOR' || documentType === 'PZ-KOR')) {
    return 'Skorygowano';
  }
  return DELIVERY_STATUS_LABELS_PL[status] ?? status;
}

export function deliveryStatusBadgeClassName(status: DeliveryDocumentStatus, documentType?: DeliveryDocumentType): string {
  if (status === 'delivered' && (documentType === 'WZ-KOR' || documentType === 'PZ-KOR')) {
    return 'bg-purple-100 text-purple-800';
  }
  switch (status) {
    case 'draft':      return 'bg-surface-container text-on-surface';
    case 'saved':      return 'bg-blue-100 text-blue-800';
    case 'in_transit': return 'bg-amber-100 text-amber-900';
    case 'delivered':  return 'bg-green-100 text-green-800';
    case 'cancelled':  return 'bg-red-100 text-red-800';
    case 'corrected':  return 'bg-purple-100 text-purple-800';
    default:           return 'bg-surface-container text-on-surface';
  }
}

const DOC_TYPE_LABELS_PL: Record<DeliveryDocumentType, string> = {
  WZ: 'WZ',
  MM: 'MM',
  PZ: 'PZ',
  ZW: 'ZW',
  RW: 'RW',
  'PZ-KOR': 'PZ-KOR',
  'WZ-KOR': 'WZ-KOR',
};

const DOC_TYPE_PERMISSION: Partial<Record<DeliveryDocumentType, keyof UserPermissions>> = {
  WZ: 'can_manage_delivery',
  ZW: 'can_manage_delivery',
  'WZ-KOR': 'can_manage_delivery',
  PZ: 'can_manage_purchasing',
  'PZ-KOR': 'can_manage_purchasing',
  RW: 'can_manage_stock_moves',
  MM: 'can_manage_stock_moves',
};

/** Kept for backwards compatibility — filters are now applied client-side in the Lista tab. */
export function buildDeliveryListFilters(
  status: '' | DeliveryDocumentStatus,
  dateFrom: string,
  dateTo: string,
  documentType: '' | DeliveryDocumentType = '',
): DeliveryListFilters {
  const filters: DeliveryListFilters = {};
  if (documentType) filters.document_type = documentType;
  if (status) filters.status = status;
  if (dateFrom) filters.issue_date_after = dateFrom;
  if (dateTo) filters.issue_date_before = dateTo;
  return filters;
}

type ViewMode = 'list' | 'by-shop';

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex w-fit gap-1 rounded-xl border-2 border-border bg-muted-foreground/15 p-1" role="group" aria-label="Tryb widoku">
      {(['by-shop', 'list'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            mode === m ? 'bg-white text-primary shadow-sm font-semibold' : 'text-foreground/70 font-medium hover:text-foreground',
          )}
        >
          {m === 'list' ? 'Lista' : 'Wg sklepu'}
        </button>
      ))}
    </div>
  );
}

function fmtQty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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

function currentMonthRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: todayIso() };
}

function prevMonthRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function productLabel(item: DeliveryItem): string {
  return item.product_name?.trim() || item.product_id.slice(0, 8);
}

type ProductSummaryRow = { name: string; delivered: number; returned: number };

function buildProductSummary(wzDocs: DeliveryDocument[], zwDocs: DeliveryDocument[]): ProductSummaryRow[] {
  const map = new Map<string, ProductSummaryRow>();
  for (const doc of wzDocs) {
    for (const item of doc.items) {
      const qty =
        parseFloat(
          String(
            item.quantity_actual !== null && item.quantity_actual !== undefined && item.quantity_actual !== ''
              ? item.quantity_actual
              : item.quantity_planned,
          ),
        ) || 0;
      const existing = map.get(item.product_id);
      if (existing) existing.delivered += qty;
      else map.set(item.product_id, { name: productLabel(item), delivered: qty, returned: 0 });
    }
  }
  for (const doc of zwDocs) {
    for (const item of doc.items) {
      const qty = parseFloat(String(item.quantity_planned)) || 0;
      const existing = map.get(item.product_id);
      if (existing) existing.returned += qty;
      else map.set(item.product_id, { name: productLabel(item), delivered: 0, returned: qty });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }));
}

function sumByUnit(docs: DeliveryDocument[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const doc of docs) {
    for (const item of doc.items) {
      const qty = parseFloat(String(
        item.quantity_actual !== null && item.quantity_actual !== undefined && item.quantity_actual !== ''
          ? item.quantity_actual
          : item.quantity_planned,
      )) || 0;
      const unit = (item as DeliveryItem & { unit?: string }).unit?.trim() || 'szt.';
      map.set(unit, (map.get(unit) ?? 0) + qty);
    }
  }
  return map;
}

function DocumentItemGrid({
  items,
  quantityOf,
  quantityClassName,
}: {
  items: DeliveryItem[];
  quantityOf: (item: DeliveryItem) => string | number;
  quantityClassName?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      {items.map((item) => (
        <span key={item.id} className="inline-flex max-w-full items-baseline gap-2 text-sm">
          <span className="truncate">{productLabel(item)}</span>
          <span className={cn('shrink-0 font-semibold tabular-nums', quantityClassName)}>
            {fmtQty(quantityOf(item))} szt.
          </span>
        </span>
      ))}
    </div>
  );
}

function ShopDeliveryCard({
  customerName,
  wzDocs,
  zwDocs,
  showDates,
  printMode,
  printSelectedIds,
  onTogglePrintId,
}: {
  customerName: string;
  wzDocs: DeliveryDocument[];
  zwDocs: DeliveryDocument[];
  showDates?: boolean;
  printMode: boolean;
  printSelectedIds: Set<string>;
  onTogglePrintId: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const summary = buildProductSummary(wzDocs, zwDocs);

  const wzTotals = sumByUnit(wzDocs);
  const zwTotals = sumByUnit(zwDocs);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-stretch">
        {printMode && wzDocs.length > 0 && (
          <label
            className="flex cursor-pointer items-center px-4"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Zaznacz wszystkie WZ dla ${customerName}`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-primary"
              checked={wzDocs.every((d) => printSelectedIds.has(d.id))}
              onChange={() => {
                const allSelected = wzDocs.every((d) => printSelectedIds.has(d.id));
                wzDocs.forEach((d) => {
                  if (allSelected ? printSelectedIds.has(d.id) : !printSelectedIds.has(d.id)) {
                    onTogglePrintId(d.id);
                  }
                });
              }}
            />
          </label>
        )}
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center justify-between gap-3 px-4 py-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden>
              {customerName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{customerName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-y-1 divide-x divide-border">
                <div className="flex items-center gap-1.5 pr-5">
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{wzDocs.length} WZ</span>
                  {wzTotals.size > 0 && (
                    <span className="text-[11px] font-semibold text-foreground">
                      {[...wzTotals.entries()].map(([unit, qty]) => `${fmtQty(qty)} ${unit}`).join(' · ')}
                    </span>
                  )}
                </div>
                {zwDocs.length > 0 && (
                  <div className="flex items-center gap-1.5 pl-5">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">{zwDocs.length} ZW</span>
                    {zwTotals.size > 0 && (
                      <span className="text-[11px] font-semibold text-destructive">
                        −{[...zwTotals.entries()].map(([unit, qty]) => `${fmtQty(qty)} ${unit}`).join(' · ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <svg className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s ease' }}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border">
            <div className="divide-y divide-border/60 px-4 py-2">
              {wzDocs.map((doc) => {
                const qty = (item: DeliveryItem) =>
                  item.quantity_actual !== null && item.quantity_actual !== undefined && item.quantity_actual !== ''
                    ? item.quantity_actual
                    : item.quantity_planned;
                const meta: string[] = [];
                if (showDates) meta.push(formatIssueDate(doc.issue_date));
                if (doc.driver_name?.trim()) meta.push(`Kurier: ${doc.driver_name}`);
                return (
                  <div key={doc.id} className="relative bg-blue-50/50 py-2 pl-4">
                    <div className="absolute bottom-2 left-0 top-2 w-1 rounded-full bg-primary" />
                    <div className="pr-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        {printMode && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded accent-primary"
                            checked={printSelectedIds.has(doc.id)}
                            onChange={() => onTogglePrintId(doc.id)}
                            aria-label={`Zaznacz ${doc.document_number || doc.id.slice(0, 8)}`}
                          />
                        )}
                        <Link to={`/delivery/${doc.id}`} className="text-sm font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {doc.document_number?.trim() || `WZ ${doc.id.slice(0, 8)}`}
                        </Link>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', deliveryStatusBadgeClassName(doc.status))}>
                          {DELIVERY_STATUS_LABELS_PL[doc.status]}
                        </span>
                        {meta.length > 0 && <span className="text-xs text-muted-foreground">{meta.join(' • ')}</span>}
                      </div>
                      <DocumentItemGrid items={doc.items} quantityOf={qty} />
                    </div>
                  </div>
                );
              })}

              {zwDocs.length > 0 && (
                <div className="mt-2 space-y-2 border-y-2 border-border bg-muted/50 px-4 py-2 -mx-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Zwroty (ZW)</p>
                  {zwDocs.map((doc) => {
                    const meta: string[] = [];
                    if (showDates) meta.push(formatIssueDate(doc.issue_date));
                    if (doc.returns_notes?.trim()) meta.push(`Przyczyna: ${doc.returns_notes}`);
                    return (
                      <div key={doc.id} className="relative bg-amber-50/50 py-2 pl-4">
                        <div className="absolute bottom-2 left-0 top-2 w-1 rounded-full bg-amber-500" />
                        <div className="pr-1">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <Link to={`/delivery/${doc.id}`} className="text-sm font-semibold text-amber-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                              {doc.document_number?.trim() || `ZW ${doc.id.slice(0, 8)}`}
                            </Link>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                              {DELIVERY_STATUS_LABELS_PL[doc.status]}
                            </span>
                            {meta.length > 0 && <span className="text-xs text-muted-foreground">{meta.join(' • ')}</span>}
                          </div>
                          <DocumentItemGrid
                            items={doc.items}
                            quantityOf={(item) => item.quantity_planned}
                            quantityClassName="text-destructive"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {summary.length > 0 && (
            <div className="border-t-2 border-border bg-muted/50 px-4 py-3">
              <button
                type="button"
                className="flex items-center gap-2 text-left"
                onClick={(e) => { e.stopPropagation(); setSummaryOpen((v) => !v); }}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Podsumowanie</span>
                <span className="text-xs text-muted-foreground">Saldo: {summary.length} pozycji</span>
                <svg className={cn('h-4 w-4 text-muted-foreground transition-transform', summaryOpen && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <div style={{ display: 'grid', gridTemplateRows: summaryOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.2s ease' }}>
                <div className="min-h-0 overflow-hidden">
                  <table className="mt-3 w-auto text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 pr-6 font-medium">Produkt</th>
                        <th className="px-3 py-1.5 text-right font-medium">WZ (Dostawa)</th>
                        <th className="px-3 py-1.5 text-right font-medium">ZW (Zwrot)</th>
                        <th className="py-1.5 pl-3 text-right font-medium text-primary">Saldo końcowe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row) => {
                        const net = row.delivered - row.returned;
                        return (
                          <tr key={row.name} className="border-t border-border/60">
                            <td className="py-1.5 pr-6">{row.name}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(row.delivered)}</td>
                            <td className={cn('px-3 py-1.5 text-right tabular-nums', row.returned > 0 && 'text-destructive')}>
                              {row.returned > 0 ? `−${fmtQty(row.returned)}` : '0'}
                            </td>
                            <td className="py-1.5 pl-3 text-right font-bold tabular-nums text-primary">{fmtQty(net)} szt.</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ByShopView no longer fetches — it receives docs from the shared parent query.
function ByShopView({
  docs,
  isRange,
  printMode,
  printSelectedIds,
  onTogglePrintId,
}: {
  docs: DeliveryDocument[];
  isRange: boolean;
  printMode: boolean;
  printSelectedIds: Set<string>;
  onTogglePrintId: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const wzAndZw = docs.filter((d) => d.document_type === 'WZ' || d.document_type === 'ZW');
    const wzCustomerMap = new Map<string, { id: string; name: string }>();
    const nameToKeyMap = new Map<string, string>();

    for (const d of wzAndZw) {
      if (d.document_type === 'WZ') {
        const id = d.to_customer_id ?? d.customer_name ?? d.id;
        wzCustomerMap.set(d.id, { id, name: d.customer_name || '—' });
        if (d.customer_name) nameToKeyMap.set(d.customer_name, id);
      }
    }

    const map = new Map<string, { customerName: string; wzDocs: DeliveryDocument[]; zwDocs: DeliveryDocument[] }>();

    for (const doc of wzAndZw) {
      let key: string;
      let customerName: string;
      if (doc.document_type === 'WZ') {
        key = doc.to_customer_id ?? doc.customer_name ?? doc.id;
        customerName = doc.customer_name || '—';
      } else {
        const parent = doc.linked_wz_id ? wzCustomerMap.get(doc.linked_wz_id) : undefined;
        const nameKey = doc.customer_name ? nameToKeyMap.get(doc.customer_name) : undefined;
        key = parent?.id ?? nameKey ?? doc.to_customer_id ?? doc.customer_name ?? doc.id;
        customerName = doc.customer_name || parent?.name || '—';
      }
      if (!map.has(key)) map.set(key, { customerName, wzDocs: [], zwDocs: [] });
      const group = map.get(key)!;
      if (doc.document_type === 'WZ') group.wzDocs.push(doc);
      else group.zwDocs.push(doc);
    }

    return [...map.values()].sort((a, b) => a.customerName.localeCompare(b.customerName, 'pl', { sensitivity: 'base' }));
  }, [docs]);

  if (groups.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Brak dokumentów WZ/ZW dla wybranego okresu.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <ShopDeliveryCard
          key={group.customerName}
          customerName={group.customerName}
          wzDocs={group.wzDocs}
          zwDocs={group.zwDocs}
          showDates={isRange}
          printMode={printMode}
          printSelectedIds={printSelectedIds}
          onTogglePrintId={onTogglePrintId}
        />
      ))}
    </div>
  );
}

/* ── Quick Return Modal ──────────────────────────────────────────────── */

type QuickReturnState = {
  wzId: string;
  wzNumber: string;
  wzDate: string;
  items: DeliveryItem[];
};

function QuickReturnModal({ wz, onClose, onSaved }: { wz: QuickReturnState; onClose: () => void; onSaved: () => void }) {
  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(wz.items.map((i) => [i.product_id ?? i.id, ''])),
  );
  const [returnDate, setReturnDate] = useState(() => todayIso());
  const wzDateDiffers = wz.wzDate && wz.wzDate !== todayIso();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjustQty = (pid: string, delta: number, max: number) => {
    setQtys((prev) => {
      const cur = parseFloat(prev[pid] ?? '0') || 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...prev, [pid]: String(next) };
    });
  };

  const handleSave = async () => {
    const returnItems = wz.items
      .map((i) => ({ product_id: i.product_id ?? i.id, quantity: qtys[i.product_id ?? i.id] ?? '', return_reason: '' }))
      .filter((r) => parseFloat(r.quantity) > 0);
    if (returnItems.length === 0) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      await deliveryService.addReturns(wz.wzId, returnItems, returnDate);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać zwrotu.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={(e) => { if (!saving && e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Zwrot z ${wz.wzNumber}`}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-apple-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Zwrot towaru</p>
            <p className="text-xs text-slate-500">{wz.wzNumber}</p>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Zamknij">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Date row */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
          <label htmlFor="return-date" className="text-sm font-medium text-slate-700">Data zwrotu</label>
          <div className="flex items-center gap-2">
            {wzDateDiffers && (
              <button
                type="button"
                onClick={() => setReturnDate(wz.wzDate)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                  returnDate === wz.wzDate
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-slate-300 bg-slate-50 text-slate-500 hover:border-primary/50 hover:text-primary',
                )}
                aria-label={`Ustaw datę WZ: ${wz.wzDate}`}
              >
                Data WZ: {formatIssueDate(wz.wzDate)}
              </button>
            )}
            <input
              id="return-date"
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="date-pill"
              aria-label="Data zwrotu"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {wz.items.map((item) => {
            const pid = item.product_id ?? item.id;
            const deliveredQty = item.quantity_actual !== null && item.quantity_actual !== undefined && item.quantity_actual !== ''
              ? item.quantity_actual
              : item.quantity_planned;
            const max = parseFloat(String(deliveredQty)) || 0;
            const cur = parseFloat(qtys[pid] ?? '0') || 0;
            const unit = item.product_unit?.trim() || 'szt.';
            return (
              <div key={pid} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-800">{item.product_name}</p>
                  <span className="text-xs text-slate-400">max {fmtQty(max)} {unit}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustQty(pid, -1, max)}
                    disabled={cur <= 0}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-30"
                    aria-label="Zmniejsz"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M5 12h14" strokeLinecap="round" /></svg>
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={qtys[pid] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '');
                      setQtys((prev) => ({ ...prev, [pid]: v }));
                    }}
                    className="field-ios-sm flex-1 text-center"
                    aria-label={`Zwrot: ${item.product_name}`}
                  />
                  <button
                    type="button"
                    onClick={() => adjustQty(pid, 1, max)}
                    disabled={cur >= max}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-30"
                    aria-label="Zwiększ"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-2xl border border-primary/50 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-50">
            Anuluj
          </button>
          <button type="button" disabled={saving} onClick={handleSave} className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Zapisuję…' : 'Zapisz zwrot'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type ListColumn = 'number' | 'type' | 'customer' | 'driver' | 'status' | 'order';

const DOC_TYPE_FILTER_OPTIONS: { value: DeliveryDocumentType; label: string }[] = [
  { value: 'WZ', label: 'WZ — Wydanie zewnętrzne' },
  { value: 'ZW', label: 'ZW — Zwrot zewnętrzny' },
  { value: 'MM', label: 'MM — Przesunięcie międzymagazynowe' },
  { value: 'PZ', label: 'PZ — Przyjęcie zewnętrzne' },
  { value: 'RW', label: 'RW — Rozchód wewnętrzny' },
  { value: 'WZ-KOR', label: 'WZ-KOR — Korekta wydania' },
  { value: 'PZ-KOR', label: 'PZ-KOR — Korekta przyjęcia' },
];

function toggleInSet<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function includesFold(haystack: string, needle: string): boolean {
  const query = needle.trim().toLocaleLowerCase('pl');
  if (!query) return true;
  return haystack.toLocaleLowerCase('pl').includes(query);
}

function partyLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '—';
}

function visibleNameOptions(all: string[], query: string, selected: Set<string>): string[] {
  const matched = query.trim() ? all.filter((name) => includesFold(name, query)) : all;
  const pinned = [...selected].filter((name) => !matched.includes(name));
  return [...pinned, ...matched];
}

function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="field-ios-sm w-full"
      autoFocus={autoFocus}
    />
  );
}

function CheckList<T extends string>({
  options,
  selected,
  onToggle,
  emptyText,
}: {
  options: { value: T; label: string }[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  emptyText: string;
}) {
  if (options.length === 0) {
    return <p className="px-1 py-2 text-xs text-slate-500">{emptyText}</p>;
  }
  return (
    <ul className="max-h-52 space-y-0.5 overflow-y-auto">
      {options.map((option) => (
        <li key={option.value}>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-primary"
              checked={selected.has(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span className="min-w-0 truncate">{option.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function ClearFilterButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-medium text-primary hover:underline">
      Wyczyść
    </button>
  );
}

function ColumnFilterTh({
  label,
  active,
  open,
  onToggle,
  align = 'left',
  children,
}: {
  label: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  align?: 'left' | 'right';
  children: ReactNode;
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
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  return (
    <th scope="col" className="whitespace-nowrap px-3 py-3 text-left">
      <div data-column-filter="">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={active ? `${label}, filtr włączony` : undefined}
          onClick={onToggle}
          className={cn(
            'flex items-center gap-1 text-xs font-semibold uppercase tracking-wide',
            active || open ? 'text-primary' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {label}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
          <svg className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && pos && createPortal(
          <div
            data-column-filter=""
            role="dialog"
            aria-label={`Filtr: ${label}`}
            className="fixed z-40 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-apple-md"
            style={{ top: pos.top, left: pos.left }}
          >
            {children}
          </div>,
          document.body,
        )}
      </div>
    </th>
  );
}

function itemQuantityNode(item: DeliveryItem) {
  const planned = parseFloat(String(item.quantity_planned)) || 0;
  const actualRaw = item.quantity_actual;
  const actual = actualRaw != null && actualRaw !== '' ? parseFloat(String(actualRaw)) : null;
  const unit = item.product_unit?.trim() || 'szt.';
  if (actual != null && !Number.isNaN(actual) && actual !== planned) {
    return (
      <>
        <span>{fmtQty(actual)}</span>
        <span className="font-normal text-slate-500"> / {fmtQty(planned)} {unit}</span>
      </>
    );
  }
  return <>{fmtQty(planned)} {unit}</>;
}

function ExpandableDocRow({
  row,
  printMode,
  printSelectedIds,
  togglePrintId,
  wzQuickReturns,
  onQuickReturn,
  showDriver,
}: {
  row: DeliveryDocument;
  printMode: boolean;
  printSelectedIds: Set<string>;
  togglePrintId: (id: string) => void;
  wzQuickReturns: boolean;
  onQuickReturn: (row: DeliveryDocument) => void;
  showDriver?: boolean;
}) {
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
            <button
              type="button"
              aria-label={expanded ? 'Zwiń pozycje' : 'Rozwiń pozycje'}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <ReportExpandIcon open={expanded} />
            </button>
          )}
        </td>
        {printMode && (
          <td className="px-3 py-3">
            {row.document_type === 'WZ' && (
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-primary"
                checked={printSelectedIds.has(row.id)}
                onChange={() => togglePrintId(row.id)}
                aria-label={`Zaznacz ${row.document_number ?? row.id.slice(0, 8)}`}
              />
            )}
          </td>
        )}
        <td className="whitespace-nowrap px-3 py-3">
          <Link to={`/delivery/${row.id}`} className="text-sm font-semibold text-primary hover:underline">
            {row.document_number ?? row.id.slice(0, 8)}
          </Link>
          {row.document_type === 'WZ-KOR' && row.corrects_wz_number && (
            <p className="mt-0.5 text-xs text-slate-500">
              Koryguje:{' '}
              {row.corrects_wz_id ? (
                <Link to={`/delivery/${row.corrects_wz_id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  {row.corrects_wz_number}
                </Link>
              ) : (
                row.corrects_wz_number
              )}
            </p>
          )}
          {row.document_type === 'WZ' && (row.corrections?.length ?? 0) > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {row.corrections!.map((kor) => (
                <p key={kor.id} className="text-xs text-slate-500">
                  Korekta:{' '}
                  <Link to={`/delivery/${kor.id}`} className="text-amber-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {kor.document_number ?? kor.id.slice(0, 8)}
                  </Link>
                </p>
              ))}
            </div>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3">
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            row.document_type === 'ZW' ? 'bg-amber-100 text-amber-800'
            : row.document_type === 'MM' ? 'bg-purple-100 text-purple-800'
            : row.document_type === 'RW' ? 'bg-red-100 text-red-800'
            : 'bg-blue-100 text-blue-800',
          )}>
            {DOC_TYPE_LABELS_PL[row.document_type] ?? row.document_type}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-sm text-slate-500">{formatIssueDate(row.issue_date)}</td>
        <td className="max-w-[220px] truncate px-3 py-3 text-sm text-slate-600" title={row.customer_name ?? undefined}>{partyLabel(row.customer_name)}</td>
        {showDriver !== false && <td className="max-w-[160px] truncate px-3 py-3 text-sm text-slate-600" title={row.driver_name ?? undefined}>{partyLabel(row.driver_name)}</td>}
        <td className="px-3 py-3">
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', deliveryStatusBadgeClassName(row.status, row.document_type))}>
            {deliveryStatusLabel(row.status, row.document_type)}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-3">
          {row.order_id ? (
            <Link to={`/orders/${row.order_id}`} className="text-sm font-semibold text-primary hover:underline">
              {row.order_number ?? row.order_id.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-sm text-slate-500">—</span>
          )}
        </td>
        {wzQuickReturns && (
          <td className="px-3 py-3">
            {row.document_type === 'WZ' && row.status !== 'cancelled' && hasItems && (
              <button
                type="button"
                onClick={() => onQuickReturn(row)}
                className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-amber-700 hover:bg-amber-100"
              >
                +&nbsp;Zwrot
              </button>
            )}
          </td>
        )}
      </tr>
      {expanded && hasItems && (
        <tr className="border-b border-slate-100 bg-slate-50/40">
          <td className="w-8 px-2" />
          {printMode && <td />}
          <td colSpan={99} className="px-3 pb-3 pt-1">
            <div className="flex flex-col gap-3">
              {/* Links row — only show corrections (document link is in the row header) */}
              {(row.corrections?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {row.corrections!.map((kor) => (
                    <Link
                      key={kor.id}
                      to={`/delivery/${kor.id}`}
                      className="text-xs text-amber-700 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Korekta: {kor.document_number ?? kor.id.slice(0, 8)}
                    </Link>
                  ))}
                </div>
              )}

              {/* WZ-KOR: side-by-side comparison table */}
              {row.document_type === 'WZ-KOR' && row.corrects_wz_items && row.corrects_wz_items.length > 0 ? (() => {
                // Build lookup: product_name → {qty, unit} in correction
                const korMap: Record<string, { qty: string; unit: string }> = {};
                for (const it of row.items) {
                  const name = it.product_name?.trim() || '';
                  const q = it.quantity_actual ?? it.quantity_planned;
                  const unit = it.product_unit?.trim() || '';
                  if (name) korMap[name] = { qty: q ? String(q) : '?', unit };
                }
                return (
                  <div className="mt-1 max-w-3xl overflow-hidden rounded-lg border border-slate-200">
                    {/* Header row */}
                    <div className="grid grid-cols-[minmax(0,1fr)_120px_120px] bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <span>Produkt</span>
                      <span className="text-center">
                        {row.corrects_wz_id ? (
                          <Link to={`/delivery/${row.corrects_wz_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {row.corrects_wz_number}
                          </Link>
                        ) : (row.corrects_wz_number || 'Oryginał')}
                      </span>
                      <span className="text-center text-rose-500">{row.document_number}</span>
                    </div>
                    {/* Data rows */}
                    <div className="divide-y divide-slate-100">
                      {row.corrects_wz_items.map((orig, i) => {
                        const origQty = orig.quantity_actual ?? orig.quantity_planned ?? '?';
                        const origUnit = orig.product_unit?.trim() || '';
                        const kor = korMap[orig.product_name?.trim() ?? ''];
                        const changed = kor !== undefined && kor.qty !== String(origQty);
                        return (
                          <div key={i} className={cn('grid grid-cols-[minmax(0,1fr)_120px_120px] items-center px-4 py-2 text-sm', changed ? 'bg-rose-50/60' : '')}>
                            <span className="truncate text-slate-700" title={orig.product_name ?? undefined}>
                              {orig.product_name || '—'}
                            </span>
                            <span className={cn('text-center tabular-nums', changed ? 'text-slate-400 line-through' : 'text-slate-600')}>
                              {fmtQty(origQty)} {origUnit}
                            </span>
                            <span className={cn('text-center tabular-nums font-medium', kor ? (changed ? 'text-rose-700' : 'text-slate-600') : 'text-slate-300')}>
                              {kor ? `${fmtQty(kor.qty)} ${kor.unit || origUnit}` : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })() : (
                /* Regular WZ or WZ-KOR without original items loaded */
                <div className="inline-grid w-80 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8 gap-y-1 text-sm">
                  {row.items.map((item) => {
                    const name = item.product_name?.trim() || '—';
                    return (
                      <Fragment key={item.id}>
                        <span className="truncate text-slate-600" title={name}>{name}</span>
                        <span className="tabular-nums text-slate-600">{itemQuantityNode(item)}</span>
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </td>
          <td /><td />{showDriver !== false && <td />}<td /><td />
          {wzQuickReturns && <td />}
        </tr>
      )}
    </>
  );
}

export function DeliveryDocumentsPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <DeliveryDocumentsPageContent />;
}

function DeliveryDocumentsPageContent() {
  const { user } = useAuth();
  const { data: myCompanies } = useMyCompaniesQuery();
  const currentCompany = (myCompanies ?? []).find((c) => c.id === user?.current_company);
  const wzQuickReturns = currentCompany?.wz_quick_returns ?? false;
  const [quickReturnWz, setQuickReturnWz] = useState<QuickReturnState | null>(null);
  const canDelivery = usePermission('can_manage_delivery');

  const hasPermission = (key: keyof UserPermissions): boolean =>
    !!(user?.is_company_admin || user?.permissions?.[key]);
  // --- Shared date range (default: current month) ---
  const [dateFrom, setDateFrom] = useState(() => currentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => currentMonthRange().to);

  // --- View / print state ---
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [printMode, setPrintMode] = useState(false);
  const [printSelectedIds, setPrintSelectedIds] = useState<Set<string>>(() => new Set());
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  // --- Lista-tab client-side filters (column headers; empty set = all) ---
  const [listStatuses, setListStatuses] = useState<Set<DeliveryDocumentStatus>>(() => new Set());
  const [listTypes, setListTypes] = useState<Set<DeliveryDocumentType>>(() => new Set());
  const [listCustomers, setListCustomers] = useState<Set<string>>(() => new Set());
  const [listCustomerQuery, setListCustomerQuery] = useState('');
  const [listDrivers, setListDrivers] = useState<Set<string>>(() => new Set());
  const [listDriverQuery, setListDriverQuery] = useState('');
  const [listNumberQuery, setListNumberQuery] = useState('');
  const [listOrderQuery, setListOrderQuery] = useState('');
  const [openColumn, setOpenColumn] = useState<ListColumn | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [sortBy, setSortBy] = useState<'number' | 'date'>('number');

  // --- Single shared query ---
  const { data, isFetching, isError, error, refetch } = useDeliveryByRangeQuery(dateFrom, dateTo);
  const docs = useMemo(
    () => [...(data?.results ?? [])].sort(
      sortBy === 'date' ? compareDeliveryDocumentsNewestDateFirst : compareDeliveryDocumentsNewestNumberFirst,
    ),
    [data?.results, sortBy],
  );
  const totalCount = data?.count ?? 0;
  // Only warn when we hit the hard cap of 500 — normal paginated responses
  // (e.g. 20 of 34) are handled correctly once the backend honours page_size.
  const hasMore = totalCount > 500;

  // --- Period counters ---
  const wzCount = useMemo(() => docs.filter((d) => d.document_type === 'WZ').length, [docs]);
  const zwCount = useMemo(() => docs.filter((d) => d.document_type === 'ZW').length, [docs]);
  const shopCount = useMemo(() => {
    const keys = new Set<string>();
    for (const d of docs) {
      if (d.document_type === 'WZ') keys.add(d.to_customer_id ?? d.customer_name ?? d.id);
    }
    return keys.size;
  }, [docs]);

  const customerNames = useMemo(
    () => [...new Set(docs.map((d) => partyLabel(d.customer_name)))].sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' })),
    [docs],
  );
  const driverNames = useMemo(
    () => [...new Set(docs.map((d) => partyLabel(d.driver_name)))].sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' })),
    [docs],
  );
  const hasAnyDriver = useMemo(
    () => docs.some((d) => d.driver_name?.trim()),
    [docs],
  );

  // --- Lista client-side filtering + pagination ---
  const filteredListDocs = useMemo(() => {
    const numberQuery = listNumberQuery.trim();
    const orderQuery = listOrderQuery.trim();
    const customerQuery = listCustomerQuery.trim();
    const driverQuery = listDriverQuery.trim();
    return docs.filter((doc) => {
      if (listTypes.size > 0 && !listTypes.has(doc.document_type)) return false;
      if (listStatuses.size > 0 && !listStatuses.has(doc.status)) return false;
      if (numberQuery && !includesFold(doc.document_number?.trim() || '', numberQuery)) return false;
      const orderText = doc.order_number?.trim() || '';
      if (orderQuery && !includesFold(orderText, orderQuery)) return false;
      const customer = partyLabel(doc.customer_name);
      if (listCustomers.size > 0) {
        if (!listCustomers.has(customer)) return false;
      } else if (customerQuery && !includesFold(customer, customerQuery)) {
        return false;
      }
      const driver = partyLabel(doc.driver_name);
      if (listDrivers.size > 0) {
        if (!listDrivers.has(driver)) return false;
      } else if (driverQuery && !includesFold(driver, driverQuery)) {
        return false;
      }
      return true;
    });
  }, [docs, listTypes, listStatuses, listCustomers, listCustomerQuery, listDrivers, listDriverQuery, listNumberQuery, listOrderQuery]);

  useEffect(() => {
    setListPage(1);
  }, [listTypes, listStatuses, listCustomers, listCustomerQuery, listDrivers, listDriverQuery, listNumberQuery, listOrderQuery, dateFrom, dateTo]);

  useEffect(() => {
    if (!openColumn) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-column-filter]')) return;
      setOpenColumn(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenColumn(null);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openColumn]);

  const toggleColumn = (column: ListColumn) => setOpenColumn((current) => (current === column ? null : column));

  const numberFilterActive = listNumberQuery.trim().length > 0;
  const typeFilterActive = listTypes.size > 0;
  const customerFilterActive = listCustomers.size > 0 || listCustomerQuery.trim().length > 0;
  const driverFilterActive = listDrivers.size > 0 || listDriverQuery.trim().length > 0;
  const statusFilterActive = listStatuses.size > 0;
  const orderFilterActive = listOrderQuery.trim().length > 0;
  const activeFilterCount = [
    numberFilterActive,
    typeFilterActive,
    customerFilterActive,
    driverFilterActive,
    statusFilterActive,
    orderFilterActive,
  ].filter(Boolean).length;

  const clearListFilters = () => {
    setListTypes(new Set());
    setListStatuses(new Set());
    setListCustomers(new Set());
    setListCustomerQuery('');
    setListDrivers(new Set());
    setListDriverQuery('');
    setListNumberQuery('');
    setListOrderQuery('');
  };

  const customerOptions = visibleNameOptions(customerNames, listCustomerQuery, listCustomers).map((name) => ({ value: name, label: name }));
  const driverOptions = visibleNameOptions(driverNames, listDriverQuery, listDrivers).map((name) => ({ value: name, label: name }));

  const selectedTypes = [...listTypes];
  const typesAreRestricted = selectedTypes.length > 0 && selectedTypes.every((type) => {
    const permission = DOC_TYPE_PERMISSION[type];
    return permission ? !hasPermission(permission) : false;
  });

  const totalListPages = Math.max(1, Math.ceil(filteredListDocs.length / PAGE_SIZE));
  const pagedListDocs = filteredListDocs.slice((listPage - 1) * PAGE_SIZE, listPage * PAGE_SIZE);

  // --- Quick date range helpers ---
  const setRange = (from: string, to: string) => { setDateFrom(from); setDateTo(to); };
  const isActiveRange = (from: string, to: string) => dateFrom === from && dateTo === to;
  const isRange = dateFrom !== dateTo;

  const today = todayIso();
  const yesterday = yesterdayIso();
  const thisWeek = thisWeekRange();
  const thisMonth = currentMonthRange();
  const prevMonth = prevMonthRange();

  const quickRanges = [
    { label: 'Dziś', from: today, to: today },
    { label: 'Wczoraj', from: yesterday, to: yesterday },
    { label: 'Ten tydzień', from: thisWeek.from, to: thisWeek.to },
    { label: 'Ten miesiąc', from: thisMonth.from, to: thisMonth.to },
    { label: 'Poprzedni miesiąc', from: prevMonth.from, to: prevMonth.to },
  ];

  // --- Print ---
  const togglePrintId = (id: string) =>
    setPrintSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const enterPrintMode = () => { setPrintSelectedIds(new Set()); setPrintMode(true); setPrintError(null); };
  const exitPrintMode = () => { setPrintMode(false); setPrintSelectedIds(new Set()); setPrintError(null); };

  const handlePrint = async () => {
    const ids = [...printSelectedIds];
    if (ids.length === 0) return;
    setIsPrinting(true);
    setPrintError(null);
    try {
      const previews = await Promise.all(ids.map((id) => deliveryService.fetchPreview(id)));
      openMultiWZPrintWindow(previews);
      exitPrintMode();
    } catch (e) {
      setPrintError(e instanceof Error ? e.message : 'Błąd pobierania danych');
    } finally {
      setIsPrinting(false);
    }
  };

  const shopCountLabel =
    shopCount === 1 ? '1 sklep' : shopCount < 5 ? `${shopCount} sklepy` : `${shopCount} sklepów`;

  return (
    <div className="space-y-4 p-6">
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Dokumenty</h1>
          {canDelivery && (
            <Link to="/delivery/new">
              <Button className="w-full sm:w-auto">+ Nowe WZ</Button>
            </Link>
          )}
        </div>

        {/* Toolbar: tabs | custom date inputs | print */}
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle mode={viewMode} onChange={setViewMode} />

          <div className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Data wystawienia od"
              className="border-none bg-transparent p-0 text-xs outline-none"
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Data wystawienia do"
              className="border-none bg-transparent p-0 text-xs outline-none"
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {printMode ? (
              <>
                <Button type="button" size="sm" className="shrink-0" disabled={printSelectedIds.size === 0 || isPrinting} onClick={() => void handlePrint()}>
                  {isPrinting ? 'Pobieranie…' : `Drukuj (${printSelectedIds.size})`}
                </Button>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={exitPrintMode} disabled={isPrinting}>Anuluj</Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={enterPrintMode}>
                <svg className="mr-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Drukuj WZ
              </Button>
            )}
          </div>
        </div>

        {/* Quick ranges + counters */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {quickRanges.map(({ label, from, to }) => (
              <button
                key={label}
                type="button"
                className={cn(
                  'rounded px-3 py-1 text-[11px] font-bold uppercase transition-colors',
                  isActiveRange(from, to)
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setRange(from, to)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {isFetching ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            ) : (
              <>
                <span className="font-bold text-foreground">{shopCountLabel}</span>
                <span>·</span>
                <span>{wzCount} WZ</span>
                {zwCount > 0 && <><span>·</span><span>{zwCount} ZW</span></>}
              </>
            )}
          </div>
        </div>

        {isError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3" role="alert">
            <p className="text-sm text-destructive">{queryErrorMessage(error)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Spróbuj ponownie</Button>
          </div>
        )}

        {hasMore && !isFetching && (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800">
            Wyświetlono {docs.length} z {totalCount} dokumentów. Zawęź zakres dat, aby zobaczyć wszystkie.
          </div>
        )}

        {printError && <p className="text-sm text-destructive" role="alert">{printError}</p>}

        {/* Tab content */}
        {viewMode === 'by-shop' && !isError && (
          <ByShopView
            docs={docs}
            isRange={isRange}
            printMode={printMode}
            printSelectedIds={printSelectedIds}
            onTogglePrintId={togglePrintId}
          />
        )}

        {viewMode === 'list' && !isError && (
          <Card className="w-full shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <CardTitle className="text-xl sm:text-[1.5rem]">Lista dokumentów</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isFetching ? 'Ładowanie…' : `Znaleziono: ${filteredListDocs.length}`}
                </p>
              </div>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearListFilters} className="shrink-0 text-sm font-medium text-primary hover:underline">
                  Wyczyść filtry
                </button>
              )}
            </CardHeader>
            <CardContent className="pt-6">
              <div className="mb-4 md:hidden">
                <button
                  type="button"
                  aria-expanded={mobileFiltersOpen}
                  onClick={() => setMobileFiltersOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Filtry
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{activeFilterCount}</span>
                  )}
                </button>
                {mobileFiltersOpen && (
                  <div className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-800">Numer dokumentu</p>
                      <FilterSearch label="Szukaj w kolumnie Numer dokumentu" value={listNumberQuery} onChange={setListNumberQuery} placeholder="Zawiera…" />
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-800">Typ</p>
                      <CheckList
                        options={DOC_TYPE_FILTER_OPTIONS}
                        selected={listTypes}
                        onToggle={(value) => setListTypes((current) => toggleInSet(current, value))}
                        emptyText="Brak typów"
                      />
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-800">Klient</p>
                      <div className="space-y-2">
                        <FilterSearch label="Szukaj w kolumnie Klient" value={listCustomerQuery} onChange={setListCustomerQuery} placeholder="Wpisz fragment nazwy" />
                        <CheckList
                          options={customerOptions}
                          selected={listCustomers}
                          onToggle={(value) => setListCustomers((current) => toggleInSet(current, value))}
                          emptyText="Brak klientów w tym zakresie"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-800">Kierowca</p>
                      <div className="space-y-2">
                        <FilterSearch label="Szukaj w kolumnie Kierowca" value={listDriverQuery} onChange={setListDriverQuery} placeholder="Wpisz fragment nazwy" />
                        <CheckList
                          options={driverOptions}
                          selected={listDrivers}
                          onToggle={(value) => setListDrivers((current) => toggleInSet(current, value))}
                          emptyText="Brak kierowców w tym zakresie"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-800">Status</p>
                      <CheckList
                        options={deliveryStatusFilterOptions}
                        selected={listStatuses}
                        onToggle={(value) => setListStatuses((current) => toggleInSet(current, value))}
                        emptyText="Brak statusów"
                      />
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-slate-800">Zamówienie</p>
                      <FilterSearch label="Szukaj w kolumnie Zamówienie" value={listOrderQuery} onChange={setListOrderQuery} placeholder="Zawiera…" />
                    </div>
                  </div>
                )}
              </div>
              <ul className="divide-y divide-border md:hidden">
                {pagedListDocs.map((row: DeliveryDocument) => (
                  <li key={row.id} className="py-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        {printMode && row.document_type === 'WZ' && (
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 rounded accent-primary"
                            checked={printSelectedIds.has(row.id)}
                            onChange={() => togglePrintId(row.id)}
                            aria-label={`Zaznacz ${row.document_number ?? row.id.slice(0, 8)}`}
                          />
                        )}
                        <div className="min-w-0">
                          <Link to={`/delivery/${row.id}`} className="font-medium text-primary hover:underline">
                            {row.document_number ?? row.id.slice(0, 8)}
                          </Link>
                          {row.document_type === 'WZ-KOR' && row.corrects_wz_number && (
                            <p className="text-xs text-slate-500">
                              Koryguje:{' '}
                              {row.corrects_wz_id ? (
                                <Link to={`/delivery/${row.corrects_wz_id}`} className="text-primary hover:underline">
                                  {row.corrects_wz_number}
                                </Link>
                              ) : row.corrects_wz_number}
                            </p>
                          )}
                          {row.document_type === 'WZ' && (row.corrections?.length ?? 0) > 0 && (
                            <div>
                              {row.corrections!.map((kor) => (
                                <p key={kor.id} className="text-xs text-slate-500">
                                  Korekta:{' '}
                                  <Link to={`/delivery/${kor.id}`} className="text-amber-700 hover:underline">
                                    {kor.document_number ?? kor.id.slice(0, 8)}
                                  </Link>
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            row.document_type === 'ZW' ? 'bg-amber-100 text-amber-800'
                            : row.document_type === 'MM' ? 'bg-purple-100 text-purple-800'
                            : row.document_type === 'RW' ? 'bg-red-100 text-red-800'
                            : 'bg-blue-100 text-blue-800',
                          )}>
                            {row.document_type}
                          </span>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', deliveryStatusBadgeClassName(row.status, row.document_type))}>
                            {deliveryStatusLabel(row.status, row.document_type)}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{row.customer_name || '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        Data: {formatIssueDate(row.issue_date)} · Kierowca: {row.driver_name?.trim() ? row.driver_name : '—'}
                      </p>
                      {row.order_id ? (
                        <Link to={`/orders/${row.order_id}`} className="text-xs font-medium text-primary hover:underline">Zamówienie</Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mb-3 hidden items-center gap-2 md:flex">
                <span className="text-xs text-slate-500">Sortuj:</span>
                <button
                  type="button"
                  onClick={() => setSortBy('number')}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-medium',
                    sortBy === 'number' ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  Numer ↓
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy('date')}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-medium',
                    sortBy === 'date' ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  Data ↓
                </button>
              </div>

              <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
                <table className="min-w-full border-collapse text-sm" aria-label="Lista dokumentów">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white">
                      <th scope="col" className="w-8 px-2 py-3" />
                      {printMode && <th scope="col" className="w-10 px-3 py-3" />}
                      <ColumnFilterTh label="Numer dokumentu" active={numberFilterActive} open={openColumn === 'number'} onToggle={() => toggleColumn('number')}>
                        <div className="space-y-2">
                          <FilterSearch autoFocus label="Szukaj w kolumnie Numer dokumentu" value={listNumberQuery} onChange={setListNumberQuery} placeholder="Zawiera…" />
                          {numberFilterActive && <ClearFilterButton onClick={() => setListNumberQuery('')} />}
                        </div>
                      </ColumnFilterTh>
                      <ColumnFilterTh label="Typ" active={typeFilterActive} open={openColumn === 'type'} onToggle={() => toggleColumn('type')}>
                        <div className="space-y-2">
                          <CheckList
                            options={DOC_TYPE_FILTER_OPTIONS}
                            selected={listTypes}
                            onToggle={(value) => setListTypes((current) => toggleInSet(current, value))}
                            emptyText="Brak typów"
                          />
                          {typeFilterActive && <ClearFilterButton onClick={() => setListTypes(new Set())} />}
                        </div>
                      </ColumnFilterTh>
                      <th scope="col" className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Data wyst.</th>
                      <ColumnFilterTh label="Klient" active={customerFilterActive} open={openColumn === 'customer'} onToggle={() => toggleColumn('customer')}>
                        <div className="space-y-2">
                          <FilterSearch autoFocus label="Szukaj w kolumnie Klient" value={listCustomerQuery} onChange={setListCustomerQuery} placeholder="Wpisz fragment nazwy" />
                          <CheckList
                            options={customerOptions}
                            selected={listCustomers}
                            onToggle={(value) => setListCustomers((current) => toggleInSet(current, value))}
                            emptyText="Brak klientów w tym zakresie"
                          />
                          {customerFilterActive && (
                            <ClearFilterButton onClick={() => { setListCustomers(new Set()); setListCustomerQuery(''); }} />
                          )}
                        </div>
                      </ColumnFilterTh>
                      {hasAnyDriver && (
                        <ColumnFilterTh label="Kierowca" active={driverFilterActive} open={openColumn === 'driver'} onToggle={() => toggleColumn('driver')}>
                          <div className="space-y-2">
                            <FilterSearch autoFocus label="Szukaj w kolumnie Kierowca" value={listDriverQuery} onChange={setListDriverQuery} placeholder="Wpisz fragment nazwy" />
                            <CheckList
                              options={driverOptions}
                              selected={listDrivers}
                              onToggle={(value) => setListDrivers((current) => toggleInSet(current, value))}
                              emptyText="Brak kierowców w tym zakresie"
                            />
                            {driverFilterActive && (
                              <ClearFilterButton onClick={() => { setListDrivers(new Set()); setListDriverQuery(''); }} />
                            )}
                          </div>
                        </ColumnFilterTh>
                      )}
                      <ColumnFilterTh label="Status" active={statusFilterActive} open={openColumn === 'status'} onToggle={() => toggleColumn('status')}>
                        <div className="space-y-2">
                          <CheckList
                            options={deliveryStatusFilterOptions}
                            selected={listStatuses}
                            onToggle={(value) => setListStatuses((current) => toggleInSet(current, value))}
                            emptyText="Brak statusów"
                          />
                          {statusFilterActive && <ClearFilterButton onClick={() => setListStatuses(new Set())} />}
                        </div>
                      </ColumnFilterTh>
                      <ColumnFilterTh label="Zamówienie" active={orderFilterActive} open={openColumn === 'order'} onToggle={() => toggleColumn('order')} align="right">
                        <div className="space-y-2">
                          <FilterSearch autoFocus label="Szukaj w kolumnie Zamówienie" value={listOrderQuery} onChange={setListOrderQuery} placeholder="Zawiera…" />
                          {orderFilterActive && <ClearFilterButton onClick={() => setListOrderQuery('')} />}
                        </div>
                      </ColumnFilterTh>
                      {wzQuickReturns && <th scope="col" className="w-20 px-3 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {pagedListDocs.map((row: DeliveryDocument) => (
                      <ExpandableDocRow
                        key={row.id}
                        row={row}
                        printMode={printMode}
                        printSelectedIds={printSelectedIds}
                        togglePrintId={togglePrintId}
                        wzQuickReturns={wzQuickReturns}
                        onQuickReturn={(r) => setQuickReturnWz({ wzId: r.id, wzNumber: r.document_number ?? r.id.slice(0, 8), wzDate: r.issue_date, items: r.items })}
                        showDriver={hasAnyDriver}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {!isFetching && pagedListDocs.length === 0 && (
                typesAreRestricted ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <svg className="h-8 w-8 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-sm font-medium text-muted-foreground">Brak uprawnień do wyświetlenia tych dokumentów.</p>
                    <p className="text-xs text-muted-foreground/70">Twój zestaw uprawnień nie obejmuje dokumentów typu {selectedTypes.join(', ')}.</p>
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">Brak dokumentów spełniających kryteria.</p>
                )
              )}

              {totalListPages > 1 && (
                <nav
                  className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
                  aria-label="Stronicowanie listy dokumentów"
                >
                  <p className="text-center text-sm text-muted-foreground sm:text-left">
                    Strona <span className="font-medium text-foreground">{listPage}</span> z{' '}
                    <span className="font-medium text-foreground">{totalListPages}</span>
                  </p>
                  <div className="flex justify-center gap-2 sm:justify-end">
                    <Button type="button" variant="outline" size="sm" disabled={listPage <= 1} onClick={() => setListPage((p) => p - 1)}>Poprzednia</Button>
                    <Button type="button" variant="outline" size="sm" disabled={listPage >= totalListPages} onClick={() => setListPage((p) => p + 1)}>Następna</Button>
                  </div>
                </nav>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {quickReturnWz && (
        <QuickReturnModal
          wz={quickReturnWz}
          onClose={() => setQuickReturnWz(null)}
          onSaved={() => { setQuickReturnWz(null); void refetch(); }}
        />
      )}
    </div>
  );
}

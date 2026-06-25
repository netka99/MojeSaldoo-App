import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
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
import { cn } from '@/lib/utils';
import type { DeliveryDocument, DeliveryDocumentStatus, DeliveryDocumentType, DeliveryItem, UserPermissions } from '@/types';

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

const selectClassName = cn(
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function deliveryStatusBadgeClassName(status: DeliveryDocumentStatus): string {
  switch (status) {
    case 'draft':      return 'bg-surface-container text-on-surface';
    case 'saved':      return 'bg-blue-100 text-blue-800';
    case 'in_transit': return 'bg-amber-100 text-amber-900';
    case 'delivered':  return 'bg-green-100 text-green-800';
    case 'cancelled':  return 'bg-red-100 text-red-800';
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
            <div className="divide-y divide-border/60 px-4 py-5">
              {wzDocs.map((doc) => {
                const qty = (item: DeliveryItem) =>
                  item.quantity_actual !== null && item.quantity_actual !== undefined && item.quantity_actual !== ''
                    ? item.quantity_actual
                    : item.quantity_planned;
                const meta: string[] = [];
                if (showDates) meta.push(formatIssueDate(doc.issue_date));
                if (doc.driver_name?.trim()) meta.push(`Kurier: ${doc.driver_name}`);
                return (
                  <div key={doc.id} className="relative bg-blue-50/50 py-3 pl-4">
                    <div className="absolute bottom-2 left-0 top-2 w-1 rounded-full bg-primary" />
                    <div className="mx-auto max-w-[650px]">
                      <div className="mb-3 flex flex-wrap items-center gap-2 px-3">
                        {printMode && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded accent-primary"
                            checked={printSelectedIds.has(doc.id)}
                            onChange={() => onTogglePrintId(doc.id)}
                            aria-label={`Zaznacz ${doc.document_number || doc.id.slice(0, 8)}`}
                          />
                        )}
                        <Link to={`/delivery/${doc.id}`} className="text-sm font-bold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {doc.document_number?.trim() || `WZ ${doc.id.slice(0, 8)}`}
                        </Link>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', deliveryStatusBadgeClassName(doc.status))}>
                          {DELIVERY_STATUS_LABELS_PL[doc.status]}
                        </span>
                        {meta.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{meta.join(' • ')}</span>}
                      </div>
                      {doc.items.length > 0 && (
                        <div className="divide-y-2 divide-border/60 border-t-2 border-border/60">
                          {doc.items.map((item, i) => (
                            <div key={item.id} className={cn('flex items-center px-3 py-[0.4rem] text-sm', i % 2 === 1 && 'bg-blue-100/40')}>
                              <span>{productLabel(item)}</span>
                              <span className="mx-3 mb-1 min-w-0 flex-1 border-b border-dotted border-border" />
                              <span className="shrink-0 font-bold tabular-nums">{fmtQty(qty(item))} szt.</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {zwDocs.length > 0 && (
                <div className="space-y-4 -mx-4 px-4 mt-4 pt-3 pb-1 border-y-2 border-border bg-muted/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Zwroty (ZW)</p>
                  {zwDocs.map((doc) => {
                    const meta: string[] = [];
                    if (showDates) meta.push(formatIssueDate(doc.issue_date));
                    if (doc.returns_notes?.trim()) meta.push(`Przyczyna: ${doc.returns_notes}`);
                    return (
                      <div key={doc.id} className="relative bg-amber-50/50 py-3 pl-4">
                        <div className="absolute bottom-2 left-0 top-2 w-1 rounded-full bg-amber-500" />
                        <div className="mx-auto max-w-[650px]">
                          <div className="mb-3 flex flex-wrap items-center gap-2 px-3">
                            <Link to={`/delivery/${doc.id}`} className="text-sm font-bold text-amber-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                              {doc.document_number?.trim() || `ZW ${doc.id.slice(0, 8)}`}
                            </Link>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                              {DELIVERY_STATUS_LABELS_PL[doc.status]}
                            </span>
                            {meta.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{meta.join(' • ')}</span>}
                          </div>
                          {doc.items.length > 0 && (
                            <div className="divide-y-2 divide-amber-300/60 border-t-2 border-amber-300/60">
                              {doc.items.map((item, i) => (
                                <div key={item.id} className={cn('flex items-center px-3 py-[0.4rem] text-sm', i % 2 === 1 && 'bg-amber-100/40')}>
                                  <span>{productLabel(item)}</span>
                                  <span className="mx-3 mb-1 min-w-0 flex-1 border-b border-dotted border-amber-300/60" />
                                  <span className="shrink-0 font-bold tabular-nums text-destructive">{fmtQty(item.quantity_planned)} szt.</span>
                                </div>
                              ))}
                            </div>
                          )}
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
                className="flex w-full items-center gap-3 text-left"
                onClick={(e) => { e.stopPropagation(); setSummaryOpen((v) => !v); }}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Podsumowanie</span>
                <span className="text-xs text-muted-foreground">Saldo: {summary.length} pozycji</span>
                <svg className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', summaryOpen && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <div style={{ display: 'grid', gridTemplateRows: summaryOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.2s ease' }}>
                <div className="min-h-0 overflow-hidden">
                  <div className="mx-auto max-w-[650px]">
                    <table className="mt-3 w-full text-left text-sm">
                      <thead>
                        <tr className="border-b-2 border-border text-xs text-muted-foreground">
                          <th className="py-2 pr-4">Produkt</th>
                          <th className="px-2 py-2 text-right">WZ (Dostawa)</th>
                          <th className="px-2 py-2 text-right">ZW (Zwrot)</th>
                          <th className="py-2 text-right text-primary">Saldo końcowe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.map((row) => {
                          const net = row.delivered - row.returned;
                          return (
                            <tr key={row.name} className="border-t-2 border-border/60">
                              <td className="py-2 pr-4">{row.name}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{fmtQty(row.delivered)}</td>
                              <td className={cn('px-2 py-2 text-right tabular-nums', row.returned > 0 && 'text-destructive')}>
                                {row.returned > 0 ? `−${fmtQty(row.returned)}` : '0'}
                              </td>
                              <td className="py-2 text-right font-bold tabular-nums text-primary">{fmtQty(net)} szt.</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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

export function DeliveryDocumentsPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <DeliveryDocumentsPageContent />;
}

function DeliveryDocumentsPageContent() {
  const { user } = useAuth();
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

  // --- Lista-tab client-side filters ---
  const [listStatus, setListStatus] = useState<'' | DeliveryDocumentStatus>('');
  const [listDocType, setListDocType] = useState<'' | DeliveryDocumentType>('');
  const [listPage, setListPage] = useState(1);

  // --- Single shared query ---
  const { data, isFetching, isError, error, refetch } = useDeliveryByRangeQuery(dateFrom, dateTo);
  const docs = useMemo(
    () => [...(data?.results ?? [])].sort(compareDeliveryDocumentsNewestNumberFirst),
    [data?.results],
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

  // --- Lista client-side filtering + pagination ---
  const filteredListDocs = useMemo(() => {
    let r = docs;
    if (listDocType) r = r.filter((d) => d.document_type === listDocType);
    if (listStatus) r = r.filter((d) => d.status === listStatus);
    return r;
  }, [docs, listDocType, listStatus]);

  useEffect(() => { setListPage(1); }, [listDocType, listStatus, dateFrom, dateTo]);

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
            <CardHeader className="flex flex-col gap-4 border-b border-border pb-6">
              <div>
                <CardTitle className="text-xl sm:text-[1.5rem]">Lista dokumentów</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isFetching ? 'Ładowanie…' : `Znaleziono: ${filteredListDocs.length}`}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="delivery-type-filter" className="text-sm font-medium leading-none">Typ dokumentu</label>
                  <select
                    id="delivery-type-filter"
                    className={selectClassName}
                    value={listDocType}
                    onChange={(e) => setListDocType((e.target.value as DeliveryDocumentType | '') || '')}
                    aria-label="Filtruj dokumenty po typie"
                  >
                    <option value="">Wszystkie typy</option>
                    <option value="WZ">WZ — Wydanie zewnętrzne</option>
                    <option value="ZW">ZW — Zwrot zewnętrzny</option>
                    <option value="MM">MM — Przesunięcie międzymagazynowe</option>
                    <option value="PZ">PZ — Przyjęcie zewnętrzne</option>
                    <option value="RW">RW — Rozchód wewnętrzny</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="delivery-status-filter" className="text-sm font-medium leading-none">Status</label>
                  <select
                    id="delivery-status-filter"
                    className={selectClassName}
                    value={listStatus}
                    onChange={(e) => setListStatus((e.target.value as DeliveryDocumentStatus | '') || '')}
                    aria-label="Filtruj dokumenty po statusie"
                  >
                    <option value="">Wszystkie</option>
                    {deliveryStatusFilterOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
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
                        <Link to={`/delivery/${row.id}`} className="min-w-0 font-medium text-primary hover:underline">
                          {row.document_number ?? row.id.slice(0, 8)}
                        </Link>
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
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', deliveryStatusBadgeClassName(row.status))}>
                            {DELIVERY_STATUS_LABELS_PL[row.status]}
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

              <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
                <table className="min-w-full divide-y divide-border text-sm" aria-label="Lista dokumentów">
                  <thead className="bg-muted/50">
                    <tr>
                      {printMode && <th scope="col" className="w-10 px-3 py-3" />}
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Numer dokumentu</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Typ</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Data wyst.</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Klient</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Kierowca</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Zamówienie</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {pagedListDocs.map((row: DeliveryDocument) => (
                      <tr key={row.id} className="hover:bg-muted/30">
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
                        <td className="whitespace-nowrap px-4 py-3 font-medium">
                          <Link to={`/delivery/${row.id}`} className="text-primary hover:underline">
                            {row.document_number ?? row.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
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
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatIssueDate(row.issue_date)}</td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground" title={row.customer_name ?? undefined}>{row.customer_name || '—'}</td>
                        <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground" title={row.driver_name ?? undefined}>{row.driver_name?.trim() ? row.driver_name : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', deliveryStatusBadgeClassName(row.status))}>
                            {DELIVERY_STATUS_LABELS_PL[row.status]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {row.order_id ? (
                            <Link to={`/orders/${row.order_id}`} className="text-primary hover:underline">
                              {row.order_number ?? row.order_id.slice(0, 8)}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!isFetching && pagedListDocs.length === 0 && (() => {
                const requiredPerm = listDocType ? DOC_TYPE_PERMISSION[listDocType] : undefined;
                const isRestricted = requiredPerm ? !hasPermission(requiredPerm) : false;
                return isRestricted ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <svg className="h-8 w-8 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-sm font-medium text-muted-foreground">Brak uprawnień do wyświetlenia tych dokumentów.</p>
                    <p className="text-xs text-muted-foreground/70">Twój zestaw uprawnień nie obejmuje dokumentów typu {listDocType}.</p>
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">Brak dokumentów spełniających kryteria.</p>
                );
              })()}

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
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuditLogListQuery } from '@/query/use-activity';
import { activityService } from '@/services/activity.service';
import type { AuditLogListParams, AuditEntry } from '@/types/activity.types';
import { cn } from '@/lib/utils';

// ─── Link to document ───────────────────────────────────────────────────────

function docUrl(objectType: string, objectId: string | null | undefined): string | null {
  if (!objectId) return null;
  switch (objectType) {
    case 'Invoice': return `/invoices/${objectId}`;
    case 'DeliveryDocument': return `/delivery/${objectId}`;
    case 'Order': return `/orders/${objectId}`;
    case 'Customer': return `/customers/${objectId}`;
    case 'Product': return `/products/${objectId}`;
    case 'ProductionOrder': return `/production/orders/${objectId}`;
    default: return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Object-type icon ───────────────────────────────────────────────────────

function ObjectTypeIcon({ type }: { type: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        {type === 'Invoice' && (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M8 13h8M8 17h5" />
          </>
        )}
        {type === 'DeliveryDocument' && (
          <>
            <path d="M1 7h13v10H1z" />
            <path d="M14 11h4l3 3v3h-7" />
            <circle cx="5.5" cy="18.5" r="1.5" />
            <circle cx="18.5" cy="18.5" r="1.5" />
          </>
        )}
        {type === 'Order' && (
          <>
            <path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="2" width="6" height="4" rx="1" />
          </>
        )}
        {type === 'Customer' && (
          <>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </>
        )}
        {type === 'Product' && (
          <>
            <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
            <path d="M3.3 8 12 13l8.7-5M12 13v8" />
          </>
        )}
        {type === 'ProductionOrder' && (
          <>
            <path d="M2 21h20M4 21V10l6 4V10l6 4V6l4 3v12" />
          </>
        )}
        {/* Fallback: shield */}
        {!['Invoice', 'DeliveryDocument', 'Order', 'Customer', 'Product', 'ProductionOrder'].includes(type) && (
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        )}
      </svg>
    </span>
  );
}

// ─── Single entry row ────────────────────────────────────────────────────────

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const url = docUrl(entry.object_type, entry.object_id);
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <ObjectTypeIcon type={entry.object_type} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {url ? (
            <Link to={url} className="text-sm font-semibold text-primary hover:underline">
              {entry.object_repr || entry.object_type}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-primary">
              {entry.object_repr || entry.object_type}
            </span>
          )}
          <span className="text-sm text-slate-600">{entry.action_label}</span>
        </div>

        <p className="mt-0.5 text-xs text-slate-400">
          {formatDate(entry.created_at)}
          {entry.user_display ? ` · ${entry.user_display}` : ''}
        </p>

        {entry.changes.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {entry.changes.map((change, i) => (
              <li key={i} className="text-xs text-slate-500">
                {change}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-slate-100" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3.5 w-48 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}

// ─── Object type options ─────────────────────────────────────────────────────

const OBJECT_TYPE_OPTIONS = [
  { value: '', label: 'Wszystkie' },
  { value: 'Invoice', label: 'Faktura' },
  { value: 'DeliveryDocument', label: 'Dokument dostawy' },
  { value: 'Order', label: 'Zamówienie' },
  { value: 'Customer', label: 'Klient' },
  { value: 'Product', label: 'Produkt' },
  { value: 'ProductionOrder', label: 'Zlecenie produkcji' },
  { value: 'Company', label: 'Ustawienia firmy' },
  { value: 'StockMovement', label: 'Ruch magazynowy' },
  { value: 'User', label: 'Logowania' },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const navigate = useNavigate();

  // Filter state (applied)
  const [params, setParams] = useState<AuditLogListParams>({ page: 1 });

  // Draft state (before "Filtruj" is pressed)
  const [draftType, setDraftType] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');

  const [exporting, setExporting] = useState(false);

  const { data, isPending, isError } = useAuditLogListQuery(params);

  function applyFilters() {
    setParams({
      object_type: draftType || undefined,
      date_from: draftFrom || undefined,
      date_to: draftTo || undefined,
      page: 1,
    });
  }

  function changePage(next: number) {
    setParams((prev) => ({ ...prev, page: next }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const exportParams = {
        object_type: params.object_type,
        date_from: params.date_from,
        date_to: params.date_to,
      };
      const blob = await activityService.exportAuditLogCsv(exportParams);
      const dateSuffix = [exportParams.date_from, exportParams.date_to].filter(Boolean).join('_') || new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dziennik_audytu_${dateSuffix}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silent — user sees no data downloaded
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
            aria-label="Wróć"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5}>
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <h1 className="flex-1 text-base font-bold tracking-tight text-slate-900 md:text-xl">
            Dziennik audytu
          </h1>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className={cn(
              'rounded-2xl border border-primary/50 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5',
              exporting && 'cursor-not-allowed opacity-60',
            )}
          >
            {exporting ? 'Eksportowanie…' : 'Eksportuj CSV'}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-3 p-4">
        {/* ── Filters card ── */}
        <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
            </span>
            <h2 className="text-sm font-semibold text-slate-900">Filtry</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            {/* Type select */}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">Typ dokumentu</span>
              <div className="relative">
                <select
                  className="select-pill w-full"
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value)}
                >
                  {OBJECT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
            </label>

            {/* Date from */}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">Data od</span>
              <input
                type="date"
                className="date-pill w-full"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
              />
            </label>

            {/* Date to */}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">Data do</span>
              <input
                type="date"
                className="date-pill w-full"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
              />
            </label>
          </div>

          <div className="border-t border-slate-100 px-4 py-3">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Filtruj
            </button>
          </div>
        </section>

        {/* ── Results card ── */}
        <section className="rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
          {isPending && (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          )}

          {isError && (
            <p className="p-6 text-center text-sm text-destructive">
              Nie udało się załadować dziennika audytu.
            </p>
          )}

          {!isPending && !isError && data && data.results.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">
              Brak zapisanych zmian dla wybranych filtrów.
            </p>
          )}

          {!isPending && !isError && data && data.results.map((entry) => (
            <AuditEntryRow key={entry.id} entry={entry} />
          ))}
        </section>

        {/* ── Pagination ── */}
        {data && (data.page > 1 || data.has_more) && (
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => changePage(data.page - 1)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ← Poprzednia
            </button>
            <span className="text-xs text-slate-400">
              Strona {data.page}
              {data.total > 0 ? ` z ${Math.ceil(data.total / data.page_size)}` : ''}
            </span>
            <button
              type="button"
              disabled={!data.has_more}
              onClick={() => changePage(data.page + 1)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Następna →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

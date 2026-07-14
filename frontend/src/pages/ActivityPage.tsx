import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivityLogQuery } from '@/query/use-activity';
import type { ActivityStatus, ActivityEntry } from '@/types/activity.types';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<ActivityStatus, string> = {
  success: 'Sukces',
  error: 'Błąd',
  warning: 'Ostrzeżenie',
};

const STATUS_BADGE: Record<ActivityStatus, string> = {
  success: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
};

const STATUS_DOT: Record<ActivityStatus, string> = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = entry.status !== 'success' && entry.error_info;

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40',
          hasError && 'cursor-pointer',
        )}
        onClick={() => hasError && setExpanded((v) => !v)}
        aria-expanded={hasError ? expanded : undefined}
      >
        {/* Status dot */}
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', STATUS_DOT[entry.status])} aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{entry.action_label}</span>
            {entry.object_id && (
              <span className="text-xs text-muted-foreground">#{entry.object_id}</span>
            )}
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_BADGE[entry.status])}>
              {STATUS_LABELS[entry.status]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
          {/* Collapsed error hint */}
          {!expanded && hasError && (
            <p className="mt-1 text-xs text-red-600">{entry.error_info!.title} — kliknij aby zobaczyć szczegóły</p>
          )}
        </div>

        {hasError && (
          <span className="shrink-0 text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
        )}
      </button>

      {/* Expanded error panel */}
      {expanded && hasError && (
        <div className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-semibold text-red-800">{entry.error_info!.title}</p>
          <p className="mt-1 text-red-700">{entry.error_info!.description}</p>
          <p className="mt-2 text-red-700">
            <span className="font-medium">Co zrobić: </span>
            {entry.error_info!.action_hint}
          </p>
          {entry.error_info!.action_url && (
            <Link
              to={entry.error_info!.action_url.replace('{object_id}', entry.object_id)}
              className="mt-2 inline-block rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
            >
              Przejdź do poprawki
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

const FILTER_OPTIONS: { label: string; value: ActivityStatus | '' }[] = [
  { label: 'Wszystkie', value: '' },
  { label: 'Błędy', value: 'error' },
  { label: 'Ostrzeżenia', value: 'warning' },
  { label: 'Sukces', value: 'success' },
];

export function ActivityPage() {
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | ''>('');
  const [page, setPage] = useState(1);

  const { data, isPending, isError } = useActivityLogQuery({
    status: statusFilter || undefined,
    page,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Historia aktywności</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Twoje ostatnie działania i napotkane błędy. Kliknij błąd, aby zobaczyć co zrobić.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { setStatusFilter(opt.value); setPage(1); }}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              statusFilter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Log list */}
      <div className="rounded-lg border border-border bg-background">
        {isPending && (
          <p className="p-6 text-center text-sm text-muted-foreground">Ładowanie…</p>
        )}
        {isError && (
          <p className="p-6 text-center text-sm text-destructive">Nie udało się załadować historii.</p>
        )}
        {!isPending && !isError && data && data.results.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">Brak wpisów dla wybranych filtrów.</p>
        )}
        {!isPending && !isError && data && data.results.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>

      {/* Pagination */}
      {data && (data.page > 1 || data.has_more) && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded px-3 py-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            ← Poprzednia
          </button>
          <span className="text-muted-foreground">Strona {data.page}</span>
          <button
            type="button"
            disabled={!data.has_more}
            onClick={() => setPage((p) => p + 1)}
            className="rounded px-3 py-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            Następna →
          </button>
        </div>
      )}
    </div>
  );
}

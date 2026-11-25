import { useState } from 'react';
import { useAuditLogQuery } from '@/query/use-activity';

const plDateTime = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

interface Props {
  objectType: string;
  objectId: string | undefined;
}

export function AuditHistorySection({ objectType, objectId }: Props) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useAuditLogQuery(open ? objectType : '', open ? objectId : undefined);

  const entries = data?.results ?? [];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:rounded-3xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50/60"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth={1.75}>
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-slate-900">Historia zmian</span>
        </div>
        <svg
          viewBox="0 0 24 24" fill="none"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          stroke="currentColor" strokeWidth={2}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-200">
          {isLoading && (
            <p className="px-4 py-3 text-sm text-slate-400">Ładowanie…</p>
          )}
          {!isLoading && entries.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">Brak zapisanych zmian.</p>
          )}
          {!isLoading && entries.length > 0 && (
            <div className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <div key={entry.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{entry.action_label}</p>
                      {entry.changes.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {entry.changes.map((c, i) => (
                            <li key={i} className="text-xs text-slate-500">{c}</li>
                          ))}
                        </ul>
                      )}
                      {entry.user_display && (
                        <p className="mt-0.5 text-xs text-slate-400">{entry.user_display}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400 whitespace-nowrap">
                      {plDateTime.format(new Date(entry.created_at))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

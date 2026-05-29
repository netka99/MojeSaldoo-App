import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useVanRouteListQuery } from '@/query/use-van-routes';
import { cn } from '@/lib/utils';
import type { VanRouteListItem, VanRouteStatus } from '@/types';

/* ─── Helpers ────────────────────────────────────────────────────── */

const STATUS_STYLE: Record<VanRouteStatus, string> = {
  planned: 'bg-gray-100 text-gray-600',
  loading: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-emerald-100 text-emerald-700',
  settling: 'bg-amber-100 text-amber-700',
  closed: 'bg-gray-100 text-gray-500',
};

/* ─── Route card ─────────────────────────────────────────────────── */

function RouteCard({ route, onClick }: { route: VanRouteListItem; onClick: () => void }) {
  const closed = route.status === 'closed';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-4 rounded-2xl bg-surface-card px-4 py-4 shadow-soft text-left transition-all active:scale-[0.98]',
        closed && 'opacity-60',
      )}
    >
      {/* Date block */}
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
        <span className="text-[11px] font-semibold uppercase leading-none">
          {new Date(route.date + 'T00:00:00').toLocaleDateString('pl-PL', { month: 'short' })}
        </span>
        <span className="text-[20px] font-bold leading-tight">
          {new Date(route.date + 'T00:00:00').getDate()}
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground">
          {route.van_name || route.van_warehouse_code}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {route.driver_name || '—'} · {route.order_count}{' '}
          {route.order_count === 1 ? 'przystanek' : route.order_count < 5 ? 'przystanki' : 'przystanków'}
        </p>
        {route.mm_document_number && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{route.mm_document_number}</p>
        )}
      </div>

      {/* Status badge */}
      <span
        className={cn(
          'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
          STATUS_STYLE[route.status],
        )}
      >
        {route.status_display}
      </span>
    </button>
  );
}

/* ─── Main page ──────────────────────────────────────────────────── */

export function VanRoutesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: routes = [], isLoading } = useVanRouteListQuery();

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const active = routes.filter((r) => r.status !== 'closed');
  const closed = routes.filter((r) => r.status === 'closed');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Trasy Vana</h1>
        <button
          type="button"
          onClick={() => navigate('/van-routes/new')}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
          aria-label="Nowa trasa"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4 pb-[calc(83px+env(safe-area-inset-bottom))] md:pb-4">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-16" role="status" aria-busy>
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
            <span className="text-sm text-muted-foreground">Ładowanie…</span>
          </div>
        )}

        {!isLoading && routes.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-muted-foreground" stroke="currentColor" strokeWidth={1.5}>
                <path d="M1 3h15v13H1zM16 8l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-foreground">Brak tras</p>
              <p className="mt-1 text-sm text-muted-foreground">Utwórz pierwszą trasę vana</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/van-routes/new')}
              className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              + Nowa trasa
            </button>
          </div>
        )}

        {!isLoading && active.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Aktywne ({active.length})
            </h2>
            <div className="flex flex-col gap-2">
              {active.map((r) => (
                <RouteCard key={r.id} route={r} onClick={() => navigate(`/van-routes/${r.id}`)} />
              ))}
            </div>
          </section>
        )}

        {!isLoading && closed.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Zamknięte ({closed.length})
            </h2>
            <div className="flex flex-col gap-2">
              {closed.map((r) => (
                <RouteCard key={r.id} route={r} onClick={() => navigate(`/van-routes/${r.id}`)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

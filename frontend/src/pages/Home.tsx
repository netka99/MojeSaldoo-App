import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { useDashboardSummaryQuery } from '@/query/use-reports';
import { cn } from '@/lib/utils';
import type { ModuleName } from '@/types';

const MotionLink = motion.create(Link);

function initialsFromUser(first?: string | null, last?: string | null, username?: string): string {
  const f = first?.trim().charAt(0);
  const l = last?.trim().charAt(0);
  if (f && l) return `${f}${l}`.toUpperCase();
  if (f) return f.toUpperCase();
  const u = username?.trim();
  if (u && u.length >= 2) return u.slice(0, 2).toUpperCase();
  if (u) return u.slice(0, 1).toUpperCase();
  return '?';
}

function IconBell({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTileOrder({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="21" r="1" stroke="currentColor" strokeWidth="2" />
      <circle cx="20" cy="21" r="1" stroke="currentColor" strokeWidth="2" />
      <path
        d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTileReconciliation({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTileVan({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18h2M15 6h5l3 4v8h-3M6 18v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="18" r="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="17" cy="18" r="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconTileWZ({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTileAnalytics({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTileProducts({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const VAN_STATUS_LABELS: Record<string, string> = {
  loading: 'Ładowanie',
  in_progress: 'W trasie',
  settling: 'Rozliczanie',
};

interface DashboardTileDef {
  key: string
  label: string
  to: string
  module: ModuleName
  Icon: (props: { className?: string }) => React.ReactElement
}

const DASHBOARD_TILES: DashboardTileDef[] = [
  { key: 'order', label: 'Zamówienia', to: '/orders', module: 'orders', Icon: IconTileOrder },
  {
    key: 'zestawienie',
    label: 'Zestawienie',
    to: '/delivery',
    module: 'delivery',
    Icon: IconTileReconciliation,
  },
  { key: 'van', label: 'Załaduj Van', to: '/van-routes', module: 'delivery', Icon: IconTileVan },
  { key: 'wz', label: 'WZ', to: '/delivery', module: 'delivery', Icon: IconTileWZ },
  { key: 'analytics', label: 'Analityka', to: '/reports', module: 'reporting', Icon: IconTileAnalytics },
  { key: 'products', label: 'Produkty', to: '/products', module: 'products', Icon: IconTileProducts },
];

function StatCard({
  label,
  value,
  sub,
  accent,
  to,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'red' | 'amber' | 'blue';
  to?: string;
}) {
  const accentClass =
    accent === 'red'
      ? 'border-red-200 bg-red-50'
      : accent === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : accent === 'blue'
          ? 'border-blue-100 bg-blue-50'
          : 'border-transparent bg-surface-card';

  const inner = (
    <div className={cn('rounded-2xl border p-4', accentClass)}>
      <p className="text-xs font-medium text-on-surface-variant">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-bold leading-none',
          accent === 'red'
            ? 'text-red-700'
            : accent === 'amber'
              ? 'text-amber-700'
              : 'text-on-surface',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-on-surface-variant">{sub}</p>}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="no-underline">
        {inner}
      </Link>
    );
  }
  return inner;
}

export const Home: React.FC = () => {
  const { user } = useAuth();
  const ordersEnabled = useModuleGuard('orders');
  const deliveryEnabled = useModuleGuard('delivery');
  const reportingEnabled = useModuleGuard('reporting');
  const productsEnabled = useModuleGuard('products');

  const moduleEnabled: Record<ModuleName, boolean> = {
    customers: useModuleGuard('customers'),
    orders: ordersEnabled,
    products: productsEnabled,
    warehouses: useModuleGuard('warehouses'),
    delivery: deliveryEnabled,
    invoicing: useModuleGuard('invoicing'),
    reporting: reportingEnabled,
    ksef: useModuleGuard('ksef'),
  };

  const dashQ = useDashboardSummaryQuery();
  const d = dashQ.data;

  const displayName = user?.first_name?.trim() || user?.username?.trim() || 'Anna';
  const shortGreetingName = displayName.split(/\s+/)[0] ?? displayName;
  const initials = initialsFromUser(user?.first_name, user?.last_name, user?.username);

  const overdueCount = d?.invoices_overdue.count ?? 0;
  const overdueTotal = d ? Number.parseFloat(d.invoices_overdue.total_gross) : 0;
  const overdueTotalFmt = Number.isNaN(overdueTotal)
    ? '—'
    : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(overdueTotal);

  return (
    <div className="min-h-full bg-surface pb-6">
      <header className="flex items-center justify-between px-4 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-semibold text-primary"
            aria-hidden
          >
            {initials}
          </div>
          <span className="truncate text-sm font-medium text-on-surface">
            Witaj {shortGreetingName}
          </span>
        </div>
        <button
          type="button"
          className="rounded-full p-2 text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          aria-label="Powiadomienia"
        >
          <IconBell className="h-6 w-6" />
        </button>
      </header>

      <section className="px-4 pb-6 pt-2">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-on-surface">
          Witaj {shortGreetingName}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Oto podsumowanie najważniejszych informacji z dzisiaj.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 px-4">
        {DASHBOARD_TILES.map(({ key, label, to, module, Icon }) => {
          const enabled = moduleEnabled[module];
          const tileInner = (
            <>
              <span className="flex rounded-full bg-primary-light p-3">
                <Icon className="h-6 w-6 text-primary" />
              </span>
              <span className="text-[13px] font-medium leading-snug text-on-surface">{label}</span>
            </>
          );
          const tileClass =
            'flex flex-col items-center gap-2 rounded-2xl bg-surface-card p-5 text-center outline-none transition-opacity';

          if (!enabled) {
            return (
              <div
                key={key}
                className={cn(tileClass, 'cursor-not-allowed opacity-40')}
                aria-disabled="true"
              >
                {tileInner}
              </div>
            );
          }

          return (
            <MotionLink
              key={key}
              to={to}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.1 }}
              className={cn(
                tileClass,
                'no-underline active:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              )}
            >
              {tileInner}
            </MotionLink>
          );
        })}
      </section>

      {/* Operational stats */}
      <section className="mt-6 grid grid-cols-2 gap-3 px-4">
        <StatCard
          label="Zamówienia do potwierdzenia"
          value={d ? d.orders_pending_confirmation : '—'}
          accent={d && d.orders_pending_confirmation > 0 ? 'amber' : undefined}
          to="/orders"
        />
        <StatCard
          label="WZ w trasie"
          value={d ? d.wz_in_transit : '—'}
          accent={d && d.wz_in_transit > 0 ? 'blue' : undefined}
          to="/delivery"
        />
        <StatCard
          label="Przeterminowane faktury"
          value={d ? overdueCount : '—'}
          sub={d && overdueCount > 0 ? overdueTotalFmt : undefined}
          accent={d && overdueCount > 0 ? 'red' : undefined}
          to="/invoices"
        />
        <StatCard
          label="Produkty poniżej min."
          value={d ? d.low_stock_alerts.length : '—'}
          accent={d && d.low_stock_alerts.length > 0 ? 'red' : undefined}
          to="/products"
        />
      </section>

      {/* Today's van routes */}
      {(d?.van_routes_today.length ?? 0) > 0 && (
        <section className="mt-6 px-4">
          <h2 className="mb-2 text-base font-semibold text-on-surface">Trasy dzisiaj</h2>
          <ul className="list-none space-y-2 p-0">
            {d!.van_routes_today.map((route) => (
              <li key={route.id}>
                <Link
                  to={`/van-routes/${route.id}`}
                  className="flex items-center justify-between rounded-2xl bg-surface-card px-4 py-3 no-underline"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-on-surface">{route.driver_name}</p>
                    <p className="truncate text-xs text-on-surface-variant">{route.van_name}</p>
                  </div>
                  <span className="ml-3 shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    {VAN_STATUS_LABELS[route.status] ?? route.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Low stock alerts */}
      {(d?.low_stock_alerts.length ?? 0) > 0 && (
        <section className="mt-6 px-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-on-surface">Niski stan magazynowy</h2>
            <Link to="/products" className="shrink-0 text-sm font-medium text-primary no-underline hover:underline">
              Wszystkie
            </Link>
          </div>
          <ul className="mt-2 list-none space-y-2 p-0">
            {d!.low_stock_alerts.map((row) => (
              <li
                key={`${row.product_id}-${row.warehouse__id}`}
                className="flex items-center justify-between rounded-2xl bg-red-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-on-surface">{row.product__name}</p>
                  <p className="truncate text-xs text-on-surface-variant">{row.warehouse__name}</p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className="text-sm font-semibold text-red-700">
                    {Number(row.quantity_available).toLocaleString('pl-PL')}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    min. {Number(row.product__min_stock_alert).toLocaleString('pl-PL')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useModuleGuard } from '@/hooks/useModuleGuard';
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

function IconActivityOrder({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MOCK_ACTIVITY: { id: string; title: string; time: string; Icon: (p: { className?: string }) => React.ReactElement }[] = [
  { id: '1', title: 'Nowe zamówienie #1042', time: '2 min temu', Icon: IconActivityOrder },
  { id: '2', title: 'WZ-2024/089 — wydano', time: '15 min temu', Icon: IconTileWZ },
  { id: '3', title: 'Faktura VAT opłacona', time: '1 godz. temu', Icon: IconActivityOrder },
];

interface DashboardTileDef {
  key: string
  label: string
  to: string
  module: ModuleName
  Icon: (props: { className?: string }) => React.ReactElement
}

const DASHBOARD_TILES: DashboardTileDef[] = [
  { key: 'order', label: 'Zamówienie', to: '/orders/new', module: 'orders', Icon: IconTileOrder },
  {
    key: 'zestawienie',
    label: 'Zestawienie',
    to: '/delivery/van-reconciliation',
    module: 'delivery',
    Icon: IconTileReconciliation,
  },
  { key: 'van', label: 'Załaduj Van', to: '/delivery/van-loading', module: 'delivery', Icon: IconTileVan },
  { key: 'wz', label: 'WZ', to: '/delivery', module: 'delivery', Icon: IconTileWZ },
  { key: 'analytics', label: 'Analityka', to: '/reports', module: 'reporting', Icon: IconTileAnalytics },
  { key: 'products', label: 'Produkty', to: '/products', module: 'products', Icon: IconTileProducts },
];

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

  const displayName = user?.first_name?.trim() || user?.username?.trim() || 'Anna';
  const shortGreetingName = displayName.split(/\s+/)[0] ?? displayName;
  const initials = initialsFromUser(user?.first_name, user?.last_name, user?.username);

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

      <section className="mt-8 px-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-on-surface">Ostatnia aktywność</h2>
          <Link to="/orders" className="shrink-0 text-sm font-medium text-primary no-underline hover:underline">
            Zobacz wszystko
          </Link>
        </div>
        <ul className="mt-2 list-none p-0" aria-label="Ostatnia aktywność">
          {MOCK_ACTIVITY.map(({ id, title, time, Icon }) => (
            <li key={id} className="flex gap-3 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light">
                <Icon className="h-5 w-5 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug text-on-surface">{title}</p>
                <p className="mt-0.5 text-xs text-on-surface-variant">{time}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-2 px-4">
        <div className="rounded-3xl bg-primary p-6">
          <p className="text-sm font-medium text-white/70">Dzisiejsza Sprzedaż</p>
          <p className="mt-2 text-[2.75rem] font-bold tracking-tight text-white">12,450.00 PLN</p>
          <p className="mt-4 inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white">
            +12% vs wczoraj
          </p>
        </div>
      </section>
    </div>
  );
};

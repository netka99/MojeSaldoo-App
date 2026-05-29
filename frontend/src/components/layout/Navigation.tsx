import type { ReactNode, ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { cn } from '@/lib/utils';
import type { ModuleName } from '@/types';

const itemClass = cn(
  'flex w-full items-center rounded-2xl px-3 py-2 text-sm font-medium transition-colors',
  'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
);

const activeItemClass = 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground';

function useNavActive(to: string, end?: boolean) {
  const { pathname } = useLocation();
  if (end) {
    return pathname === to;
  }
  if (to === '/' || to === '') {
    return pathname === '/';
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export interface AppNavItemLinkProps {
  to: string
  end?: boolean
  children: ReactNode
  className?: string
}

/** Primary nav link (no module check). */
export function AppNavItemLink({ to, end, children, className }: AppNavItemLinkProps) {
  const active = useNavActive(to, end);
  return (
    <Link to={to} className={cn(itemClass, active && activeItemClass, className)}>
      {children}
    </Link>
  );
}

export interface ModuleNavItemProps {
  module: ModuleName
  to: string
  end?: boolean
  children: ReactNode
  className?: string
}

/** Renders a nav link only if `module` is enabled for the current company. */
export function ModuleNavItem({ module, to, end, children, className }: ModuleNavItemProps) {
  const enabled = useModuleGuard(module);
  if (!enabled) {
    return null;
  }
  return (
    <AppNavItemLink to={to} end={end} className={className}>
      {children}
    </AppNavItemLink>
  );
}

export interface NavGroupTitleProps {
  children: ReactNode
}

export function NavGroupTitle({ children }: NavGroupTitleProps) {
  return (
    <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" role="presentation">
      {children}
    </p>
  );
}

/** Icons for bottom nav (outline vs filled). */
function IconHomeOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 22V12h6v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHomeFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5z" />
    </svg>
  );
}

function IconCartOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="21" r="1" stroke="currentColor" strokeWidth="2" />
      <circle cx="19" cy="21" r="1" stroke="currentColor" strokeWidth="2" />
      <path
        d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCartFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 18c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM1 2v2h2l3.6 7.59-1.35 2.45c-.15.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03L21.7 4H5.21l-.94-2H1zm16 16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  );
}

function IconFileTextOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFileTextFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8v-2zm0-4h8v2H8v-2zm0-4h5v2H8V7z" />
    </svg>
  );
}

function IconSettingsOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconVanOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3h15v13H1z" />
      <path d="M16 8l5 5-5 5" />
      <circle cx="5.5" cy="18.5" r="1.5" />
      <circle cx="18.5" cy="18.5" r="1.5" />
    </svg>
  );
}

function IconVanFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <path d="M16 8l5 5-5 5V8z" />
      <circle cx="5.5" cy="18.5" r="1.5" />
      <circle cx="18.5" cy="18.5" r="1.5" />
    </svg>
  );
}

function IconSettingsFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.66a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.09 7.09 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.6.24-1.17.55-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.66c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.43 1.09.74 1.69.98l.38 2.65a.5.5 0 0 0 .49.42h4a.5.5 0 0 0 .49-.42l.38-2.65c.6-.24 1.17-.55 1.69-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.66z" />
    </svg>
  );
}

type BottomNavIcon = (props: { className?: string }) => ReactElement;

interface BottomNavItemProps {
  to: string
  end?: boolean
  /** When set, tab is active for this path and any child segment (e.g. `/settings`). */
  activePathPrefix?: string
  label: string
  IconOutline: BottomNavIcon
  IconFilled: BottomNavIcon
}

function BottomNavItem({ to, end, activePathPrefix, label, IconOutline, IconFilled }: BottomNavItemProps) {
  const { pathname } = useLocation();
  const routeActive = useNavActive(to, end);
  const prefixActive =
    activePathPrefix != null &&
    (pathname === activePathPrefix || pathname.startsWith(`${activePathPrefix}/`));
  const active = prefixActive || (!activePathPrefix && routeActive);
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-center no-underline outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="relative flex min-h-[2.5rem] items-center justify-center px-4 py-1">
        <AnimatePresence>
          {active ? (
            <motion.span
              key={`pill-${to}`}
              aria-hidden
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="absolute inset-0 rounded-full bg-primary-light"
              style={{ transformOrigin: '50% 50%' }}
            />
          ) : null}
        </AnimatePresence>
        <span className="relative z-10 flex items-center justify-center">
          {active ? (
            <IconFilled className="h-6 w-6 shrink-0 text-primary" />
          ) : (
            <IconOutline className="h-6 w-6 shrink-0 text-on-surface-variant" />
          )}
        </span>
      </span>
      <span
        className={cn(
          'truncate text-xs font-medium leading-none',
          active ? 'text-primary' : 'text-on-surface-variant',
        )}
      >
        {label}
      </span>
    </Link>
  );
}

const bottomNavBarClass = cn(
  'fixed bottom-0 left-0 right-0 z-50',
  'flex items-center justify-around',
  'h-[83px] pb-[env(safe-area-inset-bottom)]',
  'px-4',
  'bg-surface-card/80 backdrop-blur-xl',
  'border-t-0',
  'shadow-[0_-1px_0_rgba(0,0,0,0.05)]',
  'md:hidden',
);

/** Mobile-first glass bottom nav; sidebar stays visible from `md` up. */
export function BottomNav() {
  const ordersEnabled = useModuleGuard('orders');
  const deliveryEnabled = useModuleGuard('delivery');
  const invoicingEnabled = useModuleGuard('invoicing');

  return (
    <nav className={bottomNavBarClass} aria-label="Menu dolne">
      <BottomNavItem to="/" end label="Pulpit" IconOutline={IconHomeOutline} IconFilled={IconHomeFilled} />
      {ordersEnabled ? (
        <BottomNavItem to="/orders" label="Sprzedaż" IconOutline={IconCartOutline} IconFilled={IconCartFilled} />
      ) : null}
      {deliveryEnabled ? (
        <BottomNavItem to="/van-routes" label="Trasy" IconOutline={IconVanOutline} IconFilled={IconVanFilled} />
      ) : null}
      {invoicingEnabled ? (
        <BottomNavItem to="/invoices" label="Faktury" IconOutline={IconFileTextOutline} IconFilled={IconFileTextFilled} />
      ) : null}
      <BottomNavItem
        to="/settings/company"
        end
        activePathPrefix="/settings"
        label="Ustawienia"
        IconOutline={IconSettingsOutline}
        IconFilled={IconSettingsFilled}
      />
    </nav>
  );
}

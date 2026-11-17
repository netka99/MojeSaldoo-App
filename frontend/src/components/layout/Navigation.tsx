import type { ReactNode, ReactElement } from 'react';
import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { ModuleName } from '@/types';

type NavGlyphName =
  | 'grid' | 'user' | 'clipboard' | 'file' | 'filePlus' | 'clock' | 'banknote' | 'truck'
  | 'box' | 'warehouse' | 'layers' | 'check' | 'minus' | 'building' | 'cart' | 'inbox'
  | 'files' | 'scan' | 'factory' | 'book' | 'wallet' | 'tag' | 'calendar' | 'chart'
  | 'trend' | 'percent' | 'users' | 'receipt' | 'history' | 'gear' | 'list';

export function NavGlyph({ name }: { name: NavGlyphName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
      {name === 'grid' && (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </>
      )}
      {name === 'user' && (
        <>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </>
      )}
      {name === 'clipboard' && (
        <>
          <path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="2" width="6" height="4" rx="1" />
        </>
      )}
      {name === 'file' && (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h5" />
        </>
      )}
      {name === 'filePlus' && (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M12 11v6M9 14h6" />
        </>
      )}
      {name === 'clock' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === 'banknote' && (
        <>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 10v.01M18 14v.01" />
        </>
      )}
      {name === 'truck' && (
        <>
          <path d="M1 7h13v10H1z" />
          <path d="M14 11h4l3 3v3h-7" />
          <circle cx="5.5" cy="18.5" r="1.5" />
          <circle cx="18.5" cy="18.5" r="1.5" />
        </>
      )}
      {name === 'box' && (
        <>
          <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
          <path d="M3.3 8 12 13l8.7-5M12 13v8" />
        </>
      )}
      {name === 'warehouse' && (
        <>
          <path d="M3 21V10l9-6 9 6v11" />
          <path d="M9 21v-6h6v6" />
        </>
      )}
      {name === 'layers' && (
        <>
          <path d="m12 2 9 5-9 5L3 7l9-5z" />
          <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
        </>
      )}
      {name === 'check' && (
        <>
          <path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <path d="m9 14 2 2 4-4" />
        </>
      )}
      {name === 'minus' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8" />
        </>
      )}
      {name === 'building' && (
        <>
          <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
          <path d="M15 9h4a1 1 0 0 1 1 1v11M8 8h2M8 12h2M8 16h2" />
        </>
      )}
      {name === 'cart' && (
        <>
          <circle cx="8" cy="20" r="1" />
          <circle cx="18" cy="20" r="1" />
          <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H7" />
        </>
      )}
      {name === 'inbox' && (
        <>
          <path d="M22 12h-6l-2 3H10l-2-3H2" />
          <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
        </>
      )}
      {name === 'files' && (
        <>
          <path d="M15 2H7a2 2 0 0 0-2 2v14" />
          <path d="M9 6h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
        </>
      )}
      {name === 'scan' && (
        <>
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
        </>
      )}
      {name === 'factory' && (
        <>
          <path d="M2 21h20M4 21V10l6 4V10l6 4V6l4 3v12" />
        </>
      )}
      {name === 'book' && (
        <>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </>
      )}
      {name === 'wallet' && (
        <>
          <rect x="2" y="6" width="20" height="14" rx="2" />
          <path d="M2 10h20M16 14h2" />
        </>
      )}
      {name === 'tag' && (
        <>
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
          <circle cx="7" cy="7" r="1.5" />
        </>
      )}
      {name === 'calendar' && (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </>
      )}
      {name === 'chart' && (
        <>
          <path d="M3 3v18h18" />
          <path d="m7 14 4-4 3 3 5-6" />
        </>
      )}
      {name === 'trend' && (
        <>
          <path d="m3 17 6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </>
      )}
      {name === 'percent' && (
        <>
          <circle cx="7.5" cy="7.5" r="2.5" />
          <circle cx="16.5" cy="16.5" r="2.5" />
          <path d="m19 5-14 14" />
        </>
      )}
      {name === 'users' && (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      )}
      {name === 'receipt' && (
        <>
          <path d="M4 2h16v20l-2-1.5L16 22l-2-1.5L12 22l-2-1.5L8 22l-2-1.5L4 22V2z" />
          <path d="M8 7h8M8 11h8M8 15h5" />
        </>
      )}
      {name === 'history' && (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5M12 7v5l3 2" />
        </>
      )}
      {name === 'gear' && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </>
      )}
      {name === 'list' && (
        <>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </>
      )}
    </svg>
  );
}



const itemClass = cn(
  'flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-sm font-medium transition-colors',
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
  icon?: ReactNode
}

/** Primary nav link (no module check). */
export function AppNavItemLink({ to, end, children, className, icon }: AppNavItemLinkProps) {
  const active = useNavActive(to, end);
  return (
    <Link to={to} className={cn(itemClass, active && activeItemClass, className)}>
      {icon}
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
  icon?: ReactNode
}

/** Renders a nav link only if `module` is enabled for the current company. */
export function ModuleNavItem({ module, to, end, children, className, icon }: ModuleNavItemProps) {
  const enabled = useModuleGuard(module);
  if (!enabled) {
    return null;
  }
  return (
    <AppNavItemLink to={to} end={end} className={className} icon={icon}>
      {children}
    </AppNavItemLink>
  );
}

export interface NavGroupTitleProps {
  children: ReactNode
}

export function NavGroupTitle({ children }: NavGroupTitleProps) {
  return (
    <p className="mx-1.5 mb-1 border-b border-slate-200 px-1.5 pb-1.5 pt-1 text-sm font-medium text-slate-800" role="presentation">
      {children}
    </p>
  );
}

/** One topic in the side menu: a flat card, so groups do not read as one list. */
export function NavGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-1.5">
      {title ? <NavGroupTitle>{title}</NavGroupTitle> : null}
      <div className="space-y-0.5">{children}</div>
    </section>
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
  'flex items-center justify-evenly',
  'h-[83px] pb-[env(safe-area-inset-bottom)]',
  'px-4',
  'bg-surface-card/80 backdrop-blur-xl',
  'border-t-0',
  'shadow-[0_-1px_0_rgba(0,0,0,0.05)]',
  'md:hidden',
);

function IconMenuOutline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Full-screen drawer shown when "Więcej" is tapped on mobile. */
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  // Close drawer on navigation
  useEffect(() => { onClose(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSettings = user?.is_company_admin || user?.permissions?.can_manage_settings;
  const canTeam = user?.is_company_admin || user?.permissions?.can_manage_team;

  const deliveryEnabled = useModuleGuard('delivery');
  const invoicingEnabled = useModuleGuard('invoicing');
  const ksefEnabled = useModuleGuard('ksef');
  const purchasingEnabled = useModuleGuard('purchasing');
  const productsEnabled = useModuleGuard('products');
  const warehousesEnabled = useModuleGuard('warehouses');
  const customersEnabled = useModuleGuard('customers');
  const ordersEnabled = useModuleGuard('orders');
  const reportingEnabled = useModuleGuard('reporting');
  const costAllocationEnabled = useModuleGuard('cost_allocation');
  const productionEnabled = useModuleGuard('production');

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[55] bg-black/40 md:hidden"
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.div
            key="drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="fixed inset-y-0 left-0 z-[60] flex w-72 flex-col overflow-hidden bg-background shadow-xl md:hidden"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-base font-semibold">Menu</span>
              <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Zamknij menu">
                <IconClose className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <NavGroup>
                <AppNavItemLink to="/" end icon={<NavGlyph name="grid" />}>Pulpit</AppNavItemLink>
              </NavGroup>

              {(customersEnabled || ordersEnabled || invoicingEnabled || reportingEnabled) && (
                <NavGroup title="Sprzedaż">
                  {customersEnabled && <AppNavItemLink to="/customers" icon={<NavGlyph name="user" />}>Klienci</AppNavItemLink>}
                  {ordersEnabled && <AppNavItemLink to="/orders" icon={<NavGlyph name="clipboard" />}>Zamówienia</AppNavItemLink>}
                  {invoicingEnabled && <AppNavItemLink to="/invoices" end icon={<NavGlyph name="file" />}>Lista faktur</AppNavItemLink>}
                  {invoicingEnabled && <AppNavItemLink to="/invoices/new" className="pl-7 text-muted-foreground" icon={<NavGlyph name="filePlus" />}>Nowa faktura</AppNavItemLink>}
                  {reportingEnabled && <AppNavItemLink to="/reports/payment-aging" icon={<NavGlyph name="clock" />}>Niezapłacone faktury</AppNavItemLink>}
                  <AppNavItemLink to="/cash-flow/sprzedaz" icon={<NavGlyph name="banknote" />}>Sprzedaż gotówkowa</AppNavItemLink>
                </NavGroup>
              )}

              {deliveryEnabled && (
                <NavGroup title="Dostawa">
                  <AppNavItemLink to="/van-routes" icon={<NavGlyph name="truck" />}>Trasy Vana</AppNavItemLink>
                  <AppNavItemLink to="/delivery" icon={<NavGlyph name="file" />}>Dokumenty dostawy</AppNavItemLink>
                </NavGroup>
              )}

              {(productsEnabled || warehousesEnabled) && (
                <NavGroup title="Magazyn">
                  {productsEnabled && <AppNavItemLink to="/products" icon={<NavGlyph name="box" />}>Produkty</AppNavItemLink>}
                  {warehousesEnabled && <AppNavItemLink to="/warehouses" icon={<NavGlyph name="warehouse" />}>Magazyny</AppNavItemLink>}
                  {!warehousesEnabled && productsEnabled && <AppNavItemLink to="/stock" icon={<NavGlyph name="layers" />}>Stany</AppNavItemLink>}
                  {productsEnabled && <AppNavItemLink to="/inventory" icon={<NavGlyph name="check" />}>Inwentaryzacja</AppNavItemLink>}
                  {warehousesEnabled && <AppNavItemLink to="/delivery/new-rw" icon={<NavGlyph name="minus" />}>Odpisy (RW)</AppNavItemLink>}
                </NavGroup>
              )}

              {(purchasingEnabled || ksefEnabled) && (
                <NavGroup title="Zakupy">
                  {purchasingEnabled && <AppNavItemLink to="/suppliers" icon={<NavGlyph name="building" />}>Dostawcy</AppNavItemLink>}
                  {purchasingEnabled && <AppNavItemLink to="/delivery/new-pz" icon={<NavGlyph name="inbox" />}>Nowe PZ</AppNavItemLink>}
                  {ksefEnabled && <AppNavItemLink to="/ksef/inbox" icon={<NavGlyph name="files" />}>Odebrane faktury</AppNavItemLink>}
                  {ksefEnabled && <AppNavItemLink to="/purchase-documents" icon={<NavGlyph name="files" />}>Dokumenty zakupowe</AppNavItemLink>}
                  {ksefEnabled && <AppNavItemLink to="/ksef/scan-paper" icon={<NavGlyph name="scan" />}>Skanuj fakturę papierową</AppNavItemLink>}
                </NavGroup>
              )}

              {productionEnabled && (
                <NavGroup title="Produkcja">
                  <AppNavItemLink to="/production/orders" icon={<NavGlyph name="factory" />}>Zlecenia produkcji</AppNavItemLink>
                  <AppNavItemLink to="/production/recipes" icon={<NavGlyph name="book" />}>Receptury</AppNavItemLink>
                </NavGroup>
              )}

              <NavGroup title="Finanse">
                <AppNavItemLink to="/cash-flow" icon={<NavGlyph name="wallet" />}>Saldo i Podatki</AppNavItemLink>
                <AppNavItemLink to="/fixed-costs" icon={<NavGlyph name="calendar" />}>Koszty Stałe</AppNavItemLink>
                {costAllocationEnabled && (
                  <AppNavItemLink to="/cost-allocation" icon={<NavGlyph name="tag" />}>Adnotacje kosztowe</AppNavItemLink>
                )}
              </NavGroup>

              {reportingEnabled && (
                <NavGroup title="Raporty">
                  <AppNavItemLink to="/reports" end icon={<NavGlyph name="chart" />}>Przegląd</AppNavItemLink>
                  <AppNavItemLink to="/reports/profit-loss" icon={<NavGlyph name="trend" />}>Zysk i Koszty (P&amp;L)</AppNavItemLink>
                  {purchasingEnabled && <AppNavItemLink to="/reports/product-margin" icon={<NavGlyph name="percent" />}>Marże na produktach</AppNavItemLink>}
                  {purchasingEnabled && <AppNavItemLink to="/reports/customer-margin" icon={<NavGlyph name="users" />}>Marże na klientach</AppNavItemLink>}
                  {purchasingEnabled && <AppNavItemLink to="/reports/supplier-costs" icon={<NavGlyph name="receipt" />}>Koszty zakupów</AppNavItemLink>}
                  {warehousesEnabled && <AppNavItemLink to="/reports/inventory" icon={<NavGlyph name="layers" />}>Stan magazynu</AppNavItemLink>}
                </NavGroup>
              )}

              <NavGroup>
                <AppNavItemLink to="/activity" icon={<NavGlyph name="history" />}>Historia aktywności</AppNavItemLink>
                {canTeam && <AppNavItemLink to="/settings/team" end icon={<NavGlyph name="users" />}>Zespół</AppNavItemLink>}
              </NavGroup>
            </nav>

            <div className="shrink-0 space-y-0.5 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {canSettings && <AppNavItemLink to="/settings/company" end icon={<NavGlyph name="gear" />}>Ustawienia</AppNavItemLink>}
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate('/login', { replace: true });
                }}
                className="flex w-full items-center rounded-2xl px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Wyloguj
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Mobile-first glass bottom nav; sidebar stays visible from `md` up. */
export function BottomNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ordersEnabled = useModuleGuard('orders');
  const deliveryEnabled = useModuleGuard('delivery');
  const invoicingEnabled = useModuleGuard('invoicing');

  return (
    <>
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
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
        {/* Więcej drawer trigger */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-center outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label="Więcej opcji"
        >
          <span className="flex min-h-[2.5rem] items-center justify-center px-4 py-1">
            <IconMenuOutline className="h-6 w-6 shrink-0 text-on-surface-variant" />
          </span>
          <span className="truncate text-xs font-medium leading-none text-on-surface-variant">Więcej</span>
        </button>
      </nav>
    </>
  );
}

import type { ReactNode, ReactElement } from 'react';
import { useState, useEffect } from 'react';
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
  'flex items-center justify-around',
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
  // Close drawer on navigation
  useEffect(() => { onClose(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

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
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.div
            key="drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-background shadow-xl md:hidden"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-base font-semibold">Menu</span>
              <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Zamknij menu">
                <IconClose className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3 pb-[env(safe-area-inset-bottom)]">
              <div className="space-y-0.5">
                <AppNavItemLink to="/" end>Pulpit</AppNavItemLink>
              </div>

              {(customersEnabled || ordersEnabled) && (
                <div className="space-y-1">
                  <NavGroupTitle>Sprzedaż</NavGroupTitle>
                  <div className="space-y-0.5">
                    {customersEnabled && <AppNavItemLink to="/customers">Klienci</AppNavItemLink>}
                    {ordersEnabled && <AppNavItemLink to="/orders">Zamówienia</AppNavItemLink>}
                  </div>
                </div>
              )}

              {(productsEnabled || warehousesEnabled) && (
                <div className="space-y-1">
                  <NavGroupTitle>Magazyn</NavGroupTitle>
                  <div className="space-y-0.5">
                    {productsEnabled && <AppNavItemLink to="/products">Produkty</AppNavItemLink>}
                    {warehousesEnabled && <AppNavItemLink to="/warehouses">Magazyny</AppNavItemLink>}
                    {warehousesEnabled && <AppNavItemLink to="/inventory">Inwentaryzacja</AppNavItemLink>}
                    {warehousesEnabled && <AppNavItemLink to="/delivery/new-rw">Odpisy (RW)</AppNavItemLink>}
                  </div>
                </div>
              )}

              {(deliveryEnabled || invoicingEnabled || ksefEnabled) && (
                <div className="space-y-1">
                  <NavGroupTitle>Dokumenty</NavGroupTitle>
                  <div className="space-y-0.5">
                    {deliveryEnabled && <AppNavItemLink to="/van-routes">Trasy Vana</AppNavItemLink>}
                    {deliveryEnabled && <AppNavItemLink to="/delivery">Dostawa</AppNavItemLink>}
                    {invoicingEnabled && <AppNavItemLink to="/invoices">Faktury</AppNavItemLink>}
                    {ksefEnabled && <AppNavItemLink to="/ksef">KSeF</AppNavItemLink>}
                    {ksefEnabled && <AppNavItemLink to="/ksef/inbox">Odebrane faktury</AppNavItemLink>}
                    {ksefEnabled && <AppNavItemLink to="/ksef/scan-paper">Skanuj fakturę papierową</AppNavItemLink>}
                  </div>
                </div>
              )}

              {purchasingEnabled && (
                <div className="space-y-1">
                  <NavGroupTitle>Zakupy</NavGroupTitle>
                  <div className="space-y-0.5">
                    <AppNavItemLink to="/suppliers">Dostawcy</AppNavItemLink>
                    <AppNavItemLink to="/delivery/new-pz">Nowe PZ</AppNavItemLink>
                  </div>
                </div>
              )}

              {productionEnabled && (
                <div className="space-y-1">
                  <NavGroupTitle>Produkcja</NavGroupTitle>
                  <div className="space-y-0.5">
                    <AppNavItemLink to="/production/orders">Zlecenia produkcji</AppNavItemLink>
                    <AppNavItemLink to="/production/recipes">Receptury</AppNavItemLink>
                  </div>
                </div>
              )}

              {costAllocationEnabled && (
                <div className="space-y-1">
                  <NavGroupTitle>Księgowość</NavGroupTitle>
                  <div className="space-y-0.5">
                    <AppNavItemLink to="/cost-allocation">Adnotacje kosztowe</AppNavItemLink>
                  </div>
                </div>
              )}

              {reportingEnabled && (
                <div className="space-y-1">
                  <NavGroupTitle>Administracja</NavGroupTitle>
                  <div className="space-y-0.5">
                    <AppNavItemLink to="/reports" end>Raporty</AppNavItemLink>
                    <AppNavItemLink to="/reports/profit-loss">Wynik (P&amp;L)</AppNavItemLink>
                    <AppNavItemLink to="/reports/product-margin">Marże na produktach</AppNavItemLink>
                    <AppNavItemLink to="/reports/payment-aging">Aging należności</AppNavItemLink>
                    <AppNavItemLink to="/reports/supplier-costs">Koszty zakupów</AppNavItemLink>
                    <AppNavItemLink to="/reports/inventory">Magazyn</AppNavItemLink>
                    <AppNavItemLink to="/reports/customer-margin">Marże na klientach</AppNavItemLink>
                  </div>
                </div>
              )}

              <div className="space-y-1 border-t border-border pt-3">
                <AppNavItemLink to="/settings/company" end>Ustawienia</AppNavItemLink>
                {ksefEnabled && <AppNavItemLink to="/settings/certificate" end>Certyfikat KSeF</AppNavItemLink>}
              </div>
            </nav>
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

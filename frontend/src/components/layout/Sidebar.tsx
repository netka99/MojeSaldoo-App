import { Link } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { CompanySwitcher } from './CompanySwitcher';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AppNavItemLink, ModuleNavItem, NavGroupTitle } from './Navigation';

type NavGlyphName =
  | 'grid' | 'user' | 'clipboard' | 'file' | 'filePlus' | 'clock' | 'banknote' | 'truck'
  | 'box' | 'warehouse' | 'layers' | 'check' | 'minus' | 'building' | 'cart' | 'inbox'
  | 'files' | 'scan' | 'factory' | 'book' | 'wallet' | 'tag' | 'calendar' | 'chart'
  | 'trend' | 'percent' | 'users' | 'receipt' | 'history' | 'gear' | 'list';

function NavGlyph({ name }: { name: NavGlyphName }) {
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

function NavSectionSprzedaz() {
  const customersEnabled = useModuleGuard('customers');
  const ordersEnabled = useModuleGuard('orders');
  const invoicingEnabled = useModuleGuard('invoicing');
  const reportingEnabled = useModuleGuard('reporting');
  const canCustomers = usePermission('can_manage_customers');
  const canOrders = usePermission('can_manage_orders');
  const canInvoices = usePermission('can_manage_invoices');
  const canReports = usePermission('can_view_reports');
  const anyEnabled =
    (customersEnabled && canCustomers) ||
    (ordersEnabled && canOrders) ||
    (invoicingEnabled && canInvoices) ||
    (reportingEnabled && canReports);
  if (!anyEnabled) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Sprzedaż</NavGroupTitle>
      <div className="space-y-0.5">
        {canCustomers && (
          <ModuleNavItem module="customers" to="/customers" icon={<NavGlyph name="user" />}>
            Klienci
          </ModuleNavItem>
        )}
        {canOrders && (
          <ModuleNavItem module="orders" to="/orders" icon={<NavGlyph name="clipboard" />}>
            Zamówienia
          </ModuleNavItem>
        )}
        {canOrders && (
          <ModuleNavItem module="orders" to="/orders/list" icon={<NavGlyph name="list" />}>
            Lista zamówień
          </ModuleNavItem>
        )}
        {canOrders && (
          <ModuleNavItem module="reporting" to="/reports/customer-flow" icon={<NavGlyph name="list" />}>
            Przepływ rozliczeniowy
          </ModuleNavItem>
        )}
        {canInvoices && (
          <ModuleNavItem module="invoicing" to="/invoices" end icon={<NavGlyph name="file" />}>
            Lista faktur
          </ModuleNavItem>
        )}
        {canInvoices && (
          <ModuleNavItem module="invoicing" to="/invoices/new" className="pl-7 text-muted-foreground" icon={<NavGlyph name="filePlus" />}>
            Nowa faktura
          </ModuleNavItem>
        )}
        {reportingEnabled && canReports && (
          <ModuleNavItem module="reporting" to="/reports/payment-aging" icon={<NavGlyph name="clock" />}>
            Niezapłacone faktury
          </ModuleNavItem>
        )}
        <AppNavItemLink to="/sprzedaz" icon={<NavGlyph name="banknote" />}>
          Sprzedaż gotówkowa
        </AppNavItemLink>
      </div>
    </div>
  );
}

function NavSectionMagazyn() {
  const productsEnabled = useModuleGuard('products');
  const warehousesEnabled = useModuleGuard('warehouses');
  const canProducts = usePermission('can_manage_products');
  const canWarehouses = usePermission('can_manage_warehouses');
  const canInventory = usePermission('can_manage_inventory');
  const canRW = usePermission('can_manage_stock_moves');
  const anyEnabled = (productsEnabled && canProducts)
    || (warehousesEnabled && (canWarehouses || canInventory || canRW));
  if (!anyEnabled) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Magazyn</NavGroupTitle>
      <div className="space-y-0.5">
        {canProducts && (
          <ModuleNavItem module="products" to="/products" icon={<NavGlyph name="box" />}>
            Produkty
          </ModuleNavItem>
        )}
        {canWarehouses && (
          <ModuleNavItem module="warehouses" to="/warehouses" icon={<NavGlyph name="warehouse" />}>
            Magazyny
          </ModuleNavItem>
        )}
        {!warehousesEnabled && productsEnabled && (
          <AppNavItemLink to="/stock" icon={<NavGlyph name="layers" />}>
            Stany
          </AppNavItemLink>
        )}
        {canInventory && (
          <ModuleNavItem module="warehouses" to="/inventory" icon={<NavGlyph name="check" />}>
            Inwentaryzacja
          </ModuleNavItem>
        )}
        {canRW && (
          <ModuleNavItem module="warehouses" to="/delivery/new-rw" icon={<NavGlyph name="minus" />}>
            Odpisy (RW)
          </ModuleNavItem>
        )}
      </div>
    </div>
  );
}

function NavSectionDostawa() {
  const deliveryEnabled = useModuleGuard('delivery');
  const canRoutes = usePermission('can_access_routes');
  const canDelivery = usePermission('can_manage_delivery');
  const anyEnabled = deliveryEnabled && (canRoutes || canDelivery);
  if (!anyEnabled) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Dostawa</NavGroupTitle>
      <div className="space-y-0.5">
        {canRoutes && (
          <ModuleNavItem module="delivery" to="/van-routes" icon={<NavGlyph name="truck" />}>
            Trasy Vana
          </ModuleNavItem>
        )}
        {canDelivery && (
          <ModuleNavItem module="delivery" to="/delivery" icon={<NavGlyph name="file" />}>
            Dokumenty dostawy
          </ModuleNavItem>
        )}
      </div>
    </div>
  );
}

function NavSectionZakupy() {
  const purchasingEnabled = useModuleGuard('purchasing');
  const purchaseOrdersEnabled = useModuleGuard('purchase_orders');
  const ksefEnabled = useModuleGuard('ksef');
  const canPurchasing = usePermission('can_manage_purchasing');
  const canPurchaseOrders = usePermission('can_manage_purchase_orders');
  const canKsefInbox = usePermission('can_access_ksef_inbox');
  const canInvoices = usePermission('can_manage_invoices');
  const anyEnabled =
    (purchasingEnabled && canPurchasing) ||
    (purchaseOrdersEnabled && canPurchaseOrders) ||
    (ksefEnabled && (canKsefInbox || canInvoices));
  if (!anyEnabled) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Zakupy</NavGroupTitle>
      <div className="space-y-0.5">
        {purchasingEnabled && canPurchasing && (
          <ModuleNavItem module="purchasing" to="/suppliers" icon={<NavGlyph name="building" />}>
            Dostawcy
          </ModuleNavItem>
        )}
        {purchaseOrdersEnabled && canPurchaseOrders && (
          <ModuleNavItem module="purchase_orders" to="/purchase-orders" icon={<NavGlyph name="cart" />}>
            Zamówienia ZD
          </ModuleNavItem>
        )}
        {purchasingEnabled && canPurchasing && (
          <ModuleNavItem module="purchasing" to="/delivery/new-pz" icon={<NavGlyph name="inbox" />}>
            Nowe PZ
          </ModuleNavItem>
        )}
        {ksefEnabled && canKsefInbox && (
          <ModuleNavItem module="ksef" to="/purchase-documents" icon={<NavGlyph name="files" />}>
            Dokumenty zakupowe
          </ModuleNavItem>
        )}
        {ksefEnabled && canInvoices && (
          <ModuleNavItem module="ksef" to="/ksef/scan-paper" icon={<NavGlyph name="scan" />}>
            Skanuj fakturę papierową
          </ModuleNavItem>
        )}
      </div>
    </div>
  );
}

function NavSectionFinanse() {
  const costAllocationEnabled = useModuleGuard('cost_allocation');
  const canAccounting = usePermission('can_manage_accounting');
  const canReports = usePermission('can_view_reports');
  const showFixedCosts = canReports || canAccounting;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Finanse</NavGroupTitle>
      <div className="space-y-0.5">
        <AppNavItemLink to="/cash-flow" icon={<NavGlyph name="wallet" />}>
          Saldo i Podatki
        </AppNavItemLink>
        {costAllocationEnabled && canAccounting && (
          <ModuleNavItem module="cost_allocation" to="/cost-allocation" icon={<NavGlyph name="tag" />}>
            Adnotacje kosztowe
          </ModuleNavItem>
        )}
        {showFixedCosts && (
          <AppNavItemLink to="/fixed-costs" icon={<NavGlyph name="calendar" />}>
            Koszty Stałe
          </AppNavItemLink>
        )}
      </div>
    </div>
  );
}

function NavSectionProdukcja() {
  const enabled = useModuleGuard('production');
  const canProduction = usePermission('can_manage_production');
  if (!enabled || !canProduction) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Produkcja</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="production" to="/production/orders" icon={<NavGlyph name="factory" />}>
          Zlecenia produkcji
        </ModuleNavItem>
        <ModuleNavItem module="production" to="/production/recipes" icon={<NavGlyph name="book" />}>
          Receptury
        </ModuleNavItem>
      </div>
    </div>
  );
}

function NavSectionRaporty() {
  const reportingEnabled = useModuleGuard('reporting');
  const purchasingEnabled = useModuleGuard('purchasing');
  const warehousesEnabled = useModuleGuard('warehouses');
  const canReports = usePermission('can_view_reports');
  if (!reportingEnabled || !canReports) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Raporty</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="reporting" to="/reports" end icon={<NavGlyph name="chart" />}>
          Przegląd
        </ModuleNavItem>
        {/* P&L always visible — even without purchasing, ryczałt users have fixed costs
            (salaries, ZUS, rent) that need to be reflected in their profit view. */}
        <ModuleNavItem module="reporting" to="/reports/profit-loss" icon={<NavGlyph name="trend" />}>
          Zysk i Koszty (P&amp;L)
        </ModuleNavItem>
        {purchasingEnabled && (
          <ModuleNavItem module="reporting" to="/reports/product-margin" icon={<NavGlyph name="percent" />}>
            Marże na produktach
          </ModuleNavItem>
        )}
        {purchasingEnabled && (
          <ModuleNavItem module="reporting" to="/reports/customer-margin" icon={<NavGlyph name="users" />}>
            Marże na klientach
          </ModuleNavItem>
        )}
        {purchasingEnabled && (
          <ModuleNavItem module="reporting" to="/reports/supplier-costs" icon={<NavGlyph name="receipt" />}>
            Koszty zakupów
          </ModuleNavItem>
        )}
        {warehousesEnabled && (
          <ModuleNavItem module="reporting" to="/reports/inventory" icon={<NavGlyph name="layers" />}>
            Stan magazynu
          </ModuleNavItem>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { isAuthenticated, logout, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canSettings = user?.is_company_admin || user?.permissions?.can_manage_settings;
  const canTeam = user?.is_company_admin || user?.permissions?.can_manage_team;

  return (
    <aside
      className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col self-start border-r border-border bg-background md:flex"
      aria-label="Boczne menu"
    >
      <div className="border-b border-border p-4">
        <div className="text-lg font-semibold text-foreground">MojeSaldoo</div>
        <CompanySwitcher />
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-3" aria-label="Główne">
        <div className="space-y-0.5">
          <AppNavItemLink to="/" end icon={<NavGlyph name="grid" />}>
            Pulpit
          </AppNavItemLink>
        </div>
        <NavSectionSprzedaz />
        <NavSectionDostawa />
        <NavSectionMagazyn />
        <NavSectionZakupy />
        <NavSectionProdukcja />
        <NavSectionFinanse />
        <NavSectionRaporty />
      </nav>

      <div className="space-y-1 border-t border-border p-3">
        <AppNavItemLink to="/activity" icon={<NavGlyph name="history" />}>
          Historia aktywności
        </AppNavItemLink>
        {canSettings && (
          <AppNavItemLink to="/settings/company" end icon={<NavGlyph name="gear" />}>
            Ustawienia
          </AppNavItemLink>
        )}
        {canTeam && (
          <AppNavItemLink to="/settings/team" end icon={<NavGlyph name="users" />}>
            Zespół
          </AppNavItemLink>
        )}
        {isAuthenticated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              logout();
              navigate('/login', { replace: true, state: { from: location.pathname } });
            }}
          >
            Wyloguj
          </Button>
        ) : (
          <Link
            to="/login"
            state={{ from: location.pathname === '/login' ? '/' : location.pathname }}
            className="mt-2 flex h-9 w-full items-center justify-center rounded-md border border-input bg-background text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Zaloguj
          </Link>
        )}
      </div>
    </aside>
  );
}

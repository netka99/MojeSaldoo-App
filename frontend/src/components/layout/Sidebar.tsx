import { Link } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { CompanySwitcher } from './CompanySwitcher';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AppNavItemLink, ModuleNavItem, NavGlyph, NavGroup } from './Navigation';

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
    <NavGroup title="Sprzedaż">
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
        <AppNavItemLink to="/cash-flow/sprzedaz" icon={<NavGlyph name="banknote" />}>
          Sprzedaż gotówkowa
        </AppNavItemLink>
    </NavGroup>
  );
}

function NavSectionMagazyn() {
  const productsEnabled = useModuleGuard('products');
  const warehousesEnabled = useModuleGuard('warehouses');
  const deliveryEnabled = useModuleGuard('delivery');
  const canProducts = usePermission('can_manage_products');
  const canWarehouses = usePermission('can_manage_warehouses');
  const canInventory = usePermission('can_manage_inventory');
  const canRW = usePermission('can_manage_stock_moves');
  const canDelivery = usePermission('can_manage_delivery');
  const hasDocuments = (deliveryEnabled && canDelivery)
    || (warehousesEnabled && canRW);
  const anyEnabled = (productsEnabled && canProducts)
    || (warehousesEnabled && (canWarehouses || canInventory || canRW))
    || hasDocuments;
  if (!anyEnabled) {
    return null;
  }
  return (
    <NavGroup title="Magazyn">
        {canProducts && (
          <ModuleNavItem module="products" to="/products" icon={<NavGlyph name="box" />}>
            Produkty
          </ModuleNavItem>
        )}
        {canProducts && (
          <AppNavItemLink to="/reports/inventory" icon={<NavGlyph name="layers" />}>
            Stan magazynu
          </AppNavItemLink>
        )}
        {canProducts && (
          <AppNavItemLink to="/reports/material-consumption" icon={<NavGlyph name="chart" />}>
            Zużycie surowców
          </AppNavItemLink>
        )}
        {hasDocuments && (
          <AppNavItemLink to="/documents" end icon={<NavGlyph name="files" />}>
            Dokumenty
          </AppNavItemLink>
        )}
        {deliveryEnabled && canDelivery && (
          <AppNavItemLink to="/documents/wz" className="pl-7 text-muted-foreground" icon={<NavGlyph name="truck" />}>
            Wydania (WZ)
          </AppNavItemLink>
        )}
        {warehousesEnabled && canRW && (
          <AppNavItemLink to="/documents/rw" className="pl-7 text-muted-foreground" icon={<NavGlyph name="layers" />}>
            Ruchy (RW/MM)
          </AppNavItemLink>
        )}
        {canWarehouses && (
          <ModuleNavItem module="warehouses" to="/warehouses" icon={<NavGlyph name="warehouse" />}>
            Magazyny
          </ModuleNavItem>
        )}
        {canInventory && productsEnabled && (
          <ModuleNavItem module="products" to="/inventory" icon={<NavGlyph name="check" />}>
            Inwentaryzacja
          </ModuleNavItem>
        )}
        {canRW && (
          <ModuleNavItem module="warehouses" to="/delivery/new-rw" className="pl-7 text-muted-foreground" icon={<NavGlyph name="minus" />}>
            Nowy odpis (RW)
          </ModuleNavItem>
        )}
    </NavGroup>
  );
}

function NavSectionDostawa() {
  const deliveryEnabled = useModuleGuard('delivery');
  const canRoutes = usePermission('can_access_routes');
  if (!deliveryEnabled || !canRoutes) return null;
  return (
    <NavGroup title="Dostawa">
        <ModuleNavItem module="van_routes" to="/van-routes" icon={<NavGlyph name="truck" />}>
          Trasy Vana
        </ModuleNavItem>
    </NavGroup>
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
    <NavGroup title="Zakupy">
        {purchasingEnabled && canPurchasing && (
          <ModuleNavItem module="purchasing" to="/suppliers" icon={<NavGlyph name="building" />}>
            Dostawcy
          </ModuleNavItem>
        )}
        {purchasingEnabled && canPurchasing && (
          <AppNavItemLink to="/documents/pz" className="pl-7 text-muted-foreground" icon={<NavGlyph name="inbox" />}>
            Przyjęcia (PZ)
          </AppNavItemLink>
        )}
        {purchaseOrdersEnabled && canPurchaseOrders && (
          <ModuleNavItem module="purchase_orders" to="/purchase-orders" icon={<NavGlyph name="cart" />}>
            Zamówienia ZD
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
    </NavGroup>
  );
}

function NavSectionFinanse() {
  const costAllocationEnabled = useModuleGuard('cost_allocation');
  const canAccounting = usePermission('can_manage_accounting');
  const canReports = usePermission('can_view_reports');
  const showFixedCosts = canReports || canAccounting;
  return (
    <NavGroup title="Finanse">
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
    </NavGroup>
  );
}

function NavSectionProdukcja() {
  const enabled = useModuleGuard('production');
  const canProduction = usePermission('can_manage_production');
  if (!enabled || !canProduction) return null;
  return (
    <NavGroup title="Produkcja">
        <ModuleNavItem module="production" to="/production/orders" icon={<NavGlyph name="factory" />}>
          Zlecenia produkcji
        </ModuleNavItem>
        <AppNavItemLink to="/documents/zp" className="pl-7 text-muted-foreground" icon={<NavGlyph name="list" />}>
          Lista ZP
        </AppNavItemLink>
        <ModuleNavItem module="production" to="/production/recipes" icon={<NavGlyph name="book" />}>
          Receptury
        </ModuleNavItem>
    </NavGroup>
  );
}

function NavSectionRaporty() {
  const reportingEnabled = useModuleGuard('reporting');
  const purchasingEnabled = useModuleGuard('purchasing');
  const warehousesEnabled = useModuleGuard('warehouses');
  const productsEnabled = useModuleGuard('products');
  const canReports = usePermission('can_view_reports');
  if (!reportingEnabled || !canReports) return null;
  return (
    <NavGroup title="Raporty">
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
    </NavGroup>
  );
}

export function Sidebar({ isDemo }: { isDemo?: boolean }) {
  const { isAuthenticated, logout, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canSettings = user?.is_company_admin || user?.permissions?.can_manage_settings;
  const canTeam = user?.is_company_admin || user?.permissions?.can_manage_team;

  return (
    <aside
      className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col self-start overflow-hidden border-r border-border bg-background md:flex"
      aria-label="Boczne menu"
    >
      {isDemo && (
        <div className="shrink-0 bg-amber-400 py-1 text-center text-xs font-bold uppercase tracking-wide text-amber-900">
          Tryb demo
        </div>
      )}
      <div className="border-b border-border p-4">
        <div className="text-lg font-semibold text-foreground">MojeSaldoo</div>
        <CompanySwitcher />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" aria-label="Główne">
        <NavGroup>
          <AppNavItemLink to="/" end icon={<NavGlyph name="grid" />}>
            Pulpit
          </AppNavItemLink>
        </NavGroup>
        <NavSectionSprzedaz />
        <NavSectionDostawa />
        <NavSectionMagazyn />
        <NavSectionZakupy />
        <NavSectionProdukcja />
        <NavSectionFinanse />
        <NavSectionRaporty />
        <NavGroup>
          <AppNavItemLink to="/activity" icon={<NavGlyph name="history" />}>
            Historia aktywności
          </AppNavItemLink>
          {canTeam && (
            <AppNavItemLink to="/settings/team" end icon={<NavGlyph name="users" />}>
              Zespół
            </AppNavItemLink>
          )}
        </NavGroup>
      </nav>

      <div className="shrink-0 space-y-1 border-t border-border p-3">
        {canSettings && (
          <AppNavItemLink to="/settings/company" end icon={<NavGlyph name="gear" />}>
            Ustawienia
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

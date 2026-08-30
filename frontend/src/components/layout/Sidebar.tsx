import { Link } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { CompanySwitcher } from './CompanySwitcher';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AppNavItemLink, ModuleNavItem, NavGroupTitle } from './Navigation';

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
          <ModuleNavItem module="customers" to="/customers">
            Klienci
          </ModuleNavItem>
        )}
        {canOrders && (
          <ModuleNavItem module="orders" to="/orders">
            Zamówienia
          </ModuleNavItem>
        )}
        {canInvoices && (
          <ModuleNavItem module="invoicing" to="/invoices">
            Faktury
          </ModuleNavItem>
        )}
        {reportingEnabled && canReports && (
          <ModuleNavItem module="reporting" to="/reports/payment-aging">
            Niezapłacone faktury
          </ModuleNavItem>
        )}
        <AppNavItemLink to="/sprzedaz">
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
          <ModuleNavItem module="products" to="/products">
            Produkty
          </ModuleNavItem>
        )}
        {canWarehouses && (
          <ModuleNavItem module="warehouses" to="/warehouses">
            Magazyny
          </ModuleNavItem>
        )}
        {canInventory && (
          <ModuleNavItem module="warehouses" to="/inventory">
            Inwentaryzacja
          </ModuleNavItem>
        )}
        {canRW && (
          <ModuleNavItem module="warehouses" to="/delivery/new-rw">
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
          <ModuleNavItem module="delivery" to="/van-routes">
            Trasy Vana
          </ModuleNavItem>
        )}
        {canDelivery && (
          <ModuleNavItem module="delivery" to="/delivery">
            Dokumenty dostawy
          </ModuleNavItem>
        )}
      </div>
    </div>
  );
}

function NavSectionEFaktury() {
  const ksefEnabled = useModuleGuard('ksef');
  const canInvoices = usePermission('can_manage_invoices');
  const canKsefInbox = usePermission('can_access_ksef_inbox');
  const anyEnabled = ksefEnabled && (canInvoices || canKsefInbox);
  if (!anyEnabled) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>E-Faktury (KSeF)</NavGroupTitle>
      <div className="space-y-0.5">
        {canInvoices && (
          <ModuleNavItem module="ksef" to="/ksef">
            KSeF
          </ModuleNavItem>
        )}
        {canKsefInbox && (
          <ModuleNavItem module="ksef" to="/ksef/inbox">
            Odebrane faktury
          </ModuleNavItem>
        )}
        {canInvoices && (
          <ModuleNavItem module="ksef" to="/ksef/scan-paper">
            Skanuj fakturę papierową
          </ModuleNavItem>
        )}
      </div>
    </div>
  );
}

function NavSectionZakupy() {
  const purchasingEnabled = useModuleGuard('purchasing');
  const canPurchasing = usePermission('can_manage_purchasing');
  if (!purchasingEnabled || !canPurchasing) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Zakupy</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="purchasing" to="/suppliers">
          Dostawcy
        </ModuleNavItem>
        <ModuleNavItem module="purchasing" to="/delivery/new-pz">
          Nowe PZ
        </ModuleNavItem>
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
        <AppNavItemLink to="/cash-flow">
          Saldo i Podatki
        </AppNavItemLink>
        {costAllocationEnabled && canAccounting && (
          <ModuleNavItem module="cost_allocation" to="/cost-allocation">
            Adnotacje kosztowe
          </ModuleNavItem>
        )}
        {showFixedCosts && (
          <AppNavItemLink to="/fixed-costs">
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
        <ModuleNavItem module="production" to="/production/orders">
          Zlecenia produkcji
        </ModuleNavItem>
        <ModuleNavItem module="production" to="/production/recipes">
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
        <ModuleNavItem module="reporting" to="/reports" end>
          Przegląd
        </ModuleNavItem>
        {/* P&L always visible — even without purchasing, ryczałt users have fixed costs
            (salaries, ZUS, rent) that need to be reflected in their profit view. */}
        <ModuleNavItem module="reporting" to="/reports/profit-loss">
          Zysk i Koszty (P&amp;L)
        </ModuleNavItem>
        {purchasingEnabled && (
          <ModuleNavItem module="reporting" to="/reports/product-margin">
            Marże na produktach
          </ModuleNavItem>
        )}
        {purchasingEnabled && (
          <ModuleNavItem module="reporting" to="/reports/customer-margin">
            Marże na klientach
          </ModuleNavItem>
        )}
        {purchasingEnabled && (
          <ModuleNavItem module="reporting" to="/reports/supplier-costs">
            Koszty zakupów
          </ModuleNavItem>
        )}
        {warehousesEnabled && (
          <ModuleNavItem module="reporting" to="/reports/inventory">
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
      className="hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-background md:flex"
      aria-label="Boczne menu"
    >
      <div className="border-b border-border p-4">
        <div className="text-lg font-semibold text-foreground">MojeSaldoo</div>
        <CompanySwitcher />
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-3" aria-label="Główne">
        <div className="space-y-0.5">
          <AppNavItemLink to="/" end>
            Pulpit
          </AppNavItemLink>
        </div>
        <NavSectionSprzedaz />
        <NavSectionDostawa />
        <NavSectionMagazyn />
        <NavSectionZakupy />
        <NavSectionProdukcja />
        <NavSectionEFaktury />
        <NavSectionFinanse />
        <NavSectionRaporty />
      </nav>

      <div className="space-y-1 border-t border-border p-3">
        <AppNavItemLink to="/activity">
          Historia aktywności
        </AppNavItemLink>
        {canSettings && (
          <AppNavItemLink to="/settings/company" end>
            Ustawienia
          </AppNavItemLink>
        )}
        {canTeam && (
          <AppNavItemLink to="/settings/team" end>
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

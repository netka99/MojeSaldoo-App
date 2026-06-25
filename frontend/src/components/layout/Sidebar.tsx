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
  const canCustomers = usePermission('can_manage_customers');
  const canOrders = usePermission('can_manage_orders');
  const anyEnabled = (customersEnabled && canCustomers) || (ordersEnabled && canOrders);
  if (!anyEnabled) {
    return null;
  }
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

function NavSectionDokumenty() {
  const deliveryEnabled = useModuleGuard('delivery');
  const invoicingEnabled = useModuleGuard('invoicing');
  const ksefEnabled = useModuleGuard('ksef');
  const canRoutes = usePermission('can_access_routes');
  const canDelivery = usePermission('can_manage_delivery');
  const canInvoices = usePermission('can_manage_invoices');
  const canKsefInbox = usePermission('can_access_ksef_inbox');
  const anyEnabled = (deliveryEnabled && (canDelivery || canRoutes)) || (invoicingEnabled && canInvoices) || (ksefEnabled && (canInvoices || canKsefInbox));
  if (!anyEnabled) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Dokumenty</NavGroupTitle>
      <div className="space-y-0.5">
        {canRoutes && (
          <ModuleNavItem module="delivery" to="/van-routes">
            Trasy Vana
          </ModuleNavItem>
        )}
        {canDelivery && (
          <ModuleNavItem module="delivery" to="/delivery">
            Dostawa
          </ModuleNavItem>
        )}
        {canInvoices && (
          <ModuleNavItem module="invoicing" to="/invoices">
            Faktury
          </ModuleNavItem>
        )}
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

function NavSectionKsiegowos() {
  const costAllocationEnabled = useModuleGuard('cost_allocation');
  const canAccounting = usePermission('can_manage_accounting');
  if (!costAllocationEnabled || !canAccounting) return null;
  return (
    <div className="space-y-1">
      <NavGroupTitle>Księgowość</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="cost_allocation" to="/cost-allocation">
          Adnotacje kosztowe
        </ModuleNavItem>
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

function NavSectionAdministracja() {
  const anyEnabled = useModuleGuard('reporting');
  const canReports = usePermission('can_view_reports');
  if (!anyEnabled || !canReports) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Administracja</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="reporting" to="/reports" end>
          Raporty
        </ModuleNavItem>
        <ModuleNavItem module="reporting" to="/reports/profit-loss">
          Wynik (P&amp;L)
        </ModuleNavItem>
        <ModuleNavItem module="reporting" to="/reports/product-margin">
          Marże na produktach
        </ModuleNavItem>
        <ModuleNavItem module="reporting" to="/reports/payment-aging">
          Aging należności
        </ModuleNavItem>
        <ModuleNavItem module="reporting" to="/reports/supplier-costs">
          Koszty zakupów
        </ModuleNavItem>
        <ModuleNavItem module="reporting" to="/reports/inventory">
          Magazyn
        </ModuleNavItem>
        <ModuleNavItem module="reporting" to="/reports/customer-margin">
          Marże na klientach
        </ModuleNavItem>
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
  const canKsefCert = user?.is_company_admin || user?.permissions?.can_manage_invoices;

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
        <NavSectionMagazyn />
        <NavSectionDokumenty />
        <NavSectionZakupy />
        <NavSectionProdukcja />
        <NavSectionKsiegowos />
        <NavSectionAdministracja />
      </nav>

      <div className="space-y-1 border-t border-border p-3">
        {canSettings && (
          <AppNavItemLink to="/settings/company" end>
            Ustawienia
          </AppNavItemLink>
        )}
        {canKsefCert && (
          <ModuleNavItem module="ksef" to="/settings/certificate" end>
            Certyfikat KSeF
          </ModuleNavItem>
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

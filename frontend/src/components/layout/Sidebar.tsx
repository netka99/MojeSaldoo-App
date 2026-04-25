import { Link } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { useAuth } from '@/context/AuthContext';
import { CompanySwitcher } from './CompanySwitcher';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { AppNavItemLink, ModuleNavItem, NavGroupTitle } from './Navigation';

function NavSectionSprzedaz() {
  const customersEnabled = useModuleGuard('customers');
  const ordersEnabled = useModuleGuard('orders');
  const anyEnabled = customersEnabled || ordersEnabled;
  if (!anyEnabled) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Sprzedaż</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="customers" to="/customers">
          Klienci
        </ModuleNavItem>
        <ModuleNavItem module="orders" to="/orders">
          Zamówienia
        </ModuleNavItem>
      </div>
    </div>
  );
}

function NavSectionMagazyn() {
  const productsEnabled = useModuleGuard('products');
  const warehousesEnabled = useModuleGuard('warehouses');
  const anyEnabled = productsEnabled || warehousesEnabled;
  if (!anyEnabled) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Magazyn</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="products" to="/products">
          Produkty
        </ModuleNavItem>
        <ModuleNavItem module="warehouses" to="/warehouses">
          Magazyny
        </ModuleNavItem>
      </div>
    </div>
  );
}

function NavSectionDokumenty() {
  const deliveryEnabled = useModuleGuard('delivery');
  const invoicingEnabled = useModuleGuard('invoicing');
  const ksefEnabled = useModuleGuard('ksef');
  const anyEnabled = deliveryEnabled || invoicingEnabled || ksefEnabled;
  if (!anyEnabled) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Dokumenty</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="delivery" to="/delivery">
          Dostawa
        </ModuleNavItem>
        <ModuleNavItem module="invoicing" to="/invoices">
          Faktury
        </ModuleNavItem>
        <ModuleNavItem module="ksef" to="/ksef">
          KSeF
        </ModuleNavItem>
      </div>
    </div>
  );
}

function NavSectionAdministracja() {
  const anyEnabled = useModuleGuard('reporting');
  if (!anyEnabled) {
    return null;
  }
  return (
    <div className="space-y-1">
      <NavGroupTitle>Administracja</NavGroupTitle>
      <div className="space-y-0.5">
        <ModuleNavItem module="reporting" to="/reports" end>
          Raporty
        </ModuleNavItem>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { isAuthenticated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside
      className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-background"
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
        <NavSectionAdministracja />
      </nav>

      <div className="space-y-1 border-t border-border p-3">
        <AppNavItemLink to="/settings/company" end>
          Ustawienia
        </AppNavItemLink>
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

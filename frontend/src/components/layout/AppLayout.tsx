import type { ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const linkClass = 'text-sm font-medium text-muted-foreground hover:text-foreground';
const activeClass = 'text-sm font-medium text-foreground';

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const active = pathname === to || (to !== '/' && pathname.startsWith(to));
  return (
    <Link to={to} className={active ? activeClass : linkClass}>
      {children}
    </Link>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, logout } = useAuth();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border bg-background px-6 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-lg font-semibold text-foreground">MojeSaldoo</span>
          <nav className="flex flex-wrap items-center gap-4" aria-label="Main">
            <NavLink to="/">Dashboard</NavLink>
            <NavLink to="/customers">Customers</NavLink>
            <NavLink to="/products">Products</NavLink>
            <NavLink to="/warehouses">Warehouses</NavLink>
            <NavLink to="/settings/company">Firma</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {isAuthenticated ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  logout();
                  navigate('/login', { replace: true, state: { from: location.pathname } });
                }}
              >
                Log out
              </Button>
            ) : (
              <Link
                to="/login"
                state={{ from: location.pathname === '/login' ? '/' : location.pathname }}
                className={cn(
                  'inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                )}
              >
                Log in
              </Link>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

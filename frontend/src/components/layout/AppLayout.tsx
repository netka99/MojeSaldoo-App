import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './Navigation';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pb-[83px] md:pb-0">
        <main className="flex-1">
          <div key={location.pathname} className="animate-page-enter">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar />
      <div className="min-w-0 flex flex-1 flex-col">
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

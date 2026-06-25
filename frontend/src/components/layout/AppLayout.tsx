import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './Navigation';
import { Sidebar } from './Sidebar';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription';

export function AppLayout() {
  const location = useLocation();
  usePushNotifications();     // native Android/iOS via Capacitor FCM
  useWebPushSubscription();   // browser Web Push (VAPID)

  return (
    <div className="flex min-h-screen bg-muted/30">
      <div className="print:hidden">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col pb-[83px] md:pb-0 print:pb-0">
        <main className="flex-1">
          <div key={location.pathname} className="animate-page-enter">
            <Outlet />
          </div>
        </main>
      </div>
      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}

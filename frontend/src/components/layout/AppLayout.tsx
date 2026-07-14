import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './Navigation';
import { Sidebar } from './Sidebar';
import { OfflineBanner } from './OfflineBanner';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription';
import { usePrefetchOfflineData } from '@/hooks/usePrefetchOfflineData';
import { OfflineSyncProvider } from '@/context/OfflineSyncContext';
import { useAuth } from '@/context/AuthContext';

function AppLayoutInner({ companyId }: { companyId: string }) {
  const location = useLocation();
  usePushNotifications();     // native Android/iOS via Capacitor FCM
  useWebPushSubscription();   // browser Web Push (VAPID)
  usePrefetchOfflineData(companyId); // pre-warm cache for offline use

  return (
    <div className="flex min-h-screen bg-muted/30">
      <OfflineBanner />
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

export function AppLayout() {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';

  return (
    <OfflineSyncProvider company_id={companyId}>
      <AppLayoutInner companyId={companyId} />
    </OfflineSyncProvider>
  );
}

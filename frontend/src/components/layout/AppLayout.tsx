import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './Navigation';
import { Sidebar } from './Sidebar';
import { OfflineBanner } from './OfflineBanner';
import { DemoBanner } from '@/components/DemoBanner';
import { DemoWelcomeModal } from '@/components/DemoWelcomeModal';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription';
import { usePrefetchOfflineData } from '@/hooks/usePrefetchOfflineData';
import { OfflineSyncProvider } from '@/context/OfflineSyncContext';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery } from '@/query/use-companies';

function AppLayoutInner({ companyId }: { companyId: string }) {
  const location = useLocation();
  usePushNotifications();     // native Android/iOS via Capacitor FCM
  useWebPushSubscription();   // browser Web Push (VAPID)
  usePrefetchOfflineData(companyId); // pre-warm cache for offline use

  const { user } = useAuth();
  const { data: companies } = useMyCompaniesQuery();
  const isDemo = !!(companies ?? []).find(
    (c: { id: string; is_demo?: boolean }) => c.id === user?.current_company && c.is_demo
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      <OfflineBanner />
      <DemoWelcomeModal />
      <div className="print:hidden">
        <Sidebar isDemo={isDemo} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col pb-[83px] md:pb-0 print:pb-0">
        {isDemo && (
          <div className="sticky top-0 z-40 flex items-center gap-2 bg-amber-400 px-4 py-1.5 print:hidden">
            <span className="text-xs font-bold uppercase tracking-wide text-amber-900">Tryb demo</span>
            <span className="text-xs text-amber-800">— przeglądasz przykładowe dane</span>
          </div>
        )}
        <DemoBanner />
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

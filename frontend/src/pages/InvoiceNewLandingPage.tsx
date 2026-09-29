import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { cn } from '@/lib/utils';

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.75}>
      <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.75}>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── Card ──────────────────────────────────────────────────────────── */

interface OptionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function OptionCard({ icon, title, description, onClick }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-4 rounded-2xl bg-surface-card p-5 shadow-soft text-left',
        'transition-all active:scale-[0.98] hover:shadow-md hover:bg-surface-card/80',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0 text-muted-foreground" stroke="currentColor" strokeWidth={2}>
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/* ─── Content ───────────────────────────────────────────────────────── */

function InvoiceNewLandingPageContent() {
  const navigate = useNavigate();
  const ordersEnabled = useModuleGuard('orders');

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          aria-label="Wróć"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5m0 0l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">Nowa faktura</h1>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3 px-4 pt-5 pb-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Wybierz sposób wystawiania
        </p>

        {ordersEnabled && (
          <OptionCard
            icon={<IconCalendar className="h-6 w-6" />}
            title="Zbiorcza"
            description="Zamówienia lub WZ z wybranego dnia / okresu"
            onClick={() => navigate('/invoices/new/period')}
          />
        )}

        <OptionCard
          icon={<IconPencil className="h-6 w-6" />}
          title="Ręcznie"
          description="Wpisz pozycje bez zamówień"
          onClick={() => navigate('/invoices/new/manual')}
        />
      </div>
    </div>
  );
}

/* ─── Export ─────────────────────────────────────────────────────────── */

export function InvoiceNewLandingPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InvoiceNewLandingPageContent />;
}

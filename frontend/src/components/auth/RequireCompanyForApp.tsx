import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMyCompaniesQuery } from '@/query/use-companies';

/**
 * Allows the main app shell only when the user belongs to at least one company.
 * Users with no memberships are sent to `/onboarding` (except when that query fails — then we fail open to the layout).
 */
export function RequireCompanyForApp() {
  const location = useLocation();
  const { data, isPending, isSuccess, isError } = useMyCompaniesQuery();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError) {
    return <Outlet />;
  }

  if (isSuccess && data.length === 0) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

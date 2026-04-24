import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMyCompaniesQuery } from '@/query/use-companies';

/**
 * Allows the main app shell only when the user belongs to at least one company.
 * Users with no memberships (or when the companies list cannot be loaded) are sent to `/onboarding`.
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
    // Do not render the main app without knowing company membership (previously "fail open" hid onboarding for no-company users).
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }

  if (isSuccess && data.length === 0) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

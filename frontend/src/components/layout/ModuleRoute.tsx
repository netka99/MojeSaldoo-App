import { type ReactElement, useId } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useCompanyModulesQuery } from '@/query/use-companies';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { MODULE_CARD_COPY } from '@/constants/companyModuleLabels';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import type { ModuleName } from '@/types';

const SETTINGS_PATH = '/settings/company';

const primaryLinkClass = cn(
  'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

function ModuleNotEnabledView({ module }: { module: ModuleName }) {
  const descriptionId = useId();

  return (
    <div className="mx-auto max-w-lg p-6" role="status" aria-labelledby={descriptionId}>
      <Card>
        <CardHeader>
          <CardTitle>Module not enabled</CardTitle>
          <CardDescription id={descriptionId}>
            {MODULE_CARD_COPY[module].title} is turned off. Enable it in company settings to use this part of the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{MODULE_CARD_COPY[module].description}</p>
          <div className="mt-4">
            <Link to={SETTINGS_PATH} replace className={primaryLinkClass}>
              Open company settings
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export interface ModuleRouteGateProps {
  module: ModuleName
  children: ReactElement
}

/**
 * Wraps a route `element`: shows `children` only when the company module is enabled.
 * Use with `<Route path="..." element={<ModuleRouteGate module="...">...</ModuleRouteGate>} />` —
 * do not use a custom component in place of `<Route>` under `<Routes>` (React Router requires real `<Route>` children).
 */
export function ModuleRouteGate({ module, children }: ModuleRouteGateProps) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? undefined;
  const { isPending } = useCompanyModulesQuery(companyId);
  const allowed = useModuleGuard(module);

  if (!companyId) {
    return <ModuleNotEnabledView module={module} />;
  }

  if (isPending) {
    return (
      <div className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
        Loading company modules…
      </div>
    );
  }

  if (!allowed) {
    return <ModuleNotEnabledView module={module} />;
  }

  return children;
}

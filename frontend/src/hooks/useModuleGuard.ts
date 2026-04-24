import { useAuth } from '@/context/AuthContext';
import { useCompanyModulesQuery } from '@/query/use-companies';
import type { ModuleName } from '@/types';

/** Returns true if the given module is enabled for the current company (from auth + modules query). */
export function useModuleGuard(module: ModuleName): boolean {
  const { user } = useAuth();
  const companyId = user?.current_company ?? undefined;
  const { data: modules } = useCompanyModulesQuery(companyId);

  if (!modules?.length) return false;

  const entry = modules.find((m) => m.module === module);
  return entry?.isEnabled ?? false;
}

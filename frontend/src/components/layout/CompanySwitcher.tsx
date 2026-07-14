import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery } from '@/query/use-companies';
import { authStorage } from '@/services/api';

/**
 * Displays the current company name in the sidebar header.
 * Company switching is intentionally not supported — each business logs in separately.
 */
export function CompanySwitcher() {
  const { user, isLoading: authLoading } = useAuth();
  const { data: companies, isPending: companiesLoading, isError } = useMyCompaniesQuery();

  if (authLoading || companiesLoading) {
    return (
      <p className="mt-1 truncate text-sm text-muted-foreground" aria-live="polite">
        Ładowanie…
      </p>
    );
  }

  if (isError) {
    return (
      <p className="mt-1 text-sm text-destructive" role="alert">
        Nie udało się załadować nazwy firmy
      </p>
    );
  }

  const list = (companies ?? []) as { id: string; name: string }[];
  const currentId = user?.current_company ?? null;
  const current = list.find((c) => c.id === currentId) ?? list[0];
  const label = current?.name ?? '—';

  return (
    <p className="mt-1 truncate text-sm text-muted-foreground" title={label}>
      {label}
    </p>
  );
}

import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery } from '@/query/use-companies';

export type CompanyListRow = {
  id: string;
  name: string;
  nip?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
};

type Resolved =
  | { state: 'loading' }
  | { state: 'no_companies' }
  | { state: 'ready'; companyId: string; isUnsynced: boolean; company: CompanyListRow | undefined };

/**
 * `user.current_company` is often null (never switched). Fall back to the first
 * org from `GET /companies/me/` so settings pages can still load and PATCH.
 */
export function useResolvedCompanyId(): Resolved {
  const { user } = useAuth();
  const { data: myCompanies, isPending } = useMyCompaniesQuery();

  return useMemo((): Resolved => {
    const list = (myCompanies ?? []) as CompanyListRow[];
    if (user?.current_company) {
      const company = list.find((c) => c.id === user.current_company);
      return { state: 'ready', companyId: user.current_company, isUnsynced: false, company };
    }
    if (isPending) {
      return { state: 'loading' };
    }
    if (list.length === 0) {
      return { state: 'no_companies' };
    }
    const first = list[0];
    return { state: 'ready', companyId: first.id, isUnsynced: true, company: first };
  }, [user?.current_company, myCompanies, isPending]);
}

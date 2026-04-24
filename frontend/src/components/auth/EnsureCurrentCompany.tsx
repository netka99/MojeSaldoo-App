import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useMyCompaniesQuery, useSwitchCompanyMutation } from '@/query/use-companies';

/**
 * If the user is logged in, has no `current_company` in `/auth/me/`, but belongs to
 * exactly one company, set it as current (POST /companies/switch/) so `current_company`
 * and `current_company_role` are populated.
 */
export function EnsureCurrentCompany() {
  const { user, isLoading: authLoading, isAuthenticated, refreshUser } = useAuth();
  const { data: myCompanies, isSuccess } = useMyCompaniesQuery();
  const { mutateAsync: switchToCompany } = useSwitchCompanyMutation();
  const ran = useRef(false);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !user) return;
    if (user.current_company) return;
    if (!isSuccess || !myCompanies?.length) return;
    if (myCompanies.length !== 1) return;
    if (ran.current) return;

    ran.current = true;
    void (async () => {
      try {
        await switchToCompany(myCompanies[0].id);
        await refreshUser();
      } catch {
        ran.current = false;
      }
    })();
  }, [authLoading, isAuthenticated, user, isSuccess, myCompanies, refreshUser, switchToCompany]);

  return null;
}

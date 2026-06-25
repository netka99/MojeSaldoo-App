import { useAuth } from '@/context/AuthContext';
import type { UserPermissions } from '@/types';

/**
 * Returns the value of a specific permission flag for the current user.
 * Returns false when there is no active company or the permissions have not loaded yet.
 * Admins (is_company_admin) always return true regardless of the flag.
 */
export function usePermission(key: keyof UserPermissions): boolean {
  const { user } = useAuth();
  if (!user?.current_company) return false;
  if (user.is_company_admin) return true;
  return user.permissions?.[key] ?? false;
}

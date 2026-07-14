import { useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';

/**
 * Banner shown on cost/margin reports when the active company is taxed with ryczałt.
 * On ryczałt the tax base is revenue, not profit, and costs are not tax-deductible —
 * so these reports have managerial value only, not tax value.
 *
 * Reads the auth context defensively (returns null when rendered outside a provider,
 * e.g. in isolated unit tests) instead of using `useAuth`, which throws in that case.
 */
export function RyczaltManagerialNotice() {
  const auth = useContext(AuthContext);
  if (auth?.user?.taxation_form !== 'ryczalt') return null;

  return (
    <div className="no-print rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
      <span className="font-medium">Nie dotyczy ryczałtu podatkowo.</span>{' '}
      Na ryczałcie podatek liczony jest od przychodu — koszty nie są odliczane od
      podatku. Ten raport służy wyłącznie do wglądu zarządczego (rzeczywista
      rentowność Twojej działalności).
    </div>
  );
}

/**
 * Small pill shown in invoice creation headers.
 * Displays current price mode (netto / brutto) and lets the user toggle it
 * with a single click — saves to the company settings immediately.
 */
import { useAuth } from '@/context/AuthContext';
import { useUpdateCompanyMutation } from '@/query/use-companies';
import { useResolvedCompanyId } from '@/hooks/useResolvedCompanyId';

interface Props {
  /** Called after a successful toggle so the parent can re-read isGross. */
  onToggle?: (isGross: boolean) => void;
}

export function PriceModeToggle({ onToggle }: Props = {}) {
  const { user, refreshUser } = useAuth();
  const resolved = useResolvedCompanyId();
  const updateCompany = useUpdateCompanyMutation();

  const isGross = user?.price_input_mode === 'gross';
  const companyId = resolved.state === 'ready' ? resolved.companyId : undefined;

  async function toggle() {
    if (!companyId) return;
    const next = isGross ? 'net' : 'gross';
    await updateCompany.mutateAsync({ companyId, data: { name: '', price_input_mode: next } });
    await refreshUser();
    onToggle?.(next === 'gross');
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={updateCompany.isPending || !companyId}
      title={isGross ? 'Faktury w cenach brutto — kliknij aby zmienić na netto' : 'Faktury w cenach netto — kliknij aby zmienić na brutto'}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
      style={isGross
        ? { borderColor: '#d97706', backgroundColor: '#fffbeb', color: '#b45309' }
        : { borderColor: '#6366f1', backgroundColor: '#eef2ff', color: '#4338ca' }
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isGross ? '#d97706' : '#6366f1' }} />
      {isGross ? 'Ceny brutto' : 'Ceny netto'}
    </button>
  );
}

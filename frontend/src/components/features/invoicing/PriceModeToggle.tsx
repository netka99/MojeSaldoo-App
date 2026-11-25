/**
 * Read-only pill shown in invoice creation headers.
 * Displays current price mode (netto / brutto). Not interactive.
 */
import { useAuth } from '@/context/AuthContext';

export function PriceModeToggle() {
  const { user } = useAuth();
  const isGross = user?.price_input_mode === 'gross';

  return (
    <span
      className="inline-flex shrink-0 select-none items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={isGross
        ? { borderColor: '#d97706', backgroundColor: '#fffbeb', color: '#b45309' }
        : { borderColor: '#6366f1', backgroundColor: '#eef2ff', color: '#4338ca' }
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isGross ? '#d97706' : '#6366f1' }} />
      {isGross ? 'Ceny brutto' : 'Ceny netto'}
    </span>
  );
}

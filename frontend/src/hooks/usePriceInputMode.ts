import { useAuth } from '@/context/AuthContext';

export type PriceInputMode = 'net' | 'gross';

/**
 * Returns the company's price input mode ('net' | 'gross', default 'net').
 * Also returns a helper label so forms can swap "Cena netto" ↔ "Cena brutto".
 */
export function usePriceInputMode(): { mode: PriceInputMode; priceLabel: string; isGross: boolean } {
  const { user } = useAuth();
  const mode: PriceInputMode = user?.price_input_mode === 'gross' ? 'gross' : 'net';
  return {
    mode,
    isGross: mode === 'gross',
    priceLabel: mode === 'gross' ? 'Cena brutto' : 'Cena netto',
  };
}

export type ActivityTile = 'purchasing' | 'production' | 'warehouses' | 'cost_allocation';

export type DeliveryMethod = 'van_routes' | 'delivery' | 'docs_only';

export interface OnboardingPayload {
  activity_tiles: ActivityTile[];
  delivery_method: DeliveryMethod | null;
}

export interface OnboardingCompleteResponse {
  company_type: string;
  onboarding_completed: boolean;
  modules: Record<string, boolean>;
}

/** Human-readable labels for the module summary screen. */
export const MODULE_LABELS: Record<string, string> = {
  invoicing:       'Faktury VAT',
  ksef:            'Wysyłanie przez KSeF',
  ksef_inbox:      'Odbieranie faktur KSeF',
  customers:       'Klienci',
  orders:          'Zamówienia',
  products:        'Produkty',
  warehouses:      'Magazyn',
  purchasing:      'Zakupy (PZ)',
  production:      'Produkcja i receptury',
  cost_allocation: 'Adnotacje kosztowe',
  delivery:        'Wydania WZ i zwroty',
  van_routes:      'Trasy vana',
  reporting:       'Raporty i analityka',
};

/** Modules that are always enabled and shown as "always on" in summary. */
export const ALWAYS_ON_MODULES: string[] = [
  'invoicing', 'ksef', 'customers', 'orders', 'reporting',
];

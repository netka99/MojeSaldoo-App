export type ActivityTile = 'purchasing' | 'production' | 'warehouses' | 'cost_allocation';

export type DeliveryMethod = 'van_routes' | 'delivery' | 'docs_only';

export type TaxationForm = 'kpir' | 'ryczalt';

export type RyczaltCategory =
  | 'rolnicze'
  | 'handel'
  | 'budownictwo'
  | 'uslugi'
  | 'it'
  | 'medyczne'
  | 'finansowe'
  | 'wolne_zawody';

/** Ryczałt categories that are pure-service — no warehouse/van/production needed. */
export const RYCZALT_SERVICE_CATEGORIES: RyczaltCategory[] = [
  'uslugi', 'it', 'medyczne', 'finansowe', 'wolne_zawody',
];

export interface OnboardingPayload {
  activity_tiles: ActivityTile[];
  delivery_method: DeliveryMethod | null;
  taxation_form: TaxationForm;
  ryczalt_category: RyczaltCategory | null;
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

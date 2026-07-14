export type FixedCostCategory =
  | "wynagrodzenia"
  | "zus_zdrowotne"
  | "czynsz"
  | "leasing"
  | "ubezpieczenia"
  | "ksiegowosc"
  | "subskrypcje"
  | "paliwo"
  | "inne";

export const FIXED_COST_CATEGORY_LABELS: Record<FixedCostCategory, string> = {
  wynagrodzenia: "Wynagrodzenia",
  zus_zdrowotne: "ZUS / Zdrowotne",
  czynsz: "Czynsz / Najem",
  leasing: "Leasing / Raty",
  ubezpieczenia: "Ubezpieczenia",
  ksiegowosc: "Biuro rachunkowe",
  subskrypcje: "Subskrypcje i software",
  paliwo: "Paliwo",
  inne: "Inne",
};

export type FixedCost = {
  id: string;
  category: FixedCostCategory;
  description: string;
  amount_monthly: string;
  active_from: string; // YYYY-MM-DD
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FixedCostWrite = {
  category: FixedCostCategory;
  description: string;
  amount_monthly: string | number;
  active_from: string; // YYYY-MM-DD (always 1st of month)
  is_active: boolean;
};

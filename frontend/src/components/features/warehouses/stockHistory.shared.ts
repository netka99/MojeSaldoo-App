export const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE: 'Zakup / Przyjęcie',
  SALE: 'Sprzedaż / Wydanie',
  RETURN: 'Zwrot',
  ADJUSTMENT: 'Korekta ręczna',
  TRANSFER: 'Przesunięcie MM',
  DAMAGE: 'Uszkodzenie',
  RESERVATION: 'Rezerwacja',
  UNRESERVATION: 'Zwolnienie rez.',
};

export const MOVEMENT_COLORS: Record<string, string> = {
  PURCHASE: 'text-green-700',
  SALE: 'text-red-600',
  RETURN: 'text-blue-600',
  ADJUSTMENT: 'text-orange-600',
  TRANSFER: 'text-violet-600',
  DAMAGE: 'text-red-900',
  RESERVATION: 'text-yellow-700',
  UNRESERVATION: 'text-muted-foreground',
};

export const DOC_LABELS: Record<string, string> = {
  delivery: 'WZ',
  delivery_document: 'WZ',
  order: 'ZAM',
  purchase: 'PZ',
  purchase_document: 'PZ',
  van_route: 'Trasa',
  inventory_count: 'Inwentaryzacja',
};

export function docLink(referenceType: string, referenceId: string): string | null {
  const t = referenceType.toLowerCase();
  if (t === 'delivery' || t === 'delivery_document') return `/delivery/${referenceId}`;
  if (t === 'order') return `/orders/${referenceId}`;
  return null;
}

export function fmtQty(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

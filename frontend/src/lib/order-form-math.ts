/**
 * Client-side line totals for order form — align with `OrderItem._recompute_line_totals` in backend.
 * Used for display only; the API recomputes on save.
 */

export function parseDecimalInput(value: string): number | null {
  const t = value.replace(',', '.').trim();
  if (t === '') return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export function unitGrossFromNet(net: number, vatPercent: number): number {
  if (!Number.isFinite(net) || !Number.isFinite(vatPercent)) return 0;
  return net * (1 + vatPercent / 100);
}

function discountFactor(discountPercent: number): number {
  const p = Math.min(100, Math.max(0, discountPercent));
  return Math.max(0, 1 - p / 100);
}

export function lineTotalNet(quantity: number, unitNet: number, discountPercent: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitNet)) return 0;
  const t = quantity * unitNet * discountFactor(discountPercent);
  return Math.round(t * 100) / 100;
}

export function lineTotalGross(
  quantity: number,
  unitNet: number,
  vatPercent: number,
  discountPercent: number,
): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitNet)) return 0;
  const unitG = unitGrossFromNet(unitNet, vatPercent);
  const t = quantity * unitG * discountFactor(discountPercent);
  return Math.round(t * 100) / 100;
}

export function sumLines<T>(lines: T[], getNet: (l: T) => number, getGross: (l: T) => number): { net: number; gross: number } {
  let net = 0;
  let gross = 0;
  for (const l of lines) {
    net += getNet(l);
    gross += getGross(l);
  }
  return { net, gross };
}

export function toApiDecimalString(n: number): string {
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
}

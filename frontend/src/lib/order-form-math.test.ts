import { describe, it, expect } from 'vitest';
import { lineTotalGross, lineTotalNet, parseDecimalInput, toApiDecimalString, unitGrossFromNet } from './order-form-math';

describe('parseDecimalInput', () => {
  it('accepts comma as decimal separator', () => {
    expect(parseDecimalInput('10,5')).toBe(10.5);
  });
  it('returns null for blank string', () => {
    expect(parseDecimalInput('  ')).toBeNull();
  });
  it('returns null for non-numeric string', () => {
    expect(parseDecimalInput('abc')).toBeNull();
  });
});

describe('unitGrossFromNet', () => {
  it('VAT 23%: 100 → 123', () => {
    expect(unitGrossFromNet(100, 23)).toBe(123);
  });
  it('VAT 8%: 3.24 → 3.4992', () => {
    expect(unitGrossFromNet(3.24, 8)).toBeCloseTo(3.4992, 4);
  });
  it('VAT 5%: 0.65 → 0.6825', () => {
    expect(unitGrossFromNet(0.65, 5)).toBeCloseTo(0.6825, 4);
  });
  it('VAT 0%: net = gross', () => {
    expect(unitGrossFromNet(5.00, 0)).toBe(5.00);
  });
});

describe('toApiDecimalString', () => {
  it('formats to 2 decimal places', () => {
    expect(toApiDecimalString(12.3)).toBe('12.30');
  });
  it('rounds to 2 decimal places', () => {
    // Note: 1.005 in IEEE 754 is 1.00499999... so Math.round gives 1.00 — this is expected JS behaviour
    expect(toApiDecimalString(1.234)).toBe('1.23');
    expect(toApiDecimalString(1.235)).toBe('1.24');
  });
  it('handles zero', () => {
    expect(toApiDecimalString(0)).toBe('0.00');
  });
  it('rounds unit gross correctly — 0.65 × 1.05 = 0.6825 → "0.68"', () => {
    expect(toApiDecimalString(unitGrossFromNet(0.65, 5))).toBe('0.68');
  });
  it('rounds unit gross correctly — 3.24 × 1.08 = 3.4992 → "3.50"', () => {
    expect(toApiDecimalString(unitGrossFromNet(3.24, 8))).toBe('3.50');
  });
});

describe('lineTotalNet', () => {
  it('qty 2, net 10, no discount = 20', () => {
    expect(lineTotalNet(2, 10, 0)).toBe(20);
  });
  it('applies line-level discount', () => {
    // net 100, qty 1, disc 10% → 90
    expect(lineTotalNet(1, 100, 10)).toBe(90);
  });
  it('qty 5, net 0.65, no discount = 3.25', () => {
    expect(lineTotalNet(5, 0.65, 0)).toBe(3.25);
  });
  it('qty 20, net 3.24, no discount = 64.80', () => {
    expect(lineTotalNet(20, 3.24, 0)).toBe(64.80);
  });
});

describe('lineTotalGross — price input mode: NET (netto)', () => {
  // In net mode: user enters net price, gross = net × (1 + VAT%).
  // Unit gross is rounded to 2dp before multiplying (same as backend unit_price_gross).

  it('VAT 23%, qty 1, net 10 → gross 12.30', () => {
    expect(lineTotalGross(1, 10, 23, 0)).toBe(12.30);
  });

  it('VAT 23%, qty 2, net 10 → gross 24.60', () => {
    expect(lineTotalGross(2, 10, 23, 0)).toBe(24.60);
  });

  it('VAT 5%, qty 5, net 0.65 → gross 3.40 (not 3.41)', () => {
    // unit gross = round(0.65 × 1.05, 2) = round(0.6825, 2) = 0.68
    // total = 0.68 × 5 = 3.40
    // Without rounding unit first: 0.6825 × 5 = 3.4125 → rounds to 3.41 (wrong)
    expect(lineTotalGross(5, 0.65, 5, 0)).toBe(3.40);
  });

  it('VAT 8%, qty 20, net 3.24 → gross 70.00 (not 69.98)', () => {
    // unit gross = round(3.24 × 1.08, 2) = round(3.4992, 2) = 3.50
    // total = 3.50 × 20 = 70.00
    // Without rounding: 3.4992 × 20 = 69.984 → rounds to 69.98 (wrong)
    expect(lineTotalGross(20, 3.24, 8, 0)).toBe(70.00);
  });

  it('VAT 8%, qty 3, net 3.24 → gross 10.50', () => {
    // unit gross = 3.50, 3.50 × 3 = 10.50
    expect(lineTotalGross(3, 3.24, 8, 0)).toBe(10.50);
  });

  it('VAT 0%, qty 10, net 4.50 → gross 45.00', () => {
    expect(lineTotalGross(10, 4.50, 0, 0)).toBe(45.00);
  });

  it('applies line-level discount: VAT 23%, qty 1, net 100, disc 10% → 110.70', () => {
    // gross = 123, discount factor = 0.9, 123 × 0.9 = 110.7
    expect(lineTotalGross(1, 100, 23, 10)).toBe(110.70);
  });

  it('applies line-level discount: VAT 5%, qty 5, net 0.65, disc 5% → 3.23', () => {
    // unit gross = 0.68, 0.68 × 5 × 0.95 = 3.23
    expect(lineTotalGross(5, 0.65, 5, 5)).toBe(3.23);
  });
});

describe('lineTotalGross — price input mode: GROSS (brutto)', () => {
  // In gross mode: user enters gross price directly.
  // Frontend converts: net = gross / (1 + VAT%), stored with 4dp precision.
  // unit_price_gross sent to API = toApiDecimalString(gross) = gross rounded to 2dp.
  // lineTotalGross uses that net internally but rounds unit gross to 2dp → same result.

  it('VAT 5%, gross 0.68, qty 5 → total 3.40', () => {
    // net = 0.68 / 1.05 = 0.647619..., stored as 0.6476
    const net = 0.68 / 1.05;
    expect(lineTotalGross(5, net, 5, 0)).toBe(3.40);
  });

  it('VAT 8%, gross 3.50, qty 20 → total 70.00', () => {
    // net = 3.50 / 1.08 = 3.24074..., stored as 3.2407
    const net = 3.50 / 1.08;
    expect(lineTotalGross(20, net, 8, 0)).toBe(70.00);
  });

  it('VAT 23%, gross 1.23, qty 10 → total 12.30', () => {
    // net = 1.23 / 1.23 = 1.00 exactly
    const net = 1.23 / 1.23;
    expect(lineTotalGross(10, net, 23, 0)).toBe(12.30);
  });

  it('VAT 5%, gross 7.14, qty 5 → total 35.70', () => {
    // net = 7.14 / 1.05 = 6.8
    const net = 7.14 / 1.05;
    expect(lineTotalGross(5, net, 5, 0)).toBe(35.70);
  });

  it('VAT 5%, gross 2.31, qty 18 → total 41.58', () => {
    // net = 2.31 / 1.05 = 2.2
    const net = 2.31 / 1.05;
    expect(lineTotalGross(18, net, 5, 0)).toBe(41.58);
  });

  it('gross price with discount: VAT 8%, gross 3.50, qty 10, disc 5% → 33.25', () => {
    // unit gross = 3.50, 3.50 × 10 × 0.95 = 33.25
    const net = 3.50 / 1.08;
    expect(lineTotalGross(10, net, 8, 5)).toBe(33.25);
  });
});

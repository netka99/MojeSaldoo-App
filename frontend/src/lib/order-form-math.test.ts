import { describe, it, expect } from 'vitest';
import { lineTotalGross, lineTotalNet, parseDecimalInput, toApiDecimalString, unitGrossFromNet } from './order-form-math';

describe('order-form-math', () => {
  it('parseDecimalInput accepts comma as decimal', () => {
    expect(parseDecimalInput('10,5')).toBe(10.5);
    expect(parseDecimalInput('  ')).toBeNull();
  });

  it('unitGrossFromNet with 23% VAT', () => {
    expect(unitGrossFromNet(100, 23)).toBe(123);
  });

  it('lineTotalNet: qty 2, net 10, 0% discount = 20', () => {
    expect(lineTotalNet(2, 10, 0)).toBe(20);
  });

  it('lineTotalGross: qty 1, net 10, 23% VAT, 0% disc — gross 12.3', () => {
    expect(lineTotalGross(1, 10, 23, 0)).toBe(12.3);
  });

  it('lineTotalGross applies 10% discount on gross side', () => {
    const g = lineTotalGross(1, 100, 23, 10);
    expect(g).toBe(110.7);
  });

  it('toApiDecimalString', () => {
    expect(toApiDecimalString(12.3)).toBe('12.30');
  });
});

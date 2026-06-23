/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openLabelPrintWindow } from './openLabelPrintWindow';

// Mock the print frame to avoid DOM side-effects
vi.mock('./printFrame', () => ({
  openPrintFrame: vi.fn(() => true),
}));

// Mock the label component (just a tag — we test the wrapper, not the rendering)
vi.mock('@/components/print/LabelPrintView', () => ({
  LabelPrintView: () => null,
}));

import { openPrintFrame } from './printFrame';

const baseProduct = () => ({
  id: 'prod-001',
  name: 'Chleb Żytni',
  sku: 'CHL-001',
  barcode: '5901234567890',
  unit: 'szt.',
  price_gross: '3.78',
});

describe('openLabelPrintWindow', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls openPrintFrame with the product title', () => {
    openLabelPrintWindow(baseProduct());
    expect(openPrintFrame).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Etykieta — Chleb Żytni' }),
    );
  });

  it('uses the label-print-root id', () => {
    openLabelPrintWindow(baseProduct());
    expect(openPrintFrame).toHaveBeenCalledWith(
      expect.objectContaining({ rootId: 'label-print-root' }),
    );
  });

  it('passes copies option to the element', () => {
    openLabelPrintWindow(baseProduct(), { copies: 4 });
    const call = vi.mocked(openPrintFrame).mock.calls[0]![0];
    expect(call.element.props.copies).toBe(4);
  });

  it('passes subtitle option to the element', () => {
    openLabelPrintWindow(baseProduct(), { subtitle: 'Piekarnia ABC' });
    const call = vi.mocked(openPrintFrame).mock.calls[0]![0];
    expect(call.element.props.subtitle).toBe('Piekarnia ABC');
  });

  it('defaults copies to 1 when not specified', () => {
    openLabelPrintWindow(baseProduct());
    const call = vi.mocked(openPrintFrame).mock.calls[0]![0];
    expect(call.element.props.copies).toBe(1);
  });

  it('returns the result from openPrintFrame', () => {
    vi.mocked(openPrintFrame).mockReturnValueOnce(false);
    const result = openLabelPrintWindow(baseProduct());
    expect(result).toBe(false);
  });
});

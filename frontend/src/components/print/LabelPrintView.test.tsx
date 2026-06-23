/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabelPrintView } from './LabelPrintView';

// QRCodeSVG renders an svg with aria role — stub for simplicity
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-testid="qr-code" data-value={value} />
  ),
}));

// react-barcode renders a canvas/svg — stub
vi.mock('react-barcode', () => ({
  default: ({ value }: { value: string }) => (
    <svg data-testid="barcode" data-value={value} />
  ),
}));

const baseProduct = () => ({
  id: 'prod-001',
  name: 'Chleb Żytni',
  sku: 'CHL-001',
  barcode: '5901234567890',
  unit: 'szt.',
  price_gross: '3.78',
});

describe('LabelPrintView', () => {
  it('renders the product name', () => {
    render(<LabelPrintView product={baseProduct()} />);
    expect(screen.getByText('Chleb Żytni')).toBeDefined();
  });

  it('renders the QR code with SKU as value', () => {
    render(<LabelPrintView product={baseProduct()} />);
    const qr = screen.getByTestId('qr-code');
    expect(qr.getAttribute('data-value')).toBe('CHL-001');
  });

  it('falls back to product id for QR when sku is null', () => {
    render(<LabelPrintView product={{ ...baseProduct(), sku: null }} />);
    const qr = screen.getByTestId('qr-code');
    expect(qr.getAttribute('data-value')).toBe('prod-001');
  });

  it('renders the barcode when barcode is set', () => {
    render(<LabelPrintView product={baseProduct()} />);
    const bc = screen.getByTestId('barcode');
    expect(bc.getAttribute('data-value')).toBe('5901234567890');
  });

  it('does not render barcode when barcode is null', () => {
    render(<LabelPrintView product={{ ...baseProduct(), barcode: null }} />);
    expect(screen.queryByTestId('barcode')).toBeNull();
  });

  it('renders price in PLN format', () => {
    render(<LabelPrintView product={baseProduct()} />);
    // Polish PLN format: "3,78 zł" or similar
    expect(screen.getByText(/3[,.]78/)).toBeDefined();
  });

  it('renders subtitle when provided', () => {
    render(<LabelPrintView product={baseProduct()} subtitle="Piekarnia ABC" />);
    expect(screen.getByText('Piekarnia ABC')).toBeDefined();
  });

  it('renders the correct number of label copies', () => {
    render(<LabelPrintView product={baseProduct()} copies={3} />);
    // Each copy renders the product name
    const names = screen.getAllByText('Chleb Żytni');
    expect(names).toHaveLength(3);
  });

  it('clamps copies to 100 maximum', () => {
    render(<LabelPrintView product={baseProduct()} copies={999} />);
    const names = screen.getAllByText('Chleb Żytni');
    expect(names).toHaveLength(100);
  });

  it('defaults to 1 copy', () => {
    render(<LabelPrintView product={baseProduct()} />);
    expect(screen.getAllByText('Chleb Żytni')).toHaveLength(1);
  });
});

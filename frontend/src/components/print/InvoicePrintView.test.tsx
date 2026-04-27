/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InvoicePrintView } from './InvoicePrintView';
import type { InvoicePreviewPayload } from '@/types';

function makePreview(over: Partial<InvoicePreviewPayload> = {}): InvoicePreviewPayload {
  return {
    meta: { title: 'Invoice', currency: 'PLN', locale: 'pl-PL' },
    seller: { name: 'Seller SA', nip: '111', address_lines: ['Seller SA', 'NIP: 111', 'ul. A 1'] },
    buyer: { name: 'Buyer SA', nip: '222', address_lines: ['Buyer SA', 'ul. B 2'] },
    invoice: {
      id: 'inv-1',
      invoice_number: 'FV/2026/0001',
      issue_date: '2026-04-10',
      sale_date: '2026-04-09',
      due_date: '2026-04-24',
      payment_method: 'transfer',
      payment_method_label: 'Przelew',
      status: 'issued',
      notes: '',
      order_number: 'ZAM/1',
      delivery_document_number: '',
    },
    totals: {
      subtotal_net: '100.00',
      vat_amount: '23.00',
      subtotal_gross: '123.00',
      total_gross: '123.00',
    },
    lines: [
      {
        position: 1,
        product_name: 'Woda',
        product_unit: 'szt.',
        pkwiu: '10.12.13',
        quantity: '2',
        quantity_display: '2.00',
        unit_price_net: '50.00',
        vat_rate: '23.00',
        vat_rate_display: '23.00',
        line_net: '100.00',
        line_vat: '23.00',
        line_gross: '123.00',
      },
    ],
    ...over,
  };
}

describe('InvoicePrintView', () => {
  it('renders title, invoice number, and MojeSaldoo footer', () => {
    render(<InvoicePrintView preview={makePreview()} />);
    expect(screen.getByRole('heading', { level: 1, name: /faktura vat/i })).toBeInTheDocument();
    expect(screen.getByText('FV/2026/0001')).toBeInTheDocument();
    expect(screen.getByText(/Wygenerowano przez MojeSaldoo/i)).toBeInTheDocument();
  });

  it('renders nabywca block with NIP, name, and address', () => {
    render(
      <InvoicePrintView
        preview={makePreview({
          customer: {
            name: 'Klient XYZ',
            nip: '7777777777',
            address: 'ul. Długa 5',
            postal_code: '00-950',
            city: 'Gdańsk',
          },
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: /nabywca/i })).toBeInTheDocument();
    expect(screen.getByText(/7777777777/)).toBeInTheDocument();
    expect(screen.getByText(/Klient XYZ/)).toBeInTheDocument();
    expect(screen.getByText(/ul\. Długa 5, 00-950 Gdańsk/)).toBeInTheDocument();
  });

  it('renders items table with Polish column headers', () => {
    render(<InvoicePrintView preview={makePreview()} />);
    const table = screen.getByRole('table', { name: /pozycje faktury/i });
    const headers = within(table).getAllByRole('columnheader');
    const text = headers.map((h) => h.textContent?.trim() ?? '');
    expect(text).toEqual([
      'Nr',
      'Nazwa',
      'PKWiU',
      'Ilość',
      'J.m.',
      'Cena netto',
      'VAT %',
      'Wartość netto',
      'VAT',
      'Brutto',
    ]);
    expect(screen.getByRole('cell', { name: 'Woda' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '10.12.13' })).toBeInTheDocument();
  });

  it('uses preview.items when present instead of lines', () => {
    render(
      <InvoicePrintView
        preview={makePreview({
          items: [
            {
              product_name: 'Z API items',
              pkwiu: '',
              quantity: '1.00',
              unit: 'kg',
              unit_price_net: '10.00',
              vat_rate: '8.00',
              line_net: '10.00',
              line_vat: '0.80',
              line_gross: '10.80',
            },
          ],
          lines: [],
        })}
      />,
    );
    expect(screen.getByRole('cell', { name: 'Z API items' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'kg' })).toBeInTheDocument();
  });

  it('renders VAT summary rows from totals.byVatRate', () => {
    render(
      <InvoicePrintView
        preview={makePreview({
          totals: {
            subtotal_net: '150.00',
            vat_amount: '27.00',
            subtotal_gross: '177.00',
            total_gross: '177.00',
            byVatRate: [
              { vat_rate: '8.00', net: '50.00', vat: '4.00', gross: '54.00' },
              { vat_rate: '23.00', net: '100.00', vat: '23.00', gross: '123.00' },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('8.00 %')).toBeInTheDocument();
    expect(screen.getByText('23.00 %')).toBeInTheDocument();
    expect(screen.getByText(/Razem do zapłaty: 177\.00 PLN/)).toBeInTheDocument();
  });

  it('shows payment method, due date, and bank account when provided', () => {
    render(<InvoicePrintView preview={makePreview()} bankAccount="12 3456 0000 0000 0000 0000 0000" />);
    const pay = screen.getByLabelText('Płatność');
    expect(within(pay).getByText(/Forma płatności:/)).toBeInTheDocument();
    expect(within(pay).getByText(/Przelew/)).toBeInTheDocument();
    expect(within(pay).getByText(/Termin płatności:/)).toBeInTheDocument();
    expect(within(pay).getByText(/12 3456 0000 0000 0000 0000 0000/)).toBeInTheDocument();
  });

  it('shows em dash for bank account when omitted', () => {
    render(<InvoicePrintView preview={makePreview()} />);
    const pay = screen.getByLabelText('Płatność');
    expect(pay.textContent).toMatch(/Rachunek bankowy:\s*—/);
  });

  it('imports print CSS (smoke: root test id present)', () => {
    render(<InvoicePrintView preview={makePreview()} />);
    expect(screen.getByTestId('invoice-print-root')).toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WZPrintView } from './WZPrintView';
import type { DeliveryDocumentPreviewPayload } from '@/types';

function makePreview(over: Partial<DeliveryDocumentPreviewPayload> = {}): DeliveryDocumentPreviewPayload {
  return {
    document: {
      id: 'doc-1',
      company: 'co-1',
      order: 'ord-1',
      user: '1',
      document_type: 'WZ',
      document_number: 'WZ/2026/0042',
      issue_date: '2026-04-20',
      from_warehouse: 'wh-1',
      to_warehouse: null,
      to_customer: 'cu-1',
      status: 'delivered',
      has_returns: false,
      returns_notes: '',
      driver_name: 'Jan Kierowca',
      receiver_name: 'Anna Odbiorca',
      delivered_at: '2026-04-21T10:00:00Z',
      notes: '',
      created_at: '2026-04-20T08:00:00Z',
      updated_at: '2026-04-21T10:00:00Z',
    },
    company: {
      name: 'Firma Sp. z o.o.',
      nip: '1234567890',
      address: 'ul. Główna 1',
    },
    customer: {
      name: 'Klient ABC',
      nip: '0987654321',
      address: 'ul. Odbiorcza 2, 00-001 Warszawa',
    },
    from_warehouse: { name: 'Magazyn główny', code: 'MG' },
    items: [
      {
        product_name: 'Mleko 1L',
        quantity_planned: '10.00',
        quantity_actual: '10.00',
        quantity_returned: '1.00',
        unit: 'szt.',
      },
    ],
    ...over,
  };
}

describe('WZPrintView', () => {
  it('renders document number, type, and issue date in header', () => {
    render(<WZPrintView preview={makePreview()} />);
    expect(screen.getByText(/WZ — Wydanie zewnętrzne/i)).toBeInTheDocument();
    expect(screen.getByText(/WZ\/2026\/0042/)).toBeInTheDocument();
    expect(screen.getByText(/Rodzaj:/)).toBeInTheDocument();
    expect(screen.getByText(/^WZ$/)).toBeInTheDocument();
    expect(screen.getByText(/20 kwi 2026/)).toBeInTheDocument();
  });

  it('shows MM document type label when document_type is MM', () => {
    render(
      <WZPrintView
        preview={makePreview({
          document: { ...makePreview().document, document_type: 'MM', document_number: 'MM/2026/0001' },
        })}
      />,
    );
    expect(screen.getByText(/MM — Przesunięcie międzymagazynowe/i)).toBeInTheDocument();
  });

  it('renders from warehouse and customer blocks', () => {
    render(<WZPrintView preview={makePreview()} />);
    expect(screen.getByRole('heading', { name: /z magazynu/i })).toBeInTheDocument();
    expect(screen.getByText(/Magazyn główny \(MG\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /odbiorca/i })).toBeInTheDocument();
    expect(screen.getByText(/Klient ABC/)).toBeInTheDocument();
    expect(screen.getByText(/NIP: 0987654321/)).toBeInTheDocument();
  });

  it('shows em dash for from warehouse when null', () => {
    render(<WZPrintView preview={makePreview({ from_warehouse: null })} />);
    const parties = screen.getByLabelText(/magazyn i odbiorca/i);
    expect(within(parties).getByText(/^—$/)).toBeInTheDocument();
  });

  it('renders items table with required columns', () => {
    render(<WZPrintView preview={makePreview()} />);
    const table = screen.getByRole('table', { name: /pozycje dokumentu/i });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      'Nr',
      'Produkt',
      'Ilość planowana',
      'Ilość dostarczona',
      'Zwroty',
      'J.m.',
    ]);
    expect(within(table).getByRole('cell', { name: 'Mleko 1L' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'szt.' })).toBeInTheDocument();
  });

  it('shows dash for null quantity_actual in items', () => {
    render(
      <WZPrintView
        preview={makePreview({
          items: [
            {
              product_name: 'Woda',
              quantity_planned: '5.00',
              quantity_actual: null,
              quantity_returned: '0.00',
              unit: 'szt.',
            },
          ],
        })}
      />,
    );
    const table = screen.getByRole('table', { name: /pozycje dokumentu/i });
    const row = within(table).getByRole('row', { name: /Woda/ });
    expect(within(row).getAllByRole('cell').some((c) => c.textContent === '—')).toBe(true);
  });

  it('renders signature labels and values', () => {
    render(<WZPrintView preview={makePreview()} issuedByName="Ewa Biuro" />);
    const sig = screen.getByLabelText(/podpisy/i);
    expect(within(sig).getByText('Wystawił:')).toBeInTheDocument();
    expect(within(sig).getByText('Kierowca:')).toBeInTheDocument();
    expect(within(sig).getByText('Odbiorca:')).toBeInTheDocument();
    expect(within(sig).getByText('Ewa Biuro')).toBeInTheDocument();
    expect(within(sig).getByText('Jan Kierowca')).toBeInTheDocument();
    expect(within(sig).getByText('Anna Odbiorca')).toBeInTheDocument();
  });

  it('renders MojeSaldoo footer and print root', () => {
    render(<WZPrintView preview={makePreview()} />);
    expect(screen.getByText(/Wygenerowano przez MojeSaldoo/i)).toBeInTheDocument();
    expect(screen.getByTestId('wz-print-root')).toBeInTheDocument();
  });
});

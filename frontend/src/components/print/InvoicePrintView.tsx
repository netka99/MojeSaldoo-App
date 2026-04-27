import type { InvoicePreviewPayload, InvoicePreviewItemRow, InvoicePreviewLine } from '@/types';
import './InvoicePrintView.css';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatPlDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function companyLinesFromPreview(preview: InvoicePreviewPayload): string[] {
  const c = preview.company;
  if (c) {
    const lines: string[] = [c.name];
    if (c.nip) lines.push(`NIP: ${c.nip}`);
    if (c.address) lines.push(c.address);
    const cityLine = [c.postal_code, c.city].filter(Boolean).join(' ');
    if (cityLine) lines.push(cityLine);
    if (c.phone) lines.push(`Tel.: ${c.phone}`);
    if (c.email) lines.push(c.email);
    return lines.filter(Boolean);
  }
  const { seller } = preview;
  if (seller.address_lines?.length) {
    return seller.address_lines;
  }
  return [seller.name, seller.nip ? `NIP: ${seller.nip}` : ''].filter(Boolean);
}

function buyerFromPreview(preview: InvoicePreviewPayload): { name: string; nip: string; address: string } {
  const c = preview.customer;
  if (c) {
    const cityPart = [c.postal_code, c.city].filter(Boolean).join(' ');
    const addrParts = [c.address, cityPart].filter(Boolean);
    return {
      name: c.name,
      nip: c.nip || '—',
      address: addrParts.length ? addrParts.join(', ') : '—',
    };
  }
  const { buyer } = preview;
  return {
    name: buyer.name,
    nip: buyer.nip || '—',
    address: buyer.address_lines?.length ? buyer.address_lines.join(', ') : '—',
  };
}

export type InvoicePrintLineRow = {
  nr: number;
  product_name: string;
  pkwiu: string;
  quantity: string;
  unit: string;
  unit_price_net: string;
  vat_rate: string;
  line_net: string;
  line_vat: string;
  line_gross: string;
};

function buildLineRows(preview: InvoicePreviewPayload): InvoicePrintLineRow[] {
  const items = preview.items;
  if (items?.length) {
    return items.map((it: InvoicePreviewItemRow, i: number) => ({
      nr: i + 1,
      product_name: it.product_name,
      pkwiu: it.pkwiu || '—',
      quantity: it.quantity,
      unit: it.unit || '—',
      unit_price_net: it.unit_price_net,
      vat_rate: it.vat_rate,
      line_net: it.line_net,
      line_vat: it.line_vat,
      line_gross: it.line_gross,
    }));
  }
  return (preview.lines ?? []).map((line: InvoicePreviewLine) => ({
    nr: line.position,
    product_name: line.product_name,
    pkwiu: line.pkwiu || '—',
    quantity: line.quantity_display || line.quantity,
    unit: line.product_unit || '—',
    unit_price_net: line.unit_price_net,
    vat_rate: line.vat_rate_display || line.vat_rate,
    line_net: line.line_net,
    line_vat: line.line_vat,
    line_gross: line.line_gross,
  }));
}

function vatSummaryRows(preview: InvoicePreviewPayload) {
  const { totals } = preview;
  if (!totals) {
    return [{ rate: '—', net: '—', vat: '—', gross: '—' }];
  }
  const buckets = totals.byVatRate;
  if (buckets?.length) {
    return buckets.map((b) => ({
      rate: b.vat_rate,
      net: b.net,
      vat: b.vat,
      gross: b.gross,
    }));
  }
  return [
    {
      rate: '—',
      net: totals.subtotal_net,
      vat: totals.vat_amount,
      gross: totals.subtotal_gross,
    },
  ];
}

export type InvoicePrintViewProps = {
  preview: InvoicePreviewPayload;
  /** Not provided by preview API yet; pass from company settings when available. */
  bankAccount?: string;
};

export function InvoicePrintView({ preview, bankAccount }: InvoicePrintViewProps) {
  const { invoice, totals, meta } = preview;
  if (!invoice || !totals) {
    return (
      <div className="invoice-print-scope" data-testid="invoice-print-root">
        <p>Brak danych do wydruku.</p>
      </div>
    );
  }
  const lines = buildLineRows(preview);
  const buyer = buyerFromPreview(preview);
  const companyLines = companyLinesFromPreview(preview);
  const vatRows = vatSummaryRows(preview);
  const currency = meta?.currency || 'PLN';

  return (
    <div className="invoice-print-scope" data-testid="invoice-print-root">
      <header className="invoice-print-title-block">
        <h1 className="invoice-print-title">Faktura VAT</h1>
        <p className="invoice-print-subtitle">{invoice.invoice_number || '—'}</p>
      </header>

      <div className="invoice-print-header">
        <div className="invoice-print-header-left">
          <div className="invoice-print-logo" aria-hidden>
            Logo firmy
          </div>
          <ul className="invoice-print-company-lines">
            {companyLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="invoice-print-header-right">
          <ul className="invoice-print-meta-grid">
            <li>
              <span className="invoice-print-meta-label">Data wystawienia:</span>
              {formatPlDate(invoice.issue_date)}
            </li>
            <li>
              <span className="invoice-print-meta-label">Data sprzedaży:</span>
              {formatPlDate(invoice.sale_date)}
            </li>
            <li>
              <span className="invoice-print-meta-label">Termin płatności:</span>
              {formatPlDate(invoice.due_date)}
            </li>
          </ul>
        </div>
      </div>

      <section className="invoice-print-buyer" aria-labelledby="invoice-buyer-heading">
        <h2 id="invoice-buyer-heading" className="invoice-print-buyer-title">
          Nabywca:
        </h2>
        <ul className="invoice-print-buyer-lines">
          <li>
            <strong>NIP:</strong> {buyer.nip}
          </li>
          <li>
            <strong>Nazwa:</strong> {buyer.name}
          </li>
          <li>
            <strong>Adres:</strong> {buyer.address}
          </li>
        </ul>
      </section>

      <div className="invoice-print-table-wrap">
        <table className="invoice-print-table" aria-label="Pozycje faktury">
          <thead>
            <tr>
              <th className="narrow center" scope="col">
                Nr
              </th>
              <th scope="col">Nazwa</th>
              <th scope="col">PKWiU</th>
              <th className="num" scope="col">
                Ilość
              </th>
              <th scope="col">J.m.</th>
              <th className="num" scope="col">
                Cena netto
              </th>
              <th className="num" scope="col">
                VAT %
              </th>
              <th className="num" scope="col">
                Wartość netto
              </th>
              <th className="num" scope="col">
                VAT
              </th>
              <th className="num" scope="col">
                Brutto
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((row) => (
              <tr key={row.nr}>
                <td className="center">{row.nr}</td>
                <td>{row.product_name}</td>
                <td>{row.pkwiu}</td>
                <td className="num">{row.quantity}</td>
                <td>{row.unit}</td>
                <td className="num">
                  {row.unit_price_net} {currency}
                </td>
                <td className="num">{row.vat_rate}</td>
                <td className="num">
                  {row.line_net} {currency}
                </td>
                <td className="num">
                  {row.line_vat} {currency}
                </td>
                <td className="num">
                  {row.line_gross} {currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="invoice-print-summary" aria-label="Podsumowanie VAT">
        <h3 className="invoice-print-summary-title">Podsumowanie według stawek VAT</h3>
        <table className="invoice-print-summary-table">
          <thead>
            <tr>
              <th scope="col">Stawka VAT</th>
              <th className="num" scope="col">
                Wartość netto
              </th>
              <th className="num" scope="col">
                Kwota VAT
              </th>
              <th className="num" scope="col">
                Brutto
              </th>
            </tr>
          </thead>
          <tbody>
            {vatRows.map((r) => (
              <tr key={`${r.rate}-${r.net}`}>
                <td>{r.rate === '—' ? '—' : `${r.rate} %`}</td>
                <td className="num">
                  {r.net} {currency}
                </td>
                <td className="num">
                  {r.vat} {currency}
                </td>
                <td className="num">
                  {r.gross} {currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="invoice-print-grand">
          Razem do zapłaty: {totals.total_gross} {currency}
        </p>
      </section>

      <section className="invoice-print-payment" aria-label="Płatność">
        <p>
          <strong>Forma płatności:</strong> {invoice.payment_method_label}
        </p>
        <p>
          <strong>Termin płatności:</strong> {formatPlDate(invoice.due_date)}
        </p>
        <p>
          <strong>Rachunek bankowy:</strong> {bankAccount?.trim() ? bankAccount : '—'}
        </p>
      </section>

      {invoice.notes ? (
        <section className="invoice-print-notes" aria-label="Uwagi">
          <strong>Uwagi:</strong> {invoice.notes}
        </section>
      ) : null}

      <footer className="invoice-print-footer">Wygenerowano przez MojeSaldoo</footer>
    </div>
  );
}

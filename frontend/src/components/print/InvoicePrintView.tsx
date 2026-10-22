import { QRCodeSVG } from 'qrcode.react';
import type { InvoicePreviewPayload, InvoicePreviewItemRow, InvoicePreviewLine } from '@/types';
import './InvoicePrintView.css';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatPlDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

/** Format IBAN with spaces every 4 chars after country+check (PL27 1234 5678...) */
function formatIban(iban: string): string {
  const raw = iban.replace(/\s/g, '');
  if (!raw) return '';
  return raw.replace(/(.{4})/g, '$1 ').trim();
}

export type InvoicePrintLineRow = {
  nr: number;
  product_name: string;
  pkwiu: string;
  quantity: string;
  unit: string;
  unit_price_gross: string;
  vat_rate: string;
  line_gross: string;
  line_net: string;
  line_vat: string;
};

function buildLineRows(preview: InvoicePreviewPayload): InvoicePrintLineRow[] {
  const items = preview.items;
  if (items?.length) {
    return items.map((it: InvoicePreviewItemRow, i: number) => ({
      nr: i + 1,
      product_name: it.product_name,
      pkwiu: it.pkwiu || '',
      quantity: it.quantity,
      unit: it.unit || '—',
      unit_price_gross: it.unit_price_gross ?? it.unit_price_net,
      vat_rate: it.vat_rate,
      line_gross: it.line_gross,
      line_net: it.line_net,
      line_vat: it.line_vat,
    }));
  }
  return (preview.lines ?? []).map((line: InvoicePreviewLine) => ({
    nr: line.position,
    product_name: line.product_name,
    pkwiu: line.pkwiu || '',
    quantity: line.quantity_display || line.quantity,
    unit: line.product_unit || '—',
    unit_price_gross: line.unit_price_gross ?? line.unit_price_net,
    vat_rate: line.vat_rate_display || line.vat_rate,
    line_gross: line.line_gross,
    line_net: line.line_net,
    line_vat: line.line_vat,
  }));
}

function vatSummaryRows(preview: InvoicePreviewPayload) {
  const { totals } = preview;
  if (!totals) return [{ rate: '—', net: '—', vat: '—', gross: '—' }];
  const buckets = totals.byVatRate;
  if (buckets?.length) {
    return buckets.map((b) => ({ rate: b.vat_rate, net: b.net, vat: b.vat, gross: b.gross }));
  }
  return [{ rate: '—', net: totals.subtotal_net, vat: totals.vat_amount, gross: totals.subtotal_gross }];
}

function saleDateLabel(preview: InvoicePreviewPayload): string {
  const inv = preview.invoice;
  const type = inv.sale_date_type;
  if (type === 'period' && inv.sale_date_to) {
    return `od ${formatPlDate(inv.sale_date)} do ${formatPlDate(inv.sale_date_to)}`;
  }
  if (type === 'issue') return formatPlDate(inv.issue_date);
  return formatPlDate(inv.sale_date);
}

export type InvoicePrintViewProps = {
  preview: InvoicePreviewPayload;
  bankAccount?: string;
};

export function InvoicePrintView({ preview }: InvoicePrintViewProps) {
  const { invoice, totals, meta, company, customer } = preview;
  if (!invoice || !totals) {
    return (
      <div className="invoice-print-scope" data-testid="invoice-print-root">
        <p>Brak danych do wydruku.</p>
      </div>
    );
  }

  const lines = buildLineRows(preview);
  const vatRows = vatSummaryRows(preview);
  const currency = meta?.currency || 'PLN';
  const hasKsef = Boolean(invoice.ksef_number);
  const ksefVerifyUrl = invoice.ksef_qr_url || null;
  const hasPkwiu = lines.some((r) => r.pkwiu);

  // Seller fields
  const sellerName = company?.name ?? preview.seller.name;
  const sellerNip = company?.nip ?? preview.seller.nip ?? '';
  const sellerStreet = company?.address ?? '';
  const sellerCity = [company?.postal_code, company?.city].filter(Boolean).join(' ');
  const sellerPhone = company?.phone ?? '';
  const sellerEmail = company?.email ?? '';

  // Buyer fields
  const buyerName = customer?.name ?? preview.buyer.name;
  const buyerNip = customer?.nip ?? preview.buyer.nip ?? '';
  const buyerStreet = customer?.address ?? '';
  const buyerCity = [customer?.postal_code, customer?.city].filter(Boolean).join(' ');
  const buyerPhone = customer?.phone ?? '';
  const buyerEmail = customer?.email ?? '';
  const buyerIsJst = customer?.is_jst ?? false;
  const buyerIsGv = customer?.is_gv_member ?? false;

  const placeOfIssue = invoice.place_of_issue ?? '';
  const dueDateDesc = invoice.due_date_description ?? '';

  // Bank
  const bankIban = company?.bank_account_iban ?? '';
  const bankSwift = company?.bank_swift ?? '';
  const bankName = company?.bank_name ?? '';
  const hasBank = Boolean(bankIban || bankSwift || bankName);

  // Rejestry
  const regon = company?.regon ?? '';
  const krs = company?.krs ?? '';
  const bdo = company?.bdo ?? '';
  const hasRejestry = Boolean(regon || krs || bdo);

  return (
    <div className="invoice-print-scope" data-testid="invoice-print-root">

      {/* ── Nagłówek ── */}
      <header className="ip-header">
        <div className="ip-header-left">
          <div className="ip-logo-slot">
            {company?.logo_url && (
              <img src={company.logo_url} alt={`Logo ${sellerName}`} />
            )}
          </div>
        </div>
        <div className="ip-header-right">
          <p className="ip-doc-number">{invoice.invoice_number || '—'}</p>
          <p className="ip-doc-type">Faktura {invoice.ksef_number ? 'podstawowa' : 'VAT'}</p>
          {invoice.ksef_number && (
            <>
              <p className="ip-ksef-line"><span>Numer KSeF:</span> {invoice.ksef_number}</p>
              <p className="ip-ksef-line"><span>Data nadania numeru KSeF:</span> {formatPlDate(invoice.issue_date)}</p>
            </>
          )}
        </div>
      </header>

      {/* ── Sprzedawca / Nabywca ── */}
      <div className="ip-parties">
        <div className="ip-party">
          <h2 className="ip-party-title">Sprzedawca</h2>
          <p className="ip-party-field"><span>NIP:</span> {sellerNip || '—'}</p>
          <p className="ip-party-field"><span>Nazwa:</span> {sellerName}</p>
          {(sellerStreet || sellerCity) && (
            <>
              <p className="ip-party-label">Adres</p>
              {sellerStreet && <p className="ip-party-value">{sellerStreet}</p>}
              {sellerCity && <p className="ip-party-value">{sellerCity}</p>}
              <p className="ip-party-value">Polska</p>
            </>
          )}
          {(sellerEmail || sellerPhone) && (
            <>
              <p className="ip-party-label">Dane kontaktowe</p>
              {sellerEmail && <p className="ip-party-value">E-mail: {sellerEmail}</p>}
              {sellerPhone && <p className="ip-party-value">Tel.: {sellerPhone}</p>}
            </>
          )}
        </div>

        <div className="ip-party">
          <h2 className="ip-party-title">Nabywca</h2>
          <p className="ip-party-field"><span>NIP:</span> {buyerNip || '—'}</p>
          <p className="ip-party-field"><span>Nazwa:</span> {buyerName}</p>
          {(buyerStreet || buyerCity) && (
            <>
              <p className="ip-party-label">Adres</p>
              {buyerStreet && <p className="ip-party-value">{buyerStreet}</p>}
              {buyerCity && <p className="ip-party-value">{buyerCity}</p>}
              <p className="ip-party-value">Polska</p>
            </>
          )}
          {(buyerEmail || buyerPhone) && (
            <>
              <p className="ip-party-label">Dane kontaktowe</p>
              {buyerEmail && <p className="ip-party-value">E-mail: {buyerEmail}</p>}
              {buyerPhone && <p className="ip-party-value">Tel.: {buyerPhone}</p>}
            </>
          )}
          <p className="ip-party-value ip-jst">Faktura dotyczy jednostki podrzędnej JST: {buyerIsJst ? 'TAK' : 'NIE'}</p>
          <p className="ip-party-value ip-jst">Faktura dotyczy członka grupy GV: {buyerIsGv ? 'TAK' : 'NIE'}</p>
        </div>
      </div>

      {/* ── Szczegóły ── */}
      <div className="ip-details">
        <div className="ip-details-left">
          <p className="ip-detail-row">
            <span className="ip-detail-label">Data wystawienia, z zastrzeżeniem art. 106na ust. 1 ustawy:</span>
            {formatPlDate(invoice.issue_date)}
          </p>
          <p className="ip-detail-row">
            <span className="ip-detail-label">Data dokonania lub zakończenia dostawy towarów lub wykonania usługi:</span>
            {saleDateLabel(preview)}
          </p>
        </div>
        <div className="ip-details-right">
          {placeOfIssue && (
            <p className="ip-detail-row">
              <span className="ip-detail-label">Miejsce wystawienia:</span> {placeOfIssue}
            </p>
          )}
          <p className="ip-detail-row">
            <span className="ip-detail-label">Kod waluty:</span> {currency}
          </p>
        </div>
      </div>

      {/* ── Pozycje ── */}
      <div className="ip-table-wrap">
        <p className="ip-prices-note">Faktura wystawiona w walucie {currency}</p>
        <table className="ip-table" aria-label="Pozycje faktury">
          <thead>
            <tr>
              <th className="narrow center" scope="col">Lp.</th>
              <th scope="col">Nazwa towaru lub usługi</th>
              <th className="num" scope="col">Cena jedn. brutto</th>
              <th className="num" scope="col">Ilość</th>
              <th scope="col">Miara</th>
              <th className="num" scope="col">Stawka podatku</th>
              <th className="num" scope="col">Wartość sprzedaży brutto</th>
              {hasPkwiu && <th className="num" scope="col">PKWiU</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((row) => (
              <tr key={row.nr}>
                <td className="center">{row.nr}</td>
                <td>{row.product_name}</td>
                <td className="num">{row.unit_price_gross}</td>
                <td className="num">{row.quantity}</td>
                <td>{row.unit}</td>
                <td className="num">{row.vat_rate}%</td>
                <td className="num">{row.line_gross}</td>
                {hasPkwiu && <td className="ip-pkwiu-cell">{row.pkwiu || ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ip-total-gross">
          Kwota należności ogółem: <strong>{totals.total_gross} {currency}</strong>
        </p>
      </div>

      {/* ── Podsumowanie stawek ── */}
      <section className="ip-vat-summary" aria-label="Podsumowanie stawek podatku">
        <h3 className="ip-vat-title">Podsumowanie stawek podatku</h3>
        <table className="ip-vat-table">
          <thead>
            <tr>
              <th className="narrow center" scope="col">Lp.</th>
              <th scope="col">Stawka podatku</th>
              <th className="num" scope="col">Kwota netto</th>
              <th className="num" scope="col">Kwota podatku</th>
              <th className="num" scope="col">Kwota brutto</th>
            </tr>
          </thead>
          <tbody>
            {vatRows.map((r, i) => (
              <tr key={`${r.rate}-${r.net}`}>
                <td className="center">{i + 1}</td>
                <td>{r.rate === '—' ? '—' : `${r.rate}%`}</td>
                <td className="num">{r.net} {currency}</td>
                <td className="num">{r.vat} {currency}</td>
                <td className="num">{r.gross} {currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Płatność ── */}
      <section className="ip-payment" aria-label="Płatność">
        <p><strong>Forma płatności:</strong> {invoice.payment_method_label}</p>
        <table className="ip-payment-table">
          <tbody>
            <tr>
              <td className="ip-payment-label">Termin płatności</td>
              <td>{dueDateDesc || formatPlDate(invoice.due_date)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── Numer rachunku bankowego ── */}
      {hasBank && (
        <section className="ip-bank" aria-label="Numer rachunku bankowego">
          <h3 className="ip-section-title">Numer rachunku bankowego</h3>
          <table className="ip-bank-table">
            <tbody>
              {bankIban && (
                <tr>
                  <td className="ip-bank-label">Pełny numer rachunku</td>
                  <td>{formatIban(bankIban)}</td>
                </tr>
              )}
              {bankSwift && (
                <tr>
                  <td className="ip-bank-label">Kod SWIFT</td>
                  <td>{bankSwift}</td>
                </tr>
              )}
              {bankName && (
                <tr>
                  <td className="ip-bank-label">Nazwa banku</td>
                  <td>{bankName}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Rejestry ── */}
      {hasRejestry && (
        <section className="ip-rejestry" aria-label="Rejestry">
          <h3 className="ip-section-title">Rejestry</h3>
          <table className="ip-rejestry-table">
            <thead>
              <tr>
                <th scope="col">Pełna nazwa</th>
                {regon && <th className="num" scope="col">REGON</th>}
                {krs && <th className="num" scope="col">KRS</th>}
                {bdo && <th className="num" scope="col">BDO</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{sellerName}</td>
                {regon && <td className="num">{regon}</td>}
                {krs && <td className="num">{krs}</td>}
                {bdo && <td className="num">{bdo}</td>}
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* ── Dodatkowe informacje ── */}
      {invoice.additional_info && invoice.additional_info.length > 0 && (
        <section className="ip-additional-info" aria-label="Dodatkowe informacje">
          <h3 className="ip-section-title">Dodatkowe informacje</h3>
          <p className="ip-additional-subtitle">Dodatkowy opis</p>
          <table className="ip-additional-table">
            <thead>
              <tr>
                <th className="narrow center" scope="col">Lp.</th>
                <th scope="col">Rodzaj informacji</th>
                <th scope="col">Treść informacji</th>
              </tr>
            </thead>
            <tbody>
              {invoice.additional_info.map((row, i) => (
                <tr key={i}>
                  <td className="center">{i + 1}</td>
                  <td>{row.label}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── WZ / Uwagi ── */}
      {invoice.show_wz_numbers && invoice.wz_numbers && invoice.wz_numbers.length > 0 && (
        <section className="ip-notes">
          <strong>Dokumenty WZ:</strong> {invoice.wz_numbers.join(', ')}
        </section>
      )}
      {invoice.notes ? (
        <section className="ip-notes">
          <strong>Uwagi:</strong> {invoice.notes}
        </section>
      ) : null}

      {/* ── Stopka z QR KSeF ── */}
      <footer className="ip-footer">
        {hasKsef ? (
          <div className="ip-footer-ksef">
            {ksefVerifyUrl ? (
              <div className="ip-qr-block">
                <QRCodeSVG
                  value={ksefVerifyUrl}
                  size={80}
                  level="M"
                  aria-label="QR kod do weryfikacji faktury w KSeF"
                />
                <p className="ip-qr-nr">{invoice.ksef_number}</p>
              </div>
            ) : (
              <div className="ip-qr-placeholder" aria-label="QR kod KSeF (brak UPO)">QR</div>
            )}
            <div className="ip-footer-ksef-text">
              <p className="ip-footer-ksef-cta">Sprawdź, czy Twoja faktura znajduje się w KSeF!</p>
              {ksefVerifyUrl && (
                <p className="ip-footer-ksef-link">
                  Nie możesz zeskanować kodu z obrazka? Kliknij w link weryfikacyjny i przejdź do weryfikacji faktury!
                  <br />
                  <span className="ip-footer-ksef-url">{ksefVerifyUrl}</span>
                </p>
              )}
              <p className="ip-footer-meta">Wytworzona w: MojeSaldoo App v1.0</p>
            </div>
          </div>
        ) : (
          <p className="ip-footer-meta">Wytworzona w: MojeSaldoo App v1.0</p>
        )}
      </footer>

    </div>
  );
}

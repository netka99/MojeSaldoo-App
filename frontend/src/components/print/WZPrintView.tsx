import type {
  DeliveryDocumentPreviewPayload,
  DeliveryDocumentPreviewItem,
  DeliveryDocumentType,
} from '@/types';
import './WZPrintView.css';

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function formatPlDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

const DOC_TYPE_LABEL_PL: Record<DeliveryDocumentType, string> = {
  WZ: 'WZ — Wydanie zewnętrzne',
  MM: 'MM — Przesunięcie międzymagazynowe',
  PZ: 'PZ — Przyjęcie zewnętrzne',
};

function formatQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export type WZPrintLineRow = {
  nr: number;
  product_name: string;
  quantity_planned: string;
  quantity_actual: string;
  quantity_returned: string;
  unit: string;
};

function buildRows(items: DeliveryDocumentPreviewItem[]): WZPrintLineRow[] {
  return items.map((it, i) => ({
    nr: i + 1,
    product_name: it.product_name || '—',
    quantity_planned: formatQty(it.quantity_planned),
    quantity_actual: formatQty(it.quantity_actual),
    quantity_returned: formatQty(it.quantity_returned),
    unit: it.unit || '—',
  }));
}

export type WZPrintViewProps = {
  preview: DeliveryDocumentPreviewPayload;
  /** Imię i nazwisko / stanowisko osoby wystawiającej (API nie zwraca imienia użytkownika). */
  issuedByName?: string;
};

export function WZPrintView({ preview, issuedByName }: WZPrintViewProps) {
  const { document: doc, customer, from_warehouse, items } = preview;
  const typeLabel = DOC_TYPE_LABEL_PL[doc.document_type] ?? doc.document_type;
  const rows = buildRows(items ?? []);

  const fromWhText = from_warehouse
    ? `${from_warehouse.name} (${from_warehouse.code})`
    : '—';

  const customerLines = [
    customer.name ? customer.name : null,
    customer.nip ? `NIP: ${customer.nip}` : null,
    customer.address ? customer.address : null,
  ].filter(Boolean) as string[];

  const wystawil = (issuedByName ?? '').trim() || '\u00a0';
  const kierowca = doc.driver_name?.trim() || '\u00a0';
  const odbiorca = doc.receiver_name?.trim() || '\u00a0';

  return (
    <div className="wz-print-scope" data-testid="wz-print-root">
      <header className="wz-print-title-block">
        <h1 className="wz-print-title">{typeLabel}</h1>
        <ul className="wz-print-meta">
          <li>
            <span className="wz-print-meta-label">Numer dokumentu:</span>
            {doc.document_number?.trim() ? doc.document_number : '—'}
          </li>
          <li>
            <span className="wz-print-meta-label">Rodzaj:</span>
            {doc.document_type}
          </li>
          <li>
            <span className="wz-print-meta-label">Data wystawienia:</span>
            {formatPlDate(doc.issue_date)}
          </li>
        </ul>
      </header>

      <section className="wz-print-parties" aria-label="Magazyn i odbiorca">
        <div className="wz-print-party-box">
          <h2 className="wz-print-party-title">Z magazynu</h2>
          <p className="wz-print-party-body">{fromWhText}</p>
        </div>
        <div className="wz-print-party-box">
          <h2 className="wz-print-party-title">Odbiorca</h2>
          {customerLines.length === 0 ? (
            <p className="wz-print-party-body">—</p>
          ) : (
            <ul className="wz-print-party-lines">
              {customerLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="wz-print-table-wrap">
        <table className="wz-print-table" aria-label="Pozycje dokumentu">
          <thead>
            <tr>
              <th className="narrow center" scope="col">
                Nr
              </th>
              <th scope="col">Produkt</th>
              <th className="num" scope="col">
                Ilość planowana
              </th>
              <th className="num" scope="col">
                Ilość dostarczona
              </th>
              <th className="num" scope="col">
                Zwroty
              </th>
              <th scope="col">J.m.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nr}>
                <td className="center">{row.nr}</td>
                <td>{row.product_name}</td>
                <td className="num">{row.quantity_planned}</td>
                <td className="num">{row.quantity_actual}</td>
                <td className="num">{row.quantity_returned}</td>
                <td>{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {doc.notes?.trim() ? (
        <section className="wz-print-notes" aria-label="Uwagi">
          <strong>Uwagi:</strong> {doc.notes}
        </section>
      ) : null}

      <section className="wz-print-signatures" aria-label="Podpisy">
        <div className="wz-print-signature">
          <p className="wz-print-sig-label">Wystawił:</p>
          <p className="wz-print-sig-value">{wystawil}</p>
        </div>
        <div className="wz-print-signature">
          <p className="wz-print-sig-label">Kierowca:</p>
          <p className="wz-print-sig-value">{kierowca}</p>
        </div>
        <div className="wz-print-signature">
          <p className="wz-print-sig-label">Odbiorca:</p>
          <p className="wz-print-sig-value">{odbiorca}</p>
        </div>
      </section>

      <footer className="wz-print-footer">Wygenerowano przez MojeSaldoo</footer>
    </div>
  );
}

import type { Order } from '@/types';
import './OrderPrintView.css';

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function money(v: string | number | null | undefined): string {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? pln.format(n as number) : '—';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : plDate.format(d);
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Szkic',
  confirmed: 'Potwierdzone',
  in_preparation: 'W przygotowaniu',
  loaded: 'Załadowane',
  in_delivery: 'W dostawie',
  delivered: 'Dostarczone',
  invoiced: 'Zafakturowane',
  cancelled: 'Anulowane',
};

export type OrderPrintViewProps = {
  order: Order;
  companyName?: string;
};

export function OrderPrintView({ order, companyName }: OrderPrintViewProps) {
  const subtotal = parseFloat(String(order.subtotal_gross)) || 0;
  const total = parseFloat(String(order.total_gross)) || 0;
  const discount = subtotal - total;

  return (
    <div className="order-print-scope">
      {/* Title block */}
      <div className="order-print-title-block">
        <div>
          <h1 className="order-print-title">Zamówienie</h1>
          <p className="order-print-subtitle">
            {order.order_number ?? order.id.slice(0, 8)}
            {companyName ? ` · ${companyName}` : ''}
          </p>
        </div>
        <span className="order-print-status-badge">
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      {/* Meta */}
      <ul className="order-print-meta">
        <li>
          <span className="order-print-meta-label">Klient:</span>
          {order.customer_name}
        </li>
        <li>
          <span className="order-print-meta-label">Data dostawy:</span>
          {formatDate(order.delivery_date)}
        </li>
        <li>
          <span className="order-print-meta-label">Data zamówienia:</span>
          {formatDate(order.order_date)}
        </li>
        {order.confirmed_at && (
          <li>
            <span className="order-print-meta-label">Potwierdzone:</span>
            {new Date(order.confirmed_at).toLocaleString('pl-PL')}
          </li>
        )}
      </ul>

      {/* Items table */}
      <div className="order-print-table-wrap">
        <table className="order-print-table">
          <thead>
            <tr>
              <th className="narrow">#</th>
              <th>Produkt</th>
              <th className="num">Ilość</th>
              <th>J.m.</th>
              <th className="num">Cena jedn. brutto</th>
              <th className="num">Rabat</th>
              <th className="num">Wartość brutto</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, i) => {
              const qty = parseFloat(String(it.quantity)) || 0;
              const price = parseFloat(String(it.unit_price_gross)) || 0;
              const disc = parseFloat(String(it.discount_percent)) || 0;
              const lineTotal = price * qty * (1 - disc / 100);
              return (
                <tr key={it.id}>
                  <td className="num">{i + 1}</td>
                  <td>{it.product_name}</td>
                  <td className="num">{Number.isInteger(qty) ? qty : qty.toFixed(2)}</td>
                  <td>{it.product_unit || 'szt.'}</td>
                  <td className="num">{money(price)}</td>
                  <td className="num">{disc > 0 ? `${disc}%` : '—'}</td>
                  <td className="num">{money(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <table className="order-print-totals">
        <tbody>
          <tr>
            <td className="label">Suma pozycji:</td>
            <td className="num">{money(subtotal)}</td>
          </tr>
          {discount > 0.001 && (
            <tr>
              <td className="label">Rabaty:</td>
              <td className="num">−{money(discount)}</td>
            </tr>
          )}
          <tr className="total-row">
            <td className="label">Razem brutto:</td>
            <td className="num">{money(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* Notes */}
      {order.customer_notes?.trim() && (
        <div className="order-print-notes">
          <strong>Uwagi do zamówienia:</strong>
          {'\n'}
          {order.customer_notes}
        </div>
      )}

      <div className="order-print-footer">
        Wygenerowano: {new Date().toLocaleString('pl-PL')}
      </div>
    </div>
  );
}

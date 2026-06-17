import type { InventoryCount, InventoryCountItem } from '@/types/inventory.types';

const n3 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3, minimumFractionDigits: 0 });
const signed = (v: number) => (v > 0 ? '+' : '') + n3.format(v);

interface INWPrintViewProps {
  count: InventoryCount;
}

export function INWPrintView({ count }: INWPrintViewProps) {
  const items = count.items;
  const changed = items.filter((it) => it.difference !== null && it.difference !== 0);
  const unchanged = items.filter((it) => it.difference === null || it.difference === 0);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#111', padding: '24px', maxWidth: '900px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px' }}>
            {count.document_number || 'Inwentaryzacja'}
          </div>
          <div style={{ fontSize: '13px', color: '#555' }}>Arkusz inwentaryzacyjny</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '12px', color: '#555' }}>
          <div><strong>Magazyn:</strong> {count.warehouse_name}</div>
          <div><strong>Data inwentaryzacji:</strong> {count.count_date}</div>
          <div><strong>Status:</strong> {count.status === 'completed' ? 'Zakończona' : 'Szkic'}</div>
          {count.completed_at && (
            <div><strong>Zamknięto:</strong> {count.completed_at.slice(0, 10)}</div>
          )}
        </div>
      </div>

      {/* Main table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #d1d5db' }}>
            <th style={thStyle('left')}>Lp.</th>
            <th style={thStyle('left')}>Produkt</th>
            <th style={thStyle('center')}>J.m.</th>
            <th style={thStyle('right')}>Wg systemu</th>
            <th style={thStyle('right')}>Zliczono</th>
            <th style={thStyle('right')}>Różnica</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: InventoryCountItem, i: number) => {
            const diff = item.difference;
            const hasChange = diff !== null && diff !== 0;
            return (
              <tr
                key={item.id}
                style={{
                  borderBottom: '1px solid #e5e7eb',
                  background: hasChange ? (diff! > 0 ? '#f0fdf4' : '#fef2f2') : 'transparent',
                }}
              >
                <td style={tdStyle('left')}>{i + 1}</td>
                <td style={{ ...tdStyle('left'), fontWeight: hasChange ? 'bold' : 'normal' }}>{item.product_name}</td>
                <td style={tdStyle('center')}>{item.product_unit}</td>
                <td style={tdStyle('right')}>{n3.format(Number(item.quantity_system))}</td>
                <td style={tdStyle('right')}>
                  {item.quantity_actual !== null ? n3.format(Number(item.quantity_actual)) : '—'}
                </td>
                <td style={{
                  ...tdStyle('right'),
                  fontWeight: 'bold',
                  color: diff === null ? '#6b7280' : diff > 0 ? '#15803d' : diff < 0 ? '#dc2626' : '#6b7280',
                }}>
                  {diff !== null ? (diff === 0 ? '=' : signed(diff)) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #d1d5db', background: '#f9fafb' }}>
            <td colSpan={3} style={{ ...tdStyle('left'), fontWeight: 'bold' }}>
              Razem pozycji: {items.length}
            </td>
            <td colSpan={3} style={{ ...tdStyle('right'), fontWeight: 'bold' }}>
              Zmienione: {changed.length} &nbsp;·&nbsp; Zgodne: {unchanged.length}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Summary of differences */}
      {changed.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
            Zestawienie różnic:
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                <th style={thStyle('left')}>Produkt</th>
                <th style={thStyle('center')}>J.m.</th>
                <th style={thStyle('right')}>Różnica</th>
                <th style={thStyle('left')}>Rodzaj</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ ...tdStyle('left'), fontWeight: 'bold' }}>{item.product_name}</td>
                  <td style={tdStyle('center')}>{item.product_unit}</td>
                  <td style={{
                    ...tdStyle('right'),
                    fontWeight: 'bold',
                    color: item.difference! > 0 ? '#15803d' : '#dc2626',
                  }}>
                    {signed(item.difference!)}
                  </td>
                  <td style={{ ...tdStyle('left'), color: item.difference! > 0 ? '#15803d' : '#dc2626' }}>
                    {item.difference! > 0 ? 'Nadwyżka' : 'Niedobór'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      {count.notes?.trim() && (
        <div style={{ marginBottom: '24px', fontSize: '12px' }}>
          <strong>Uwagi:</strong> {count.notes}
        </div>
      )}

      {/* Signatures */}
      <div style={{ marginTop: '48px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '32px' }}>
        {['Sporządził:', 'Zatwierdził:', 'Komisja inwentaryzacyjna:'].map((label) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #374151', paddingTop: '4px', fontSize: '11px', color: '#555' }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '32px', fontSize: '10px', color: '#9ca3af', textAlign: 'center' }}>
        Wydrukowano z systemu MojeSaldo · {new Date().toLocaleDateString('pl-PL')}
      </div>
    </div>
  );
}

function thStyle(align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { padding: '6px 8px', textAlign: align, fontWeight: 'bold', fontSize: '11px', color: '#374151' };
}

function tdStyle(align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { padding: '5px 8px', textAlign: align };
}

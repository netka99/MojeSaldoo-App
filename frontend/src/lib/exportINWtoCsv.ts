import type { InventoryCount } from '@/types/inventory.types';

const n3 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3, minimumFractionDigits: 0 });

function esc(val: string | number): string {
  const s = String(val);
  return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportINWtoCsv(count: InventoryCount, filledOnly = false): void {
  const isDraft = count.status !== 'completed';
  const items = filledOnly
    ? count.items.filter((it) => it.quantity_actual !== null && it.quantity_actual !== undefined)
    : count.items;
  const rows: string[] = [];

  // Header info
  rows.push(`Dokument;${esc(count.document_number || 'INW')}`);
  rows.push(`Magazyn;${esc(count.warehouse_name)}`);
  rows.push(`Data inwentaryzacji;${esc(count.count_date)}`);
  rows.push(`Status;${isDraft ? 'Szkic' : 'Zakończona'}`);
  rows.push('');

  // Column headers
  if (filledOnly) {
    rows.push('Lp.;Produkt;J.m.;Policzono');
  } else if (isDraft) {
    rows.push('Lp.;Produkt;J.m.;Wg systemu;Policzono (uzupełnij)');
  } else {
    rows.push('Lp.;Produkt;J.m.;Wg systemu;Policzono;Różnica');
  }

  // Data rows
  items.forEach((item, i) => {
    const qty = n3.format(Number(item.quantity_system)).replace(/\s/g, '');
    const actual = item.quantity_actual !== null ? n3.format(Number(item.quantity_actual)).replace(/\s/g, '') : '';
    if (filledOnly) {
      rows.push(`${i + 1};${esc(item.product_name)};${esc(item.product_unit)};${actual}`);
    } else if (isDraft) {
      rows.push(`${i + 1};${esc(item.product_name)};${esc(item.product_unit)};${qty};`);
    } else {
      const diff = item.difference !== null ? (item.difference > 0 ? '+' : '') + n3.format(item.difference).replace(/\s/g, '') : '';
      rows.push(`${i + 1};${esc(item.product_name)};${esc(item.product_unit)};${qty};${actual};${diff}`);
    }
  });

  rows.push('');
  rows.push(`Razem pozycji;${items.length}`);

  // BOM + content
  const csv = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${count.document_number || 'INW'}_${count.count_date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Print-ready product price label — 57 mm × 35 mm thermal label stock.
 * Shows product name, price brutto, unit, and optionally a company subtitle.
 */

export interface LabelProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price_gross: string | number;
}

export interface LabelPrintViewProps {
  product: LabelProduct;
  copies?: number;
  subtitle?: string;
}

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatPrice(v: string | number): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? pln.format(n) : '';
}

function Label({ product, subtitle }: { product: LabelProduct; subtitle?: string }) {
  return (
    <div
      style={{
        width: '57mm',
        minHeight: '35mm',
        border: '0.5pt solid #ccc',
        borderRadius: '2pt',
        padding: '4pt 5pt',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        pageBreakInside: 'avoid',
        boxSizing: 'border-box',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      {/* Company name */}
      {subtitle && (
        <div style={{ fontSize: '5.5pt', color: '#666', marginBottom: '2pt' }}>
          {subtitle}
        </div>
      )}

      {/* Product name */}
      <div
        style={{
          fontSize: '9pt',
          fontWeight: 700,
          lineHeight: 1.25,
          flex: 1,
          wordBreak: 'break-word',
        }}
      >
        {product.name}
      </div>

      {/* Price */}
      <div
        style={{
          fontSize: '14pt',
          fontWeight: 900,
          color: '#111',
          marginTop: '4pt',
          letterSpacing: '-0.3pt',
        }}
      >
        {formatPrice(product.price_gross)}
        <span style={{ fontSize: '8pt', fontWeight: 400, color: '#444', marginLeft: '3pt' }}>
          / {product.unit}
        </span>
      </div>

      {/* SKU */}
      {product.sku && (
        <div style={{ fontSize: '5pt', color: '#888', marginTop: '2pt' }}>
          SKU: {product.sku}
        </div>
      )}
    </div>
  );
}

export function LabelPrintView({ product, copies = 1, subtitle }: LabelPrintViewProps) {
  const labelCount = Math.max(1, Math.min(copies, 100));

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4pt',
        padding: '4pt',
      }}
    >
      {Array.from({ length: labelCount }, (_, i) => (
        <Label key={i} product={product} subtitle={subtitle} />
      ))}
    </div>
  );
}

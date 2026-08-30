import { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

import { Button } from '@/components/ui/Button';
import { VatBreakdownTable } from './SalesReportCreatePage';
import {
  useSalesReportQuery,
  useUpdateSalesReportMutation,
} from '@/query/use-sales-reports';
import { useAllProductsQuery } from '@/query/use-products';
import type { Product } from '@/types/product.types';
import type { SalesReportLineWrite } from '@/types/sales-reports.types';

// ---------------------------------------------------------------------------
// Helpers (same as create page)
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const pct = (v: number) => (v * 100).toFixed(1) + '%';

interface DraftLine {
  product: Product | null;
  product_name: string;
  unit: string;
  qty: number;
  vat_rate: number;
  unit_price: number;
  unit_cost: number | null;
}

function lineRevenue(l: DraftLine) { return l.qty * l.unit_price; }
function lineCost(l: DraftLine) { return l.unit_cost !== null ? l.qty * l.unit_cost : null; }

// ---------------------------------------------------------------------------
// Line row
// ---------------------------------------------------------------------------

interface LineRowProps {
  line: DraftLine;
  onChange: (next: DraftLine) => void;
  onRemove: () => void;
}

function LineRow({ line, onChange, onRemove }: LineRowProps) {
  const rev = lineRevenue(line);
  const cost = lineCost(line);
  const margin = cost !== null && rev > 0 ? (rev - cost) / rev : null;

  return (
    <div className="border-b border-border/60 last:border-0 px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{line.product_name}</p>
          {margin !== null && (
            <p className="text-xs text-muted-foreground">marża {pct(margin)}</p>
          )}
        </div>

        <div className="flex flex-col items-end shrink-0">
          <input
            type="number"
            inputMode="decimal"
            value={line.unit_price}
            onChange={(e) => onChange({ ...line, unit_price: parseFloat(e.target.value) || 0 })}
            className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            step="0.01"
          />
          <span className="text-xs text-muted-foreground">{line.unit}/szt.</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onChange({ ...line, qty: Math.max(0, line.qty - 1) })}
            className="h-8 w-8 rounded-full bg-muted text-lg font-bold hover:bg-accent flex items-center justify-center leading-none"
          >
            −
          </button>
          <input
            type="number"
            inputMode="decimal"
            value={line.qty}
            onChange={(e) => onChange({ ...line, qty: parseFloat(e.target.value) || 0 })}
            className="w-12 rounded-lg border border-input bg-background px-1 py-1.5 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
            min="0"
          />
          <button
            type="button"
            onClick={() => onChange({ ...line, qty: line.qty + 1 })}
            className="h-8 w-8 rounded-full bg-primary text-white text-lg font-bold hover:bg-primary/90 flex items-center justify-center leading-none"
          >
            +
          </button>
        </div>

        <span className="w-20 text-right text-sm font-semibold text-green-600 shrink-0">
          {pln.format(rev)}
        </span>

        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive text-xl w-5 leading-none shrink-0"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product search (inline, no absolute dropdown)
// ---------------------------------------------------------------------------

interface ProductSearchProps {
  allProducts: Product[];
  onAdd: (product: Product) => void;
  addedIds: Set<string>;
}

function ProductSearch({ allProducts, onAdd, addedIds }: ProductSearchProps) {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const active = allProducts.filter((p) => p.is_active !== false);
    return (q ? active.filter((p) => p.name.toLowerCase().includes(q)) : active).slice(0, 40);
  }, [allProducts, search]);

  const showList = focused && filtered.length > 0;

  return (
    <div className="px-4 pt-3 pb-1 border-t border-border/60">
      <input
        ref={inputRef}
        type="text"
        placeholder="+ Dodaj produkt…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className="w-full rounded-xl border border-dashed border-primary/50 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:bg-background focus:text-foreground"
      />
      {showList && (
        <div className="mt-2 mb-2 rounded-xl border border-border bg-background overflow-hidden max-h-64 overflow-y-auto">
          {filtered.map((p) => {
            const isAdded = addedIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onAdd(p); setSearch(''); inputRef.current?.focus(); }}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted border-b border-border/40 last:border-0 ${isAdded ? 'bg-primary/5' : ''}`}
              >
                <span className={`shrink-0 w-4 text-center text-xs ${isAdded ? 'text-primary' : 'text-transparent'}`}>✓</span>
                <span className={`flex-1 font-medium ${isAdded ? 'text-primary' : ''}`}>{p.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {pln.format(parseFloat(String(p.price_gross)))}
                  {p.avg_cost ? ` · koszt ${pln.format(parseFloat(String(p.avg_cost)))}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SalesReportEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const reportId = Number(id);
  const { data: report, isLoading } = useSalesReportQuery(reportId);
  const updateMutation = useUpdateSalesReportMutation();

  const { data: productsData } = useAllProductsQuery();
  const allProducts: Product[] = productsData?.results ?? [];

  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Populate form once report and products are both loaded
  useEffect(() => {
    if (!report || allProducts.length === 0 || initialized) return;
    setDate(report.date);
    setNotes(report.notes ?? '');
    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    setLines(
      report.lines.map((l): DraftLine => {
        const product = l.product ? productMap.get(l.product) ?? null : null;
        return {
          product,
          product_name: l.product_name,
          unit: l.unit,
          qty: parseFloat(l.qty),
          vat_rate: parseFloat(l.vat_rate) || 23,
          unit_price: parseFloat(l.unit_price),
          unit_cost: l.unit_cost ? parseFloat(l.unit_cost) : null,
        };
      }),
    );
    setInitialized(true);
  }, [report, allProducts, initialized]);

  const { user } = useAuth();
  const isVatPayer = user?.is_vat_payer ?? false;

  const totals = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let hasMissingCost = false;
    const vatBuckets: Record<string, number> = {};
    for (const line of lines) {
      const gross = lineRevenue(line);
      revenue += gross;
      const c = lineCost(line);
      if (c !== null) cost += c;
      else hasMissingCost = true;
      const rateKey = line.vat_rate.toFixed(0) + '%';
      vatBuckets[rateKey] = (vatBuckets[rateKey] ?? 0) + gross;
    }
    const margin = revenue > 0 ? (revenue - cost) / revenue : null;
    const vatRows = Object.entries(vatBuckets).map(([rateLabel, gross]) => {
      const rate = parseFloat(rateLabel) / 100;
      const net = gross / (1 + rate);
      const vat = gross - net;
      return { rateLabel, net, vat, gross };
    });
    return { revenue, cost, margin, hasMissingCost, vatRows };
  }, [lines]);

  const addProduct = (product: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product?.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product?.id === product.id ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          product,
          product_name: product.name,
          unit: product.unit || 'szt.',
          qty: 1,
          vat_rate: parseFloat(String(product.vat_rate)) || 23,
          unit_price: parseFloat(String(product.price_gross)) || 0,
          unit_cost: product.avg_cost ? parseFloat(String(product.avg_cost)) : null,
        },
      ];
    });
  };

  const handleSave = async (status: 'draft' | 'saved') => {
    if (lines.filter((l) => l.qty > 0).length === 0 && status === 'saved') {
      setError('Dodaj co najmniej jeden produkt z ilością > 0.');
      return;
    }
    setError(null);

    const validLines: SalesReportLineWrite[] = lines
      .filter((l) => l.qty > 0)
      .map((l) => ({
        product: l.product?.id ?? null,
        product_name: l.product_name,
        unit: l.unit,
        qty: l.qty.toFixed(3),
        vat_rate: l.vat_rate.toFixed(2),
        unit_price: l.unit_price.toFixed(4),
        unit_cost: l.unit_cost !== null ? l.unit_cost.toFixed(4) : null,
      }));

    try {
      await updateMutation.mutateAsync({
        id: reportId,
        data: { date, status, notes: notes.trim() || undefined, lines: validLines },
      });
      navigate('/sprzedaz');
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-sm text-muted-foreground">
        Raport nie istnieje.{' '}
        <Link to="/sprzedaz" className="text-primary underline">Wróć do listy</Link>
      </div>
    );
  }

  const isSaved = report.status === 'saved';

  return (
    <div className="mx-auto max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-5">
        <Link
          to="/sprzedaz"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent"
        >
          ←
        </Link>
        <div>
          <h1 className="text-xl font-bold leading-tight">
            {report.report_number || 'Szkic'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isSaved ? 'Raport Kasowy (RK) — zapisany' : 'Raport Kasowy (RK) — szkic'}
          </p>
        </div>
      </div>

      {/* Card */}
      <div className="mx-4 rounded-xl border border-border bg-background">
        {/* Date + notes */}
        <div className="grid grid-cols-2 gap-3 p-4 border-b border-border">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notatka</label>
            <input
              type="text"
              placeholder="np. sklep, targ"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Lines */}
        {lines.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground border-b border-border">
            Brak pozycji
          </div>
        ) : (
          lines.map((line, i) => (
            <LineRow
              key={line.product?.id ?? i}
              line={line}
              onChange={(next) => setLines((prev) => prev.map((l, j) => (j === i ? next : l)))}
              onRemove={() => setLines((prev) => prev.filter((_, j) => j !== i))}
            />
          ))
        )}

        {/* Product search */}
        <ProductSearch
          allProducts={allProducts}
          onAdd={addProduct}
          addedIds={new Set(lines.map((l) => l.product?.id ?? ''))}
        />
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm p-4 shadow-lg mt-4">
        <div>
          {lines.length > 0 && (
            <div className="mb-3 space-y-1">
              {/* VAT breakdown — only for VAT payers */}
              {isVatPayer && <VatBreakdownTable vatRows={totals.vatRows} totalRevenue={totals.revenue} />}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Przychód brutto</span>
                <span className="font-bold text-green-600">{pln.format(totals.revenue)}</span>
              </div>
              {totals.cost > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Marża brutto{totals.hasMissingCost && ' (szacunek)'}
                  </span>
                  <span className={`font-semibold ${totals.revenue - totals.cost >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {pln.format(totals.revenue - totals.cost)}
                    {totals.margin !== null && ` · ${pct(totals.margin)}`}
                  </span>
                </div>
              )}
            </div>
          )}

          {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            {!isSaved && (
              <Button
                variant="outline"
                onClick={() => handleSave('draft')}
                disabled={updateMutation.isPending}
                className="flex-1"
              >
                Zapisz szkic
              </Button>
            )}
            <Button
              onClick={() => handleSave('saved')}
              disabled={updateMutation.isPending}
              loading={updateMutation.isPending}
              className="flex-1"
            >
              {isSaved ? 'Zapisz zmiany' : 'Zatwierdź RK'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

import { Button } from '@/components/ui/Button';
import {
  useCreateSalesReportMutation,
  useCreateSalesTemplateMutation,
  useSalesTemplatesQuery,
  useYesterdayReportQuery,
} from '@/query/use-sales-reports';
import { useAllProductsQuery } from '@/query/use-products';
import type { Product } from '@/types/product.types';
import type { SalesReportLineWrite } from '@/types/sales-reports.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

// ---------------------------------------------------------------------------
// VAT Breakdown Table (collapsible)
// ---------------------------------------------------------------------------

interface VatRow { rateLabel: string; net: number; vat: number; gross: number; }

export function VatBreakdownTable({ vatRows, totalRevenue }: { vatRows: VatRow[]; totalRevenue: number }) {
  const [open, setOpen] = useState(false);
  if (vatRows.length === 0) return null;

  const totalNet = vatRows.reduce((s, r) => s + r.net, 0);
  const totalVat = vatRows.reduce((s, r) => s + r.vat, 0);

  return (
    <div className="mb-2 rounded-lg border border-border/60 overflow-hidden text-xs">
      {/* Collapsible header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
      >
        <span className="font-medium text-muted-foreground">
          {open ? '▾' : '▸'} Podział VAT
        </span>
        <span className="tabular-nums text-muted-foreground">
          Netto {pln.format(totalNet)} · VAT {pln.format(totalVat)} · Brutto {pln.format(totalRevenue)}
        </span>
      </button>

      {/* Expandable table */}
      {open && (
        <>
          <div className="grid grid-cols-4 gap-1 bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground border-t border-border/40">
            <span>Stawka</span>
            <span className="text-right">Netto</span>
            <span className="text-right">VAT</span>
            <span className="text-right">Brutto</span>
          </div>
          {vatRows.map(({ rateLabel, net, vat, gross }) => (
            <div key={rateLabel} className="grid grid-cols-4 gap-1 px-3 py-1.5 border-t border-border/40">
              <span className="font-medium">{rateLabel}</span>
              <span className="text-right tabular-nums">{pln.format(net)}</span>
              <span className="text-right tabular-nums text-muted-foreground">{pln.format(vat)}</span>
              <span className="text-right tabular-nums">{pln.format(gross)}</span>
            </div>
          ))}
          {vatRows.length > 1 && (
            <div className="grid grid-cols-4 gap-1 px-3 py-1.5 border-t border-border bg-muted/30 font-semibold">
              <span>Razem</span>
              <span className="text-right tabular-nums">{pln.format(totalNet)}</span>
              <span className="text-right tabular-nums text-muted-foreground">{pln.format(totalVat)}</span>
              <span className="text-right tabular-nums">{pln.format(totalRevenue)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
const pct = (v: number) => (v * 100).toFixed(1) + '%';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Draft line (local state)
// ---------------------------------------------------------------------------

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
// Line row component
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
        {/* Name */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{line.product_name}</p>
          {margin !== null && (
            <p className="text-xs text-muted-foreground">marża {pct(margin)}</p>
          )}
        </div>

        {/* Price (editable) */}
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

        {/* +/- qty controls */}
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

        {/* Line total */}
        <span className="w-20 text-right text-sm font-semibold text-green-600 shrink-0">
          {pln.format(rev)}
        </span>

        {/* Remove */}
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
// Product search dropdown
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
      {/* Inline list — no absolute positioning, pushes page content down naturally */}
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

export function SalesReportCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isVatPayer = user?.is_vat_payer ?? false;
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveTemplateMode, setSaveTemplateMode] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const createMutation = useCreateSalesReportMutation();
  const createTemplateMutation = useCreateSalesTemplateMutation();

  const { data: productsData } = useAllProductsQuery();
  const allProducts: Product[] = productsData?.results ?? [];

  const { data: templates = [] } = useSalesTemplatesQuery();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] = useState<number | null>(null);

  const { data: yesterdayReport } = useYesterdayReportQuery();

  // Totals
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
      // VAT bucket
      const rateKey = line.vat_rate.toFixed(0) + '%';
      vatBuckets[rateKey] = (vatBuckets[rateKey] ?? 0) + gross;
    }
    const margin = revenue > 0 ? (revenue - cost) / revenue : null;
    // Compute net/vat per bucket
    const vatRows = Object.entries(vatBuckets).map(([rateLabel, gross]) => {
      const rate = parseFloat(rateLabel) / 100;
      const net = gross / (1 + rate);
      const vat = gross - net;
      return { rateLabel, net, vat, gross };
    });
    return { revenue, cost, margin, hasMissingCost, vatRows };
  }, [lines]);

  // Add product
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

  // Load template
  const loadTemplate = (templateLines: { product_id: string; product_name: string; unit: string; qty: number; unit_price: number; unit_cost: number | null }[]) => {
    const productMap = new Map(allProducts.map((p) => [String(p.id), p]));
    setLines(
      templateLines.map((tl): DraftLine => {
        const product = productMap.get(tl.product_id) ?? null;
        return {
          product,
          product_name: tl.product_name,
          unit: tl.unit,
          qty: tl.qty,
          vat_rate: product ? parseFloat(String(product.vat_rate)) || 23 : 23,
          unit_price: tl.unit_price,
          unit_cost: tl.unit_cost,
        };
      }),
    );
  };

  // Copy from yesterday
  const copyYesterday = () => {
    if (!yesterdayReport) return;
    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    setLines(
      yesterdayReport.lines.map((l): DraftLine => {
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
  };

  const handleSave = async (status: 'draft' | 'saved') => {
    if (lines.filter((l) => l.qty > 0).length === 0 && status === 'saved') {
      setError('Dodaj co najmniej jeden produkt z ilością > 0.');
      return;
    }
    if (saveTemplateMode && !templateName.trim()) {
      setError('Wpisz nazwę szablonu lub odznacz "Zapisz jako szablon".');
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
      await createMutation.mutateAsync({
        date,
        status,
        notes: notes.trim() || undefined,
        lines: validLines,
      });

      // Save as template if requested
      if (saveTemplateMode && templateName.trim()) {
        await createTemplateMutation.mutateAsync({
          name: templateName.trim(),
          is_default: templates.length === 0,
          lines: lines
            .filter((l) => l.qty > 0)
            .map((l) => ({
              product_id: String(l.product?.id ?? ''),
              product_name: l.product_name,
              unit: l.unit,
              qty: l.qty,
              unit_price: l.unit_price,
              unit_cost: l.unit_cost,
            })),
        });
      }

      navigate('/sprzedaz');
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

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
          <h1 className="text-xl font-bold leading-tight">Nowy raport sprzedaży</h1>
          <p className="text-xs text-muted-foreground">Raport Kasowy (RK)</p>
        </div>
      </div>

      {/* Quick actions: template picker / copy yesterday */}
      {(templates.length > 0 || yesterdayReport) && lines.length === 0 && (
        <div className="mx-4 mb-3 space-y-2">
          <div className="flex gap-2">
            {templates.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTemplatePicker((v) => !v)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  showTemplatePicker
                    ? 'border-primary bg-primary/10'
                    : 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                }`}
              >
                <p className="text-xs font-semibold text-primary">
                  Użyj szablonu {templates.length > 1 && `(${templates.length})`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {showTemplatePicker ? 'Kliknij aby wybrać ↓' : 'Wybierz szablon…'}
                </p>
              </button>
            )}
            {yesterdayReport && (
              <button
                type="button"
                onClick={copyYesterday}
                className="flex-1 rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-left hover:bg-muted transition-colors"
              >
                <p className="text-xs font-semibold">Kopiuj z ostatniego</p>
                <p className="text-xs text-muted-foreground">{yesterdayReport.report_number} · {yesterdayReport.date}</p>
              </button>
            )}
          </div>

          {/* Template list */}
          {showTemplatePicker && templates.length > 0 && (
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              {templates.map((t) => {
                const isExpanded = expandedTemplateId === t.id;
                return (
                  <div key={t.id} className="border-b border-border/60 last:border-0">
                    {/* Header row */}
                    <div className="flex items-center gap-2 px-4 py-3 text-sm">
                      {/* Toggle preview */}
                      <button
                        type="button"
                        onClick={() => setExpandedTemplateId(isExpanded ? null : t.id)}
                        className="flex-1 min-w-0 text-left hover:text-primary transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground transition-transform inline-block" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                          <p className="font-medium truncate">{t.name}</p>
                          {t.is_default && (
                            <span className="text-xs bg-primary/10 text-primary rounded-md px-1.5 py-0.5 shrink-0">
                              domyślny
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground ml-4">{t.lines.length} produktów</p>
                      </button>
                      {/* Apply button */}
                      <button
                        type="button"
                        onClick={() => { loadTemplate(t.lines); setShowTemplatePicker(false); setExpandedTemplateId(null); }}
                        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors"
                      >
                        Użyj →
                      </button>
                    </div>

                    {/* Product preview */}
                    {isExpanded && (
                      <div className="border-t border-border/40 bg-muted/30 px-4 py-2 space-y-1">
                        {t.lines.map((l, i) => (
                          <div key={i} className="flex justify-between text-xs text-muted-foreground py-0.5">
                            <span className="truncate flex-1">{l.product_name}</span>
                            <span className="shrink-0 ml-4 tabular-nums">
                              {l.qty} {l.unit} × {Number(l.unit_price).toFixed(2)} zł
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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

        {/* Lines — above the search so they're always visible */}
        {lines.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground border-b border-border">
            Kliknij w pole niżej i wybierz produkty
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

        {/* Product search — below lines so added items stay visible */}
        <ProductSearch
          allProducts={allProducts}
          onAdd={addProduct}
          addedIds={new Set(lines.map((l) => l.product?.id ?? ''))}
        />
      </div>

      {/* Save as template toggle */}
      {lines.length > 0 && (
        <div className="mx-4 mt-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={saveTemplateMode}
              onChange={(e) => setSaveTemplateMode(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="text-sm text-muted-foreground">Zapisz jako szablon</span>
          </label>
          {saveTemplateMode && (
            <input
              type="text"
              placeholder="Nazwa szablonu (np. Sklep Lipowa)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
        </div>
      )}

      {/* Footer — sticky keeps it at bottom during scroll, but stays in flow when content is short */}
      <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm p-4 shadow-lg mt-4">
        <div>
          {/* Totals */}
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
                    Marża brutto
                    {totals.hasMissingCost && ' (szacunek)'}
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

          {/* Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleSave('draft')}
              disabled={createMutation.isPending}
              className="flex-1"
            >
              Zapisz szkic
            </Button>
            <Button
              onClick={() => handleSave('saved')}
              disabled={createMutation.isPending}
              loading={createMutation.isPending}
              className="flex-1"
            >
              Zatwierdź RK
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

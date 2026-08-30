import { useState, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, addMonths, subMonths, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';

import { Button } from '@/components/ui/Button';
import {
  useB2CRevenueQuery,
  useCreateB2CRevenueMutation,
  useDeleteB2CRevenueMutation,
} from '@/query/use-cashflow';
import { useAllProductsQuery } from '@/query/use-products';
import type { B2CSaleLine, DailyB2CRevenue } from '@/types/cashflow.types';
import type { Product } from '@/types/product.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const pct = new Intl.NumberFormat('pl-PL', { style: 'percent', maximumFractionDigits: 1 });

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const VAT_RATE_OPTIONS = [
  { value: '23', label: '23%' },
  { value: '8', label: '8%' },
  { value: '5', label: '5%' },
  { value: '0', label: '0% / zw.' },
];

// ---------------------------------------------------------------------------
// Manual form (kwota z kasy)
// ---------------------------------------------------------------------------

function ManualForm() {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [vatIncluded, setVatIncluded] = useState(true);
  const [vatRate, setVatRate] = useState('8');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useCreateB2CRevenueMutation();

  const handleSave = async () => {
    const parsed = parseFloat(amount.replace(',', '.'));
    if (!date || isNaN(parsed) || parsed <= 0) {
      setError('Podaj datę i kwotę większą od zera.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({
        date,
        amount: parsed.toFixed(2),
        vat_included: vatIncluded,
        vat_rate: vatRate,
        notes: notes.trim() || undefined,
        sale_type: 'manual',
      });
      setAmount('');
      setNotes('');
      setDate(todayIso());
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-4">
      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Nowy wpis</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">Data</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">Kwota brutto (zł)</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">Stawka VAT w kwocie</label>
        <div className="flex gap-2">
          {VAT_RATE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setVatRate(value)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
                vatRate === value
                  ? 'bg-primary text-white'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={vatIncluded}
            onChange={(e) => setVatIncluded(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm text-muted-foreground">Kwota zawiera VAT (brutto z kasy)</span>
        </label>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">Notatka (opcjonalnie)</label>
        <input
          type="text"
          placeholder="np. targ sobotni, sklep Lipowa"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSave} disabled={mutation.isPending} loading={mutation.isPending} className="w-full">
        Dodaj wpis
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products form (lista produktów)
// ---------------------------------------------------------------------------

interface DraftLine {
  product: Product;
  qty: string;
}

function ProductsForm() {
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: productsData } = useAllProductsQuery();
  const allProducts: Product[] = productsData?.results ?? [];
  const mutation = useCreateB2CRevenueMutation();

  // Show all active products on focus, filter when typing
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const active = allProducts.filter((p) => p.is_active !== false);
    const result = q ? active.filter((p) => p.name.toLowerCase().includes(q)) : active;
    return result.slice(0, 30);
  }, [allProducts, search]);

  const showDropdown = searchFocused && filtered.length > 0;

  const addProduct = (product: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        // increment qty instead of ignoring
        return prev.map((l) =>
          l.product.id === product.id
            ? { ...l, qty: String((parseFloat(l.qty) || 0) + 1) }
            : l,
        );
      }
      return [...prev, { product, qty: '1' }];
    });
    setSearch('');
    searchRef.current?.focus();
  };

  const updateQty = (productId: string, qty: string) => {
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qty } : l)));
  };

  const removeLine = (productId: string) => {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
  };

  const totals = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let hasMissingCost = false;
    for (const { product, qty } of lines) {
      const q = parseFloat(qty) || 0;
      const price = parseFloat(String(product.price_gross)) || 0;
      const unitCost = product.avg_cost ? parseFloat(String(product.avg_cost)) : null;
      revenue += q * price;
      if (unitCost !== null) cost += q * unitCost;
      else hasMissingCost = true;
    }
    const margin = revenue > 0 ? (revenue - cost) / revenue : null;
    return { revenue, cost, margin, hasMissingCost };
  }, [lines]);

  const handleSave = async () => {
    if (!date || lines.length === 0) {
      setError('Wybierz datę i dodaj co najmniej jeden produkt.');
      return;
    }
    const validLines = lines.filter((l) => (parseFloat(l.qty) || 0) > 0);
    if (validLines.length === 0) {
      setError('Wpisz ilości większe od zera.');
      return;
    }
    setError(null);

    const saleLines: B2CSaleLine[] = validLines.map(({ product, qty }) => {
      const q = parseFloat(qty);
      const unitPrice = parseFloat(String(product.price_gross)) || 0;
      const unitCost = product.avg_cost ? parseFloat(String(product.avg_cost)) : 0;
      return {
        product_id: product.id,
        name: product.name,
        qty: q,
        unit_price: unitPrice,
        unit_cost: unitCost,
        line_revenue: q * unitPrice,
        line_cost: q * unitCost,
      };
    });

    const totalRevenue = saleLines.reduce((s, l) => s + l.line_revenue, 0);
    const totalCost = saleLines.reduce((s, l) => s + l.line_cost, 0);

    try {
      await mutation.mutateAsync({
        date,
        amount: totalRevenue.toFixed(2),
        vat_included: true,
        vat_rate: '8',
        notes: notes.trim() || undefined,
        sale_type: 'products',
        lines: saleLines,
        cost_total: totalCost.toFixed(2),
      });
      setLines([]);
      setNotes('');
      setDate(todayIso());
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background">
      {/* Header fields */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Notatka</label>
            <input
              type="text"
              placeholder="np. targ sobotni"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Product search — shows full list on focus */}
        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-muted-foreground">Dodaj produkt</label>
          <input
            ref={searchRef}
            type="text"
            placeholder="Kliknij aby wybrać produkt…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {showDropdown && (
            <div
              ref={dropdownRef}
              className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-background shadow-xl max-h-64 overflow-y-auto"
            >
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-muted first:rounded-t-xl last:rounded-b-xl"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {pln.format(parseFloat(String(p.price_gross)))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lines */}
      {lines.length > 0 && (
        <div className="border-t border-border divide-y divide-border/60">
          {lines.map(({ product, qty }) => {
            const q = parseFloat(qty) || 0;
            const price = parseFloat(String(product.price_gross)) || 0;
            const lineTotal = q * price;
            return (
              <div key={product.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">{pln.format(price)} / szt.</p>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={qty}
                  onChange={(e) => updateQty(product.id, e.target.value)}
                  className="w-16 rounded-lg border border-input bg-background px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="w-20 text-right text-sm font-semibold shrink-0">
                  {pln.format(lineTotal)}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(product.id)}
                  className="text-muted-foreground hover:text-destructive text-xl leading-none shrink-0 w-6"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {lines.length === 0 && (
        <div className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Kliknij w pole wyżej i wybierz produkty
        </div>
      )}

      {/* Sticky footer — summary + save */}
      <div className="border-t border-border bg-muted/30 rounded-b-xl p-4 space-y-3">
        {lines.length > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Przychód brutto</span>
              <span className="font-bold text-green-600">{pln.format(totals.revenue)}</span>
            </div>
            {totals.cost > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Koszt własny</span>
                  <span className="font-medium">{pln.format(totals.cost)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t border-border pt-1">
                  <span>Marża brutto</span>
                  <span className={totals.revenue - totals.cost >= 0 ? 'text-green-600' : 'text-destructive'}>
                    {pln.format(totals.revenue - totals.cost)}
                    {totals.margin !== null && ` · ${pct.format(totals.margin)}`}
                  </span>
                </div>
              </>
            )}
            {totals.hasMissingCost && (
              <p className="text-xs text-amber-600">Brak kosztu dla niektórych produktów — marża szacunkowa.</p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          onClick={handleSave}
          disabled={mutation.isPending || lines.length === 0}
          loading={mutation.isPending}
          className="w-full"
        >
          Zapisz sprzedaż
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry list row
// ---------------------------------------------------------------------------

interface EntryRowProps {
  entry: DailyB2CRevenue;
}

function EntryRow({ entry }: EntryRowProps) {
  const deleteMutation = useDeleteB2CRevenueMutation();
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    await deleteMutation.mutateAsync(entry.id);
  };

  const dateLabel = (() => {
    try { return format(parseISO(entry.date), 'd MMM', { locale: pl }); }
    catch { return entry.date; }
  })();

  const hasLines = entry.sale_type === 'products' && entry.lines.length > 0;
  const margin = entry.cost_total
    ? parseFloat(entry.amount) - parseFloat(entry.cost_total)
    : null;

  return (
    <div className="border-b border-border/60 last:border-0">
      <div className="flex items-center justify-between gap-3 px-1 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{dateLabel}</span>
            {entry.sale_type === 'products' && (
              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-md px-1.5 py-0.5">
                produkty
              </span>
            )}
            {entry.notes && (
              <span className="text-xs text-muted-foreground truncate">{entry.notes}</span>
            )}
          </div>
          {margin !== null ? (
            <span className="text-xs text-muted-foreground">
              marża: {pln.format(margin)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              VAT {entry.vat_rate}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-semibold text-green-600">{pln.format(parseFloat(entry.amount))}</span>
          {hasLines && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground px-1"
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className={`text-xs px-2 py-1 rounded-lg transition-colors ${
              confirming
                ? 'bg-destructive text-white'
                : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
            }`}
          >
            {confirming ? 'Tak, usuń' : 'Usuń'}
          </button>
          {confirming && (
            <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground">
              Anuluj
            </button>
          )}
        </div>
      </div>

      {/* Expanded product lines */}
      {expanded && hasLines && (
        <div className="mb-2 ml-1 rounded-lg bg-muted/50 p-2 space-y-1">
          {entry.lines.map((line, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                {line.name} × {line.qty}
              </span>
              <span>{pln.format(line.line_revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Mode = 'manual' | 'products';

export function B2CSalesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get('month');
  const [selectedMonth, setSelectedMonth] = useState(monthParam ?? currentMonth());
  const [mode, setMode] = useState<Mode>('manual');

  const { data: entries = [], isLoading } = useB2CRevenueQuery(selectedMonth);

  const monthDate = parseISO(`${selectedMonth}-01`);
  const monthLabel = format(monthDate, 'LLLL yyyy', { locale: pl });

  const total = entries.reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalCost = entries.reduce((s, e) => s + (e.cost_total ? parseFloat(e.cost_total) : 0), 0);
  const hasAnyCost = entries.some((e) => e.cost_total);

  const goMonth = (dir: 1 | -1) => {
    const next = dir === 1 ? addMonths(monthDate, 1) : subMonths(monthDate, 1);
    const m = format(next, 'yyyy-MM');
    setSelectedMonth(m);
    setSearchParams({ month: m });
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/cash-flow"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent"
          aria-label="Wróć"
        >
          ←
        </Link>
        <div>
          <h1 className="text-xl font-bold leading-tight">Sprzedaż gotówkowa</h1>
          <p className="text-xs text-muted-foreground">Sprzedaż B2C / gotówkowa / kasowa</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <button
          onClick={() => setMode('manual')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            mode === 'manual' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Kwota z kasy
        </button>
        <button
          onClick={() => setMode('products')}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            mode === 'products' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Lista produktów
        </button>
      </div>

      {/* Form */}
      {mode === 'manual' ? <ManualForm /> : <ProductsForm />}

      {/* Month nav + list */}
      <div className="rounded-xl border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <button onClick={() => goMonth(-1)} className="text-muted-foreground hover:text-foreground px-1 text-lg">
            ‹
          </button>
          <span className="text-sm font-semibold capitalize">{monthLabel}</span>
          <button onClick={() => goMonth(1)} className="text-muted-foreground hover:text-foreground px-1 text-lg">
            ›
          </button>
        </div>

        <div className="px-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Ładowanie…</p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Brak wpisów w tym miesiącu</p>
          ) : (
            entries
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((e) => <EntryRow key={e.id} entry={e} />)
          )}
        </div>

        {entries.length > 0 && (
          <div className="border-t border-border bg-muted/40 px-4 py-3 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Przychód {monthLabel}</span>
              <span className="text-sm font-bold text-green-600">{pln.format(total)}</span>
            </div>
            {hasAnyCost && (
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Marża brutto (z wpisów produktowych)</span>
                <span className="text-xs font-semibold">{pln.format(total - totalCost)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

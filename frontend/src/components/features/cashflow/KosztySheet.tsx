import { useState, useMemo, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { parseISO } from 'date-fns';

import { Button } from '@/components/ui/Button';
import {
  useQuickExpensesQuery,
  useCreateQuickExpenseMutation,
  useUpdateQuickExpenseMutation,
  useDeleteQuickExpenseMutation,
  useOpexCategoriesQuery,
} from '@/query/use-cashflow';
import { useKsefScanPaperMutation } from '@/query/use-invoices';
import { useAllProductsQuery } from '@/query/use-products';
import {
  QUICK_EXPENSE_CATEGORY_LABELS,
  type CostType,
  type DocumentType,
  type QuickExpense,
  type QuickExpenseCategory,
  type QuickExpenseLine,
} from '@/types/cashflow.types';

interface KosztySheetProps {
  open: boolean;
  onClose: () => void;
  month: string; // YYYY-MM
  initialView?: 'list' | 'form';
}

const CATEGORIES = Object.entries(QUICK_EXPENSE_CATEGORY_LABELS) as [QuickExpenseCategory, string][];
const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

// ---------------------------------------------------------------------------
// Expense form (inline)
// ---------------------------------------------------------------------------

interface ExpenseFormProps {
  initialValues?: QuickExpense;
  onSaved: () => void;
  onCancel: () => void;
}

const DOC_TYPE_OPTIONS: [DocumentType, string][] = [
  ['paragon', 'Paragon'],
  ['faktura_vat', 'Faktura VAT'],
  ['faktura_pdf', 'Faktura PDF'],
  ['faktura_rr', 'Faktura RR'],
  ['wz', 'WZ'],
  ['inne', 'Inne'],
];

const VAT_RATES = ['23', '8', '5', '0'];

interface LineItem {
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_rate: string;
}

// isVatDoc = the document type is a faktura (VAT rate is inherent to the line)
// hasVat   = user can deduct this VAT (affects amount_net in payload)
function calcLine(line: LineItem, isVatDoc: boolean) {
  const qty = parseFloat(line.quantity) || 0;
  const price = parseFloat(line.unit_price) || 0;
  const rate = parseFloat(line.vat_rate) || 0;
  const net = qty * price;
  const gross = isVatDoc ? net * (1 + rate / 100) : net;
  return { net, gross, vat: gross - net };
}

function LineRow({
  line,
  index,
  products,
  isVatDoc,
  onChange,
  onRemove,
}: {
  line: LineItem;
  index: number;
  products: { id: string; name: string; sku?: string }[];
  isVatDoc: boolean;
  onChange: (i: number, field: keyof LineItem, value: string) => void;
  onRemove: (i: number) => void;
}) {
  const [showDrop, setShowDrop] = useState(false);
  const filtered = useMemo(() => {
    if (!line.name.trim()) return [];
    const q = line.name.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5);
  }, [products, line.name]);

  const { net, gross } = calcLine(line, isVatDoc);

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Pozycja {index + 1}</span>
        <button type="button" onClick={() => onRemove(index)} className="text-xs text-destructive hover:opacity-70">✕</button>
      </div>

      {/* Name autocomplete */}
      <div className="relative">
        <input
          type="text"
          placeholder="Nazwa produktu / usługi"
          value={line.name}
          onChange={(e) => { onChange(index, 'name', e.target.value); setShowDrop(true); }}
          onFocus={() => setShowDrop(true)}
          onBlur={() => setTimeout(() => setShowDrop(false), 150)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {showDrop && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-background shadow-lg">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={() => { onChange(index, 'name', p.name); setShowDrop(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="flex-1 truncate">{p.name}</span>
                {p.sku && <span className="text-xs text-muted-foreground">{p.sku}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Qty / unit / price / vat row */}
      <div className={`grid gap-2 ${isVatDoc ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div>
          <label className="text-xs text-muted-foreground">Ilość</label>
          <input
            type="number" inputMode="decimal" placeholder="1"
            value={line.quantity}
            onChange={(e) => onChange(index, 'quantity', e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Jedn.</label>
          <input
            type="text" placeholder="szt"
            value={line.unit}
            onChange={(e) => onChange(index, 'unit', e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Cena netto</label>
          <input
            type="number" inputMode="decimal" placeholder="0.00"
            value={line.unit_price}
            onChange={(e) => onChange(index, 'unit_price', e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {isVatDoc && (
          <div>
            <label className="text-xs text-muted-foreground">VAT %</label>
            <select
              value={VAT_RATES.includes(line.vat_rate) ? line.vat_rate : 'other'}
              onChange={(e) => {
                if (e.target.value !== 'other') onChange(index, 'vat_rate', e.target.value);
              }}
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              {!VAT_RATES.includes(line.vat_rate) && (
                <option value="other">{line.vat_rate}%</option>
              )}
            </select>
          </div>
        )}
      </div>

      {/* Line totals */}
      {(net > 0 || gross > 0) && (
        <div className="flex justify-end gap-4 text-xs text-muted-foreground">
          {isVatDoc && <span>Netto: <strong className="text-foreground">{net.toFixed(2)} zł</strong></span>}
          <span>Brutto: <strong className="text-foreground">{gross.toFixed(2)} zł</strong></span>
        </div>
      )}
    </div>
  );
}

function emptyLine(): LineItem {
  return { name: '', quantity: '1', unit: 'szt', unit_price: '', vat_rate: '23' };
}

function ExpenseForm({ initialValues, onSaved, onCancel }: ExpenseFormProps) {
  // simple = one total amount; detailed = multiple line items
  const [mode, setMode] = useState<'simple' | 'detailed'>(() =>
    (initialValues?.lines?.length ?? 0) > 0 ? 'detailed' : 'simple'
  );

  // --- shared fields ---
  const [vendor, setVendor] = useState(initialValues?.vendor ?? '');
  const [documentType, setDocumentType] = useState<DocumentType>(initialValues?.document_type ?? 'paragon');
  const [documentNumber, setDocumentNumber] = useState(initialValues?.document_number ?? '');
  const [category, setCategory] = useState<QuickExpenseCategory>(initialValues?.category ?? 'other');
  const [hasVat, setHasVat] = useState(initialValues?.has_vat ?? false);
  const [date, setDate] = useState(initialValues?.date ?? format(new Date(), 'yyyy-MM-dd'));

  // --- simple mode state ---
  const [simpleAmount, setSimpleAmount] = useState(
    (initialValues?.lines?.length ?? 0) === 0 ? (initialValues?.amount ?? '') : ''
  );
  const [simpleVatRate, setSimpleVatRate] = useState(initialValues?.vat_rate ?? '23');
  const [simpleName, setSimpleName] = useState(
    (initialValues?.lines?.length ?? 0) === 0 ? (initialValues?.product_name ?? '') : ''
  );

  // --- detailed mode state ---
  const [lines, setLines] = useState<LineItem[]>(() => {
    if (initialValues?.lines?.length) {
      return initialValues.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        vat_rate: l.vat_rate,
      }));
    }
    return [emptyLine()];
  });

  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedFileName, setScannedFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanMutation = useKsefScanPaperMutation();

  const { data: opexCategories = [] } = useOpexCategoriesQuery();
  const { data: productsData } = useAllProductsQuery();
  const products = (productsData?.results ?? []).map((p) => ({ id: p.id, name: p.name, sku: p.sku ?? undefined }));

  const isVatDoc = ['faktura_vat', 'faktura_pdf', 'faktura_rr'].includes(documentType);

  const createMutation = useCreateQuickExpenseMutation();
  const updateMutation = useUpdateQuickExpenseMutation();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const categoryOptions = useMemo(() => {
    if (opexCategories.length > 0) {
      return opexCategories.map((c) => [c.slug || c.id, c.name] as [string, string]);
    }
    return CATEGORIES as [string, string][];
  }, [opexCategories]);

  // Totals for detailed mode
  const detailedTotals = useMemo(() => {
    let net = 0, gross = 0;
    lines.forEach((l) => { const c = calcLine(l, isVatDoc); net += c.net; gross += c.gross; });
    return { net, gross, vat: gross - net };
  }, [lines, isVatDoc]);

  // Totals for simple mode (user enters gross; derive net when VAT applies)
  const simpleTotals = useMemo(() => {
    const gross = parseFloat(simpleAmount) || 0;
    const rate = parseFloat(simpleVatRate) || 0;
    const net = isVatDoc && hasVat ? gross / (1 + rate / 100) : gross;
    return { net, gross, vat: gross - net };
  }, [simpleAmount, simpleVatRate, isVatDoc, hasVat]);

  const handleLineChange = (i: number, field: keyof LineItem, value: string) => {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  const handleRemoveLine = (i: number) => {
    setLines((prev) => prev.length === 1 ? [emptyLine()] : prev.filter((_, idx) => idx !== i));
  };

  const switchToDetailed = () => {
    // Pre-fill first line from simple amount if present
    const gross = parseFloat(simpleAmount) || 0;
    if (gross > 0) {
      const rate = parseFloat(simpleVatRate) || 0;
      const net = isVatDoc ? gross / (1 + rate / 100) : gross;
      setLines([{ name: simpleName, quantity: '1', unit: 'szt', unit_price: net.toFixed(2), vat_rate: simpleVatRate }]);
    }
    setMode('detailed');
  };

  const switchToSimple = () => {
    const gross = detailedTotals.gross;
    if (gross > 0) setSimpleAmount(gross.toFixed(2));
    setMode('simple');
  };

  const handleScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);
    setScannedFileName(file.name);
    try {
      const result = await scanMutation.mutateAsync(file);
      if (result.seller_name && !vendor) setVendor(result.seller_name);
      if (result.invoice_number && !documentNumber) setDocumentNumber(result.invoice_number);
      if (result.issue_date) setDate(result.issue_date);
      if (result.invoice_number) setDocumentType('faktura_pdf');
      if (result.lines?.length) {
        setLines(result.lines.map((l) => ({
          name: l.name || '',
          quantity: l.quantity || '1',
          unit: l.unit || 'szt',
          unit_price: l.unit_price || '',
          vat_rate: '23',
        })));
        setMode('detailed');
      } else if (result.total_gross) {
        setSimpleAmount(String(result.total_gross));
        setMode('simple');
      }
    } catch {
      setScanError('Nie udało się odczytać dokumentu. Spróbuj z wyraźniejszym zdjęciem.');
    }
    e.target.value = '';
  };

  const handleSubmit = async () => {
    setError(null);
    let amount: string;
    let amount_net: string | null;
    let builtLines: QuickExpenseLine[];
    let productName: string;

    if (mode === 'simple') {
      if (simpleTotals.gross <= 0) { setError('Wpisz kwotę.'); return; }
      amount = simpleTotals.gross.toFixed(2);
      amount_net = hasVat ? simpleTotals.net.toFixed(2) : null;
      builtLines = [];
      productName = simpleName;
    } else {
      if (detailedTotals.gross <= 0) { setError('Dodaj co najmniej jedną pozycję z ceną.'); return; }
      amount = detailedTotals.gross.toFixed(2);
      amount_net = hasVat ? detailedTotals.net.toFixed(2) : null;
      builtLines = lines.map((l) => {
        const { net, gross } = calcLine(l, isVatDoc);
        return { name: l.name, quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, vat_rate: l.vat_rate, line_net: net.toFixed(2), line_gross: gross.toFixed(2) };
      });
      productName = lines.map((l) => l.name).filter(Boolean).join(', ');
    }

    const payload = {
      amount,
      amount_net,
      vat_rate: hasVat && isVatDoc ? (mode === 'simple' ? simpleVatRate : (lines[0]?.vat_rate ?? '')) : '',
      lines: builtLines,
      category: category as QuickExpenseCategory,
      cost_type: 'indirect' as CostType,
      has_vat: hasVat,
      vendor,
      document_type: documentType,
      document_number: documentNumber,
      product_name: productName,
      date,
    };
    try {
      if (initialValues) {
        await updateMutation.mutateAsync({ id: initialValues.id, data: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onSaved();
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="text-sm text-primary hover:underline underline-offset-2">← Lista</button>
        <h3 className="text-base font-semibold">{initialValues ? 'Edytuj dokument' : 'Nowy dokument'}</h3>
      </div>

      {/* Scan */}
      <div>
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleScanFile} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={scanMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60">
          {scanMutation.isPending ? <><span className="animate-spin">⟳</span> Skanuję…</> : <><span>📷</span> Skanuj dokument (OCR)</>}
        </button>
        {scannedFileName && !scanMutation.isPending && (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            <span className="font-medium">Plik:</span> {scannedFileName}
          </p>
        )}
        {scanError && <p className="mt-1.5 text-xs text-destructive">{scanError}</p>}
      </div>

      {/* Vendor + doc number */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Dostawca</label>
          <input type="text" placeholder="np. Makro, Rolnik Jan K." value={vendor} onChange={(e) => setVendor(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Nr dokumentu</label>
          <input type="text" placeholder="np. FV/2026/08/001" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {/* Doc type + date */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Typ dokumentu</p>
          <div className="flex flex-wrap gap-1.5">
            {DOC_TYPE_OPTIONS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setDocumentType(key)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${documentType === key ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Data</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {/* ── AMOUNT CARD (simple & detailed share the same card shell) ── */}
      <div className="rounded-xl border border-border bg-muted/10 divide-y divide-border">

        {/* ── SIMPLE MODE: big amount + optional VAT ── */}
        {mode === 'simple' && (
          <>
            {/* Amount row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {isVatDoc ? 'Kwota brutto' : 'Kwota'}
              </span>
              <input
                type="number" inputMode="decimal" placeholder="0.00"
                value={simpleAmount} onChange={(e) => setSimpleAmount(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-right text-2xl font-semibold focus:outline-none"
              />
              <span className="text-base text-muted-foreground">zł</span>
            </div>

            {/* VAT row — only for faktura types */}
            {isVatDoc && (
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground flex-1">Stawka VAT</span>
                  {VAT_RATES.map((r) => (
                    <button key={r} type="button" onClick={() => setSimpleVatRate(r)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${simpleVatRate === r ? 'bg-primary text-white' : 'bg-background border border-input text-muted-foreground hover:bg-accent'}`}>
                      {r}%
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={hasVat} onChange={(e) => setHasVat(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                  <span className="text-xs text-muted-foreground">Odliczam VAT od tej faktury</span>
                  {hasVat && simpleTotals.gross > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      netto <strong className="text-foreground">{simpleTotals.net.toFixed(2)}</strong>
                      {' · '}VAT <strong className="text-foreground">{simpleTotals.vat.toFixed(2)}</strong>
                    </span>
                  )}
                </label>
              </div>
            )}

            {/* Description row */}
            <div className="px-4 py-3">
              <input type="text" placeholder="Opis (opcjonalnie, np. Mąka pszenna)"
                value={simpleName} onChange={(e) => setSimpleName(e.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground" />
            </div>

            {/* Switch to detailed */}
            <button type="button" onClick={switchToDetailed}
              className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground hover:text-primary hover:bg-muted/20 transition-colors rounded-b-xl">
              ≡ Wpisz pozycje z faktury
            </button>
          </>
        )}

        {/* ── DETAILED MODE: line items ── */}
        {mode === 'detailed' && (
          <>
            {/* Header row */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-medium">Pozycje faktury</span>
              <button type="button" onClick={switchToSimple}
                className="text-xs text-muted-foreground hover:text-primary transition-colors">
                ← Jedna kwota
              </button>
            </div>

            {/* Odliczam VAT — only for faktura types */}
            {isVatDoc && (
              <div className="px-4 py-2.5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={hasVat} onChange={(e) => setHasVat(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                  <span className="text-xs text-muted-foreground">Odliczam VAT od tej faktury — stawka per pozycja poniżej</span>
                </label>
              </div>
            )}

            {/* Line rows */}
            <div className="px-3 py-3 space-y-2">
              {lines.map((line, i) => (
                <LineRow key={i} line={line} index={i} products={products} isVatDoc={isVatDoc}
                  onChange={handleLineChange} onRemove={handleRemoveLine} />
              ))}
              <button type="button" onClick={() => setLines((p) => [...p, emptyLine()])}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                + Dodaj pozycję
              </button>
            </div>

            {/* Totals footer */}
            {detailedTotals.gross > 0 && (
              <div className={`grid gap-0 text-center text-xs divide-x divide-border ${isVatDoc ? 'grid-cols-3' : 'grid-cols-1'}`}>
                {isVatDoc && (
                  <div className="px-3 py-2.5">
                    <p className="text-muted-foreground">Netto</p>
                    <p className="mt-0.5 font-semibold">{detailedTotals.net.toFixed(2)} zł</p>
                  </div>
                )}
                {isVatDoc && (
                  <div className="px-3 py-2.5">
                    <p className="text-muted-foreground">VAT</p>
                    <p className="mt-0.5 font-semibold">{detailedTotals.vat.toFixed(2)} zł</p>
                  </div>
                )}
                <div className="px-3 py-2.5">
                  <p className="font-medium text-primary">Brutto</p>
                  <p className="mt-0.5 text-base font-bold text-primary">{detailedTotals.gross.toFixed(2)} zł</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Category */}
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Kategoria</p>
        <div className="flex flex-wrap gap-2">
          {categoryOptions.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setCategory(key as QuickExpenseCategory)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${category === key ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 pb-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">Anuluj</Button>
        <Button onClick={handleSubmit} disabled={isPending} loading={isPending} className="flex-1">Zapisz dokument</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expense row
// ---------------------------------------------------------------------------

function ExpenseRow({ expense, onEdit }: { expense: QuickExpense; onEdit: (exp: QuickExpense) => void }) {
  const deleteMutation = useDeleteQuickExpenseMutation();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await deleteMutation.mutateAsync(expense.id);
  };

  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {QUICK_EXPENSE_CATEGORY_LABELS[expense.category]}
          {expense.vendor ? ` · ${expense.vendor}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {format(parseISO(expense.date), 'd MMM', { locale: pl })}
          {expense.has_vat && ' · z VAT'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{pln.format(parseFloat(expense.amount))}</span>
        <button
          onClick={() => onEdit(expense)}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          aria-label="Edytuj koszt"
        >
          ✎
        </button>
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className={`text-xs font-medium transition-colors ${
            confirming ? 'text-destructive hover:text-destructive/80' : 'text-muted-foreground hover:text-destructive'
          }`}
          aria-label="Usuń koszt"
        >
          {confirming ? 'Usuń?' : '✕'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main sheet
// ---------------------------------------------------------------------------

export function KosztySheet({ open, onClose, month, initialView = 'list' }: KosztySheetProps) {
  const [view, setView] = useState<'list' | 'form'>(initialView);
  const [editingExpense, setEditingExpense] = useState<QuickExpense | null>(null);
  const { data: expenses = [], isLoading } = useQuickExpensesQuery(month);

  // Sync view when sheet is opened with a different initialView
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) setView(initialView);
    prevOpen.current = open;
  }, [open, initialView]);

  const handleSaved = () => { setView('list'); setEditingExpense(null); };
  const handleEdit = (exp: QuickExpense) => { setEditingExpense(exp); setView('form'); };
  const handleClose = () => {
    setView('list');
    setEditingExpense(null);
    onClose();
  };

  const monthLabel = month
    ? format(parseISO(`${month}-01`), 'LLLL yyyy', { locale: pl })
    : '';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={handleClose}
          />

          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="fixed bottom-0 left-0 right-0 z-[55] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-background shadow-xl"
          >
            <div className="space-y-4 p-6">
              {view === 'list' ? (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Zakupy poza KSeF</h2>
                      {monthLabel && (
                        <p className="text-xs text-muted-foreground">{monthLabel}</p>
                      )}
                    </div>
                    <button
                      onClick={handleClose}
                      className="text-xl leading-none text-muted-foreground hover:text-foreground"
                      aria-label="Zamknij"
                    >
                      ×
                    </button>
                  </div>

                  {/* Add button */}
                  <Button onClick={() => setView('form')} className="w-full">
                    + Dodaj dokument
                  </Button>

                  {/* List */}
                  {isLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Ładowanie…</p>
                  ) : expenses.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Brak dokumentów w tym miesiącu.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {expenses.map((exp) => (
                        <ExpenseRow key={exp.id} expense={exp} onEdit={handleEdit} />
                      ))}
                    </div>
                  )}

                  <div className="pb-2">
                    <Button variant="outline" onClick={handleClose} className="w-full">
                      Zamknij
                    </Button>
                  </div>
                </>
              ) : (
                <ExpenseForm
                  initialValues={editingExpense ?? undefined}
                  onSaved={handleSaved}
                  onCancel={() => { setView('list'); setEditingExpense(null); }}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

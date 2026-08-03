import { useState, useMemo } from 'react';
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
import { useAllProductsQuery } from '@/query/use-products';
import {
  QUICK_EXPENSE_CATEGORY_LABELS,
  type CostType,
  type DocumentType,
  type QuickExpense,
  type QuickExpenseCategory,
} from '@/types/cashflow.types';

interface KosztySheetProps {
  open: boolean;
  onClose: () => void;
  month: string; // YYYY-MM
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
  ['wz', 'WZ'],
  ['inne', 'Inne'],
];

function ExpenseForm({ initialValues, onSaved, onCancel }: ExpenseFormProps) {
  const [vendor, setVendor] = useState(initialValues?.vendor ?? '');
  const [documentType, setDocumentType] = useState<DocumentType>(initialValues?.document_type ?? 'paragon');
  const [documentNumber, setDocumentNumber] = useState(initialValues?.document_number ?? '');
  const [productName, setProductName] = useState(initialValues?.product_name ?? '');
  const [productSearch, setProductSearch] = useState(initialValues?.product_name ?? '');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [amount, setAmount] = useState(initialValues?.amount ?? '');
  const [category, setCategory] = useState<QuickExpenseCategory>(initialValues?.category ?? 'other');
  const [hasVat, setHasVat] = useState(initialValues?.has_vat ?? false);
  const [date, setDate] = useState(initialValues?.date ?? format(new Date(), 'yyyy-MM-dd'));
  const [error, setError] = useState<string | null>(null);

  const { data: opexCategories = [] } = useOpexCategoriesQuery();
  const { data: productsData } = useAllProductsQuery();
  const products = productsData?.results ?? [];

  const createMutation = useCreateQuickExpenseMutation();
  const updateMutation = useUpdateQuickExpenseMutation();
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Category options: use company OPEX categories if available, fallback to hardcoded
  const categoryOptions = useMemo(() => {
    if (opexCategories.length > 0) {
      return opexCategories.map((c) => [c.slug || c.id, c.name] as [string, string]);
    }
    return CATEGORIES as [string, string][];
  }, [opexCategories]);

  // Filtered products for autocomplete
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return [];
    const q = productSearch.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [products, productSearch]);

  const handleProductSelect = (name: string) => {
    setProductName(name);
    setProductSearch(name);
    setShowProductDropdown(false);
  };

  const handleSubmit = async () => {
    setError(null);
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      setError('Wpisz kwotę większą od zera.');
      return;
    }
    const payload = {
      amount: parsed.toFixed(2),
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
        <button
          onClick={onCancel}
          className="text-sm text-primary hover:underline underline-offset-2"
          aria-label="Wróć do listy"
        >
          ← Lista
        </button>
        <h3 className="text-base font-semibold">{initialValues ? 'Edytuj koszt' : 'Nowy koszt'}</h3>
      </div>

      {/* Vendor — on top */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">Dostawca</label>
        <input
          type="text"
          placeholder="np. Orlen, Biedronka, Makro"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
      </div>

      {/* Document type — radio */}
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Typ dokumentu</p>
        <div className="flex gap-2 flex-wrap">
          {DOC_TYPE_OPTIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDocumentType(key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                documentType === key
                  ? 'bg-primary text-white'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Document number */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          Nr dokumentu <span className="text-xs font-normal">(opcjonalnie)</span>
        </label>
        <input
          type="text"
          placeholder="np. PAR-001, FV/2026/08/001"
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Product — autocomplete from catalog or free text */}
      <div className="relative">
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          Produkt / opis <span className="text-xs font-normal">(opcjonalnie)</span>
        </label>
        <input
          type="text"
          placeholder="Wpisz lub wybierz z katalogu..."
          value={productSearch}
          onChange={(e) => {
            setProductSearch(e.target.value);
            setProductName(e.target.value);
            setShowProductDropdown(true);
          }}
          onFocus={() => setShowProductDropdown(true)}
          onBlur={() => setTimeout(() => setShowProductDropdown(false), 150)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {showProductDropdown && filteredProducts.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-background shadow-lg">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={() => handleProductSelect(p.name)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="flex-1 truncate">{p.name}</span>
                {p.sku && <span className="shrink-0 text-xs text-muted-foreground">{p.sku}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">Kwota (PLN)</label>
        <input
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Category */}
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Kategoria</p>
        <div className="flex flex-wrap gap-2">
          {categoryOptions.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key as QuickExpenseCategory)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                category === key ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* VAT + Date row */}
      <div className="flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={hasVat}
            onChange={(e) => setHasVat(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm">Faktura VAT do odliczenia</span>
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="ml-auto rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 pb-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          Anuluj
        </Button>
        <Button onClick={handleSubmit} disabled={isPending} loading={isPending} className="flex-1">
          Zapisz koszt
        </Button>
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

export function KosztySheet({ open, onClose, month }: KosztySheetProps) {
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingExpense, setEditingExpense] = useState<QuickExpense | null>(null);
  const { data: expenses = [], isLoading } = useQuickExpensesQuery(month);

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
                      <h2 className="text-lg font-semibold">Koszty gotówkowe</h2>
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
                    + Dodaj koszt
                  </Button>

                  {/* List */}
                  {isLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Ładowanie…</p>
                  ) : expenses.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Brak kosztów gotówkowych w tym miesiącu.
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

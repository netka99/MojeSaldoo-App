import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { format } from 'date-fns';

import { Button } from '@/components/ui/Button';
import { useCreateQuickExpenseMutation } from '@/query/use-cashflow';
import {
  QUICK_EXPENSE_CATEGORY_LABELS,
  type CostType,
  type QuickExpenseCategory,
} from '@/types/cashflow.types';

interface QuickExpenseSheetProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = Object.entries(QUICK_EXPENSE_CATEGORY_LABELS) as [
  QuickExpenseCategory,
  string,
][];

export function QuickExpenseSheet({ open, onClose }: QuickExpenseSheetProps) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<QuickExpenseCategory>('other');
  const [costType, setCostType] = useState<CostType>('indirect');
  const [hasVat, setHasVat] = useState(false);
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useCreateQuickExpenseMutation();

  const resetForm = () => {
    setAmount('');
    setCategory('other');
    setCostType('indirect');
    setHasVat(false);
    setVendor('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setShowMore(false);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      setError('Wpisz kwotę większą od zera.');
      return;
    }

    try {
      await mutation.mutateAsync({
        amount: parsed.toFixed(2),
        category,
        cost_type: costType,
        has_vat: hasVat,
        vendor,
        date,
      });
      handleClose();
    } catch {
      setError('Wystąpił błąd przy zapisie. Spróbuj ponownie.');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="fixed bottom-0 left-0 right-0 z-[55] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-background shadow-xl"
          >
            <div className="space-y-4 p-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Szybki wydatek</h2>
                <button
                  onClick={handleClose}
                  className="text-muted-foreground hover:text-foreground text-xl leading-none"
                  aria-label="Zamknij"
                >
                  ×
                </button>
              </div>

              {/* Amount */}
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  Kwota (PLN)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>

              {/* Category chips */}
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Kategoria</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setCategory(key)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        category === key
                          ? 'bg-primary text-white'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cost type */}
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Typ kosztu</p>
                <div className="flex gap-2">
                  {(
                    [
                      ['indirect', 'Ogólny'],
                      ['direct', 'Bezpośredni'],
                    ] as [CostType, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setCostType(key)}
                      className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
                        costType === key
                          ? 'bg-primary text-white'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* VAT checkbox */}
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={hasVat}
                  onChange={(e) => setHasVat(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm">Mam fakturę VAT do odliczenia</span>
              </label>

              {/* Więcej toggle */}
              <button
                onClick={() => setShowMore((v) => !v)}
                className="text-sm text-primary underline-offset-2 hover:underline"
              >
                {showMore ? '▲ Ukryj szczegóły' : '▼ Więcej (od kogo, numer, data)'}
              </button>

              {showMore && (
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Od kogo (np. Orlen, Biedronka)"
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {/* Error */}
              {error && <p className="text-sm text-destructive">{error}</p>}

              {/* Actions */}
              <div className="flex gap-3 pb-2">
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Anuluj
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={mutation.isPending}
                  loading={mutation.isPending}
                  className="flex-1"
                >
                  Zapisz wydatek
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

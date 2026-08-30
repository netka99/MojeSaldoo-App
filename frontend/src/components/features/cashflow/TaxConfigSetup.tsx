import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { Button } from '@/components/ui/Button';
import { useTaxConfigQuery, useUpdateTaxConfigMutation } from '@/query/use-cashflow';

interface TaxConfigSetupProps {
  open: boolean;
  onClose: () => void;
}

export function TaxConfigSetup({ open, onClose }: TaxConfigSetupProps) {
  const { data: config } = useTaxConfigQuery();
  const mutation = useUpdateTaxConfigMutation();

  const [cashBalance, setCashBalance] = useState('');
  const [bankBalance, setBankBalance] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setCashBalance(config.cash_balance);
      setBankBalance(config.bank_balance);
    }
  }, [config]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleSave = async () => {
    setError(null);
    try {
      await mutation.mutateAsync({
        cash_balance: cashBalance || '0',
        bank_balance: bankBalance || '0',
      });
      onClose();
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

  return createPortal(
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
            onClick={onClose}
          />
          <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto w-full max-w-sm rounded-2xl bg-background shadow-xl"
            >
              <div className="space-y-5 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Stan konta</h2>
                  <button
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground text-xl leading-none"
                    aria-label="Zamknij"
                  >
                    ×
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">
                      Gotówka / kasetka (PLN)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={cashBalance}
                      onChange={(e) => setCashBalance(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">
                      Konto firmowe (PLN)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={bankBalance}
                      onChange={(e) => setBankBalance(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-3">
                  <Button variant="outline" onClick={onClose} className="flex-1">
                    Anuluj
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={mutation.isPending}
                    loading={mutation.isPending}
                    className="flex-1"
                  >
                    Zapisz
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

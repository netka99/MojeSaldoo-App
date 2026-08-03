import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Button } from '@/components/ui/Button';
import { useTaxConfigQuery, useUpdateTaxConfigMutation } from '@/query/use-cashflow';
import { TAX_FORM_LABELS, type TaxForm, type VatMethod } from '@/types/cashflow.types';

interface TaxConfigSetupProps {
  open: boolean;
  onClose: () => void;
}

export function TaxConfigSetup({ open, onClose }: TaxConfigSetupProps) {
  const { data: config } = useTaxConfigQuery();
  const mutation = useUpdateTaxConfigMutation();

  const [cashBalance, setCashBalance] = useState('');
  const [bankBalance, setBankBalance] = useState('');
  const [taxForm, setTaxForm] = useState<TaxForm>('kpir_linear');
  const [taxRate, setTaxRate] = useState('19.00');
  const [vatPayer, setVatPayer] = useState(true);
  const [vatMethod, setVatMethod] = useState<VatMethod>('memoriałowa');
  const [vatDueDay, setVatDueDay] = useState('25');
  const [zusDueDay, setZusDueDay] = useState('20');
  const [showTaxSettings, setShowTaxSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate from loaded config
  useEffect(() => {
    if (config) {
      setCashBalance(config.cash_balance);
      setBankBalance(config.bank_balance);
      setTaxForm(config.tax_form);
      setTaxRate(config.tax_rate);
      setVatPayer(config.vat_payer);
      setVatMethod(config.vat_method);
      setVatDueDay(String(config.vat_due_day));
      setZusDueDay(String(config.zus_due_day));
    }
  }, [config]);

  const handleSave = async () => {
    setError(null);
    try {
      await mutation.mutateAsync({
        cash_balance: cashBalance || '0',
        bank_balance: bankBalance || '0',
        tax_form: taxForm,
        tax_rate: taxRate,
        vat_payer: vatPayer,
        vat_method: vatPayer ? vatMethod : 'memoriałowa',
        vat_due_day: parseInt(vatDueDay) || 25,
        zus_due_day: parseInt(zusDueDay) || 20,
      });
      onClose();
    } catch {
      setError('Błąd przy zapisie. Spróbuj ponownie.');
    }
  };

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
            onClick={onClose}
          />

          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="fixed bottom-0 left-0 right-0 z-[55] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-background shadow-xl"
          >
            <div className="space-y-5 p-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Aktualizuj saldo</h2>
                <button
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground text-xl leading-none"
                  aria-label="Zamknij"
                >
                  ×
                </button>
              </div>

              {/* Balance fields — prominent */}
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

              {/* Due dates — always visible */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">
                    VAT płatny do (dzień)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="31"
                    value={vatDueDay}
                    onChange={(e) => setVatDueDay(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">Domyślnie 25.</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">
                    ZUS płatny do (dzień)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="31"
                    value={zusDueDay}
                    onChange={(e) => setZusDueDay(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">Domyślnie 20.</p>
                </div>
              </div>

              {/* Tax settings — collapsible */}
              <button
                onClick={() => setShowTaxSettings((v) => !v)}
                className="text-sm text-primary underline-offset-2 hover:underline"
              >
                {showTaxSettings ? '▲ Ukryj ustawienia podatkowe' : '▼ Ustawienia podatkowe'}
              </button>

              {showTaxSettings && (
                <div className="space-y-4 rounded-xl border border-border p-4">
                  {/* Tax form */}
                  <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">
                      Forma opodatkowania
                    </label>
                    <select
                      value={taxForm}
                      onChange={(e) => setTaxForm(e.target.value as TaxForm)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {(Object.entries(TAX_FORM_LABELS) as [TaxForm, string][]).map(
                        ([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  {/* Tax rate (for ryczalt) */}
                  {taxForm === 'ryczalt' && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-muted-foreground">
                        Stawka ryczałtu (%)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={taxRate}
                        onChange={(e) => setTaxRate(e.target.value)}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        step="0.5"
                        min="0"
                        max="100"
                      />
                    </div>
                  )}

                  {/* VAT payer */}
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={vatPayer}
                      onChange={(e) => setVatPayer(e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm font-medium">Jestem płatnikiem VAT</span>
                  </label>

                  {/* VAT method — only shown for VAT payers */}
                  {vatPayer && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-muted-foreground">
                        Metoda rozliczania VAT
                      </label>
                      <div className="flex gap-2">
                        {(
                          [
                            ['memoriałowa', 'Memoriałowa (od daty wystawienia)'],
                            ['kasowa', 'Kasowa'],
                          ] as [VatMethod, string][]
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setVatMethod(key)}
                            className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
                              vatMethod === key
                                ? 'bg-primary text-white'
                                : 'bg-muted text-muted-foreground hover:bg-accent'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {vatMethod === 'kasowa'
                          ? 'VAT liczony od faktur opłaconych (metoda kasowa).'
                          : 'VAT liczony od daty wystawienia faktury (standard).'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-3 pb-2">
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
        </>
      )}
    </AnimatePresence>
  );
}

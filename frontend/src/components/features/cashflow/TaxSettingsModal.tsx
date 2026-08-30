import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { Button } from '@/components/ui/Button';
import { useTaxConfigQuery, useUpdateTaxConfigMutation } from '@/query/use-cashflow';
import { TAX_FORM_LABELS, type TaxForm, type VatMethod } from '@/types/cashflow.types';

interface TaxSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function TaxSettingsModal({ open, onClose }: TaxSettingsModalProps) {
  const { data: config } = useTaxConfigQuery();
  const mutation = useUpdateTaxConfigMutation();

  const [taxForm, setTaxForm] = useState<TaxForm>('kpir_linear');
  const [taxRate, setTaxRate] = useState('19.00');
  const [vatPayer, setVatPayer] = useState(true);
  const [vatMethod, setVatMethod] = useState<VatMethod>('memoriałowa');
  const [vatDueDay, setVatDueDay] = useState('25');
  const [zusDueDay, setZusDueDay] = useState('20');
  const [zusStatus, setZusStatus] = useState<string>('pelny_zus');
  const [hasSickInsurance, setHasSickInsurance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setTaxForm(config.tax_form);
      setTaxRate(config.tax_rate);
      setVatPayer(config.vat_payer);
      setVatMethod(config.vat_method);
      setVatDueDay(String(config.vat_due_day));
      setZusDueDay(String(config.zus_due_day));
      setZusStatus(config.zus_status ?? 'pelny_zus');
      setHasSickInsurance(config.has_sick_insurance ?? false);
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
        tax_form: taxForm,
        tax_rate: taxRate,
        vat_payer: vatPayer,
        vat_method: vatPayer ? vatMethod : 'memoriałowa',
        vat_due_day: parseInt(vatDueDay) || 25,
        zus_due_day: parseInt(zusDueDay) || 20,
        zus_status: zusStatus,
        has_sick_insurance: hasSickInsurance,
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
              className="pointer-events-auto w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-background shadow-xl"
            >
              <div className="space-y-5 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Ustawienia podatkowe</h2>
                  <button
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground text-xl leading-none"
                    aria-label="Zamknij"
                  >
                    ×
                  </button>
                </div>

                {/* Due dates */}
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

                {/* ZUS status */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-muted-foreground">
                    Status ZUS
                  </label>
                  <select
                    value={zusStatus}
                    onChange={(e) => setZusStatus(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="ulga_na_start">Ulga na start (brak składek społ.)</option>
                    <option value="preferencyjny">Preferencyjny ZUS</option>
                    <option value="maly_zus_plus">Mały ZUS Plus</option>
                    <option value="pelny_zus">Pełny ZUS</option>
                    <option value="etat_plus_jdg">Etat + JDG (etat ≥ 4 806 zł)</option>
                  </select>
                </div>

                {!['ulga_na_start', 'etat_plus_jdg'].includes(zusStatus) && (
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={hasSickInsurance}
                      onChange={(e) => setHasSickInsurance(e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm font-medium">Dobrowolna składka chorobowa (2,45%)</span>
                  </label>
                )}

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
                    {(Object.entries(TAX_FORM_LABELS) as [TaxForm, string][]).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

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

                {vatPayer && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">
                      Metoda rozliczania VAT
                    </label>
                    <div className="flex gap-2">
                      {(
                        [
                          ['memoriałowa', 'Memoriałowa'],
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
                        ? 'VAT liczony od faktur opłaconych.'
                        : 'VAT liczony od daty wystawienia faktury (standard).'}
                    </p>
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
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { productService, type ImportProductError } from '@/services/product.service';
import { useImportProductsMutation } from '@/query/use-products';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

type Step = 'upload' | 'preview' | 'done';

const COLUMNS_INFO = [
  { name: 'Nazwa', required: true, hint: 'Nazwa produktu' },
  { name: 'Jednostka', required: true, hint: 'np. szt, kg, godz' },
  { name: 'Cena brutto', required: true, hint: 'Liczba, np. 2.50 lub 2,50' },
  { name: 'VAT (%)', required: true, hint: 'Dozwolone: 0, 5, 8, 23' },
  { name: 'SKU', required: false, hint: 'Kod wewnętrzny — używany do aktualizacji' },
  { name: 'Kod kreskowy', required: false, hint: '' },
  { name: 'Opis', required: false, hint: '' },
  { name: 'Alert minimalny', required: false, hint: 'Stan poniżej którego pojawi się alert' },
  { name: 'Cena netto', required: false, hint: 'Jeśli pusta — wyliczana z brutto i VAT' },
  { name: 'Typ (produkt/usługa)', required: false, hint: 'Wpisz: produkt lub usługa' },
  { name: 'PKWiU', required: false, hint: 'Kod PKWiU, np. 10.71.11' },
  { name: 'Termin przydatności (dni)', required: false, hint: 'Liczba całkowita, np. 3' },
  { name: 'Koszt własny', required: false, hint: 'Cena zakupu / koszt produkcji' },
  { name: 'Narzut %', required: false, hint: 'Liczba, np. 30' },
  { name: 'Do sprzedaży (tak/nie)', required: false, hint: 'Domyślnie: tak' },
  { name: 'Śledzenie partii (tak/nie)', required: false, hint: 'Domyślnie: tak' },
  { name: 'Aktywny (tak/nie)', required: false, hint: 'Domyślnie: tak' },
] as const;

export function ProductImportDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [preview, setPreview] = useState<{ toCreate: number; toUpdate: number; toSkip: number; validCount: number } | null>(null);
  const [errors, setErrors] = useState<ImportProductError[]>([]);
  const [commitResult, setCommitResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const importMutation = useImportProductsMutation();
  const isBusy = importMutation.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isBusy, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setErrors([]);
    setSubmitError(null);
    setStep('upload');
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleValidate = async () => {
    if (!file) return;
    setSubmitError(null);
    try {
      const result = await importMutation.mutateAsync({ file, dryRun: true });
      setPreview({
        toCreate: result.to_create ?? 0,
        toUpdate: result.to_update ?? 0,
        toSkip: result.to_skip ?? 0,
        validCount: result.valid_count ?? 0,
      });
      setErrors(result.errors);
      setStep('preview');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Błąd walidacji.');
    }
  };

  const handleConfirm = async () => {
    if (!file) return;
    setSubmitError(null);
    try {
      const result = await importMutation.mutateAsync({ file, dryRun: false });
      setCommitResult({ created: result.created ?? 0, updated: result.updated ?? 0, skipped: result.skipped ?? 0 });
      setStep('done');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Błąd importu.');
    }
  };

  const handleTemplateDownload = async () => {
    try {
      await productService.downloadImportTemplate();
    } catch {
      // silent
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={(e) => { if (!isBusy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="max-h-[min(90vh,680px)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-surface-card p-0 shadow-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="border-0 bg-surface-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle id={titleId} className="text-xl">
              Import produktów
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Wgraj plik CSV lub XLSX z listą produktów.{' '}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={handleTemplateDownload}
              >
                Pobierz szablon
              </button>
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* ── Step: upload ─────────────────────────────────────── */}
            {(step === 'upload' || step === 'preview') && (
              <>
                {/* Drop zone */}
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click(); }}
                  aria-label="Przeciągnij plik lub kliknij aby wybrać"
                >
                  <svg className="h-8 w-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  {file ? (
                    <p className="text-sm font-medium text-foreground">{file.name}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Przeciągnij plik lub kliknij aby wybrać</p>
                  )}
                  <p className="text-xs text-muted-foreground">CSV lub XLSX</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </div>

                {/* ── Column format info ────────────────────────────── */}
                {step === 'upload' && (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50/60"
                      onClick={() => setShowColumns(v => !v)}
                      aria-expanded={showColumns}
                    >
                      <span className="text-sm font-medium text-slate-700">Jakie kolumny są obsługiwane?</span>
                      <svg
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${showColumns ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showColumns && (
                      <div className="border-t border-slate-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-left text-slate-400">
                              <th className="px-4 py-2 font-medium">Kolumna</th>
                              <th className="px-3 py-2 font-medium">Uwagi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {COLUMNS_INFO.map((col) => (
                              <tr key={col.name}>
                                <td className="px-4 py-1.5 font-medium text-slate-800">
                                  {col.name}
                                  {col.required && <span className="ml-0.5 text-destructive" aria-label="wymagane">*</span>}
                                </td>
                                <td className="px-3 py-1.5 text-slate-500">{col.hint}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="px-4 py-2 text-xs text-slate-400">* pole wymagane</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step: preview ─────────────────────────────────── */}
                {step === 'preview' && preview && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-center text-sm">
                      <div className="rounded-xl bg-green-50 px-3 py-2">
                        <p className="text-lg font-bold text-green-700">{preview.toCreate}</p>
                        <p className="text-xs text-green-600">nowych</p>
                      </div>
                      <div className="rounded-xl bg-blue-50 px-3 py-2">
                        <p className="text-lg font-bold text-blue-700">{preview.toUpdate}</p>
                        <p className="text-xs text-blue-600">aktualizacji</p>
                      </div>
                    </div>
                    {errors.length > 0 && (
                      <div className="max-h-48 overflow-y-auto rounded-xl border border-destructive/30 bg-destructive/5">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-destructive/20 text-left text-muted-foreground">
                              <th className="px-3 py-2 font-medium">Wiersz</th>
                              <th className="px-3 py-2 font-medium">Pole</th>
                              <th className="px-3 py-2 font-medium">Błąd</th>
                            </tr>
                          </thead>
                          <tbody>
                            {errors.map((err, i) => (
                              <tr key={i} className="border-b border-destructive/10 last:border-0">
                                <td className="px-3 py-1.5 text-muted-foreground">{err.row}</td>
                                <td className="px-3 py-1.5 font-medium text-destructive">{err.field}</td>
                                <td className="px-3 py-1.5 text-foreground">{err.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {submitError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
                    Anuluj
                  </Button>
                  {step === 'upload' && (
                    <Button type="button" disabled={!file || isBusy} loading={isBusy} onClick={handleValidate}>
                      Sprawdź plik
                    </Button>
                  )}
                  {step === 'preview' && preview && (
                    <>
                      <Button type="button" variant="outline" disabled={isBusy} onClick={() => setStep('upload')}>
                        Zmień plik
                      </Button>
                      <Button
                        type="button"
                        disabled={(preview.toCreate + preview.toUpdate) === 0 || isBusy}
                        loading={isBusy}
                        onClick={handleConfirm}
                      >
                        {(() => {
                          const n = preview.toCreate + preview.toUpdate;
                          return `Importuj ${n} ${n === 1 ? 'produkt' : n < 5 ? 'produkty' : 'produktów'}`;
                        })()}
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}

            {/* ── Step: done ───────────────────────────────────────── */}
            {step === 'done' && commitResult && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-base font-semibold text-foreground">Import zakończony</p>
                  <div className="grid grid-cols-2 gap-3 text-center text-sm">
                    <div className="rounded-xl bg-green-50 px-3 py-2">
                      <p className="text-lg font-bold text-green-700">{commitResult.created}</p>
                      <p className="text-xs text-green-600">dodanych</p>
                    </div>
                    <div className="rounded-xl bg-blue-50 px-3 py-2">
                      <p className="text-lg font-bold text-blue-700">{commitResult.updated}</p>
                      <p className="text-xs text-blue-600">zaktualizowanych</p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="button" onClick={onClose}>Gotowe</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>,
    document.body,
  );
}

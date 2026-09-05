/**
 * PurchaseDocumentCreatePage — manual entry form for a purchase document
 * (FZ, PAR, PAR_VAT). Can receive pre-filled data from the scanner via
 * router state: { docType, supplier_name, supplier_nip, document_number,
 *                 issue_date, total_gross, ocr_raw_filename }
 *
 * Route: /purchase-documents/new
 *        /purchase-documents/:id/edit
 */

import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import {
  useCreatePurchaseDocumentMutation,
  usePatchPurchaseDocumentMutation,
  usePurchaseDocumentQuery,
} from '@/query/use-purchase-documents';
import type { PurchaseDocDocType, PurchaseDocumentWrite } from '@/services/purchase-document.service';

interface ScannerState {
  docType?: PurchaseDocDocType;
  supplier_name?: string;
  supplier_nip?: string;
  document_number?: string;
  issue_date?: string;
  total_gross?: string;
  ocr_raw_filename?: string;
}

const todayIso = new Date().toISOString().slice(0, 10);

export function PurchaseDocumentCreatePage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <PurchaseDocumentForm />;
}

function PurchaseDocumentForm() {
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const scannerState = (location.state ?? {}) as ScannerState;

  // Load existing document for edit — wait until loaded before rendering
  const { data: existingDoc, isLoading: docLoading } = usePurchaseDocumentQuery(id);

  if (isEdit && docLoading) {
    return (
      <div className="flex min-h-full items-center justify-center py-24 text-[14px] text-gray-400">
        Ładowanie…
      </div>
    );
  }

  return <PurchaseDocumentFormInner id={id} isEdit={isEdit} scannerState={scannerState} existingDoc={existingDoc} />;
}

function PurchaseDocumentFormInner({
  id,
  isEdit,
  scannerState,
  existingDoc,
}: {
  id?: string;
  isEdit: boolean;
  scannerState: ScannerState;
  existingDoc?: import('@/services/purchase-document.service').PurchaseDocument;
}) {
  const navigate = useNavigate();

  const createMutation = useCreatePurchaseDocumentMutation();
  const patchMutation = usePatchPurchaseDocumentMutation();

  const [docType, setDocType] = useState<PurchaseDocDocType>(
    existingDoc?.doc_type ?? scannerState.docType ?? 'FZ',
  );
  const [supplierName, setSupplierName] = useState(
    existingDoc?.supplier_name ?? scannerState.supplier_name ?? '',
  );
  const [supplierNip, setSupplierNip] = useState(
    existingDoc?.supplier_nip ?? scannerState.supplier_nip ?? '',
  );
  const [documentNumber, setDocumentNumber] = useState(
    existingDoc?.document_number ?? scannerState.document_number ?? '',
  );
  const [issueDate, setIssueDate] = useState(
    existingDoc?.issue_date ?? scannerState.issue_date ?? todayIso,
  );
  const [dueDate, setDueDate] = useState(existingDoc?.due_date ?? '');
  const [paymentMethod, setPaymentMethod] = useState<'transfer' | 'cash' | 'card'>(
    existingDoc?.payment_method ?? 'transfer',
  );
  const [totalGross, setTotalGross] = useState(
    existingDoc?.total_gross ?? scannerState.total_gross ?? '',
  );
  const [totalNet, setTotalNet] = useState(existingDoc?.total_net ?? '');
  const [totalVat, setTotalVat] = useState(existingDoc?.total_vat ?? '');
  const [notes, setNotes] = useState(existingDoc?.notes ?? '');
  const [lines, setLines] = useState(() =>
    (existingDoc?.items ?? []).map((item, i) => ({
      id: i,
      product_name: item.product_name,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_gross: item.unit_price_gross,
      vat_rate: item.vat_rate,
    }))
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!totalGross || Number.isNaN(parseFloat(totalGross))) {
      setError('Podaj kwotę brutto.');
      return;
    }

    const payload: PurchaseDocumentWrite = {
      doc_type: docType,
      supplier_name: supplierName,
      supplier_nip: supplierNip,
      document_number: documentNumber,
      issue_date: issueDate || null,
      due_date: dueDate || null,
      payment_method: paymentMethod,
      total_gross: parseFloat(totalGross).toFixed(2),
      total_net: totalNet ? parseFloat(totalNet).toFixed(2) : '0.00',
      total_vat: totalVat ? parseFloat(totalVat).toFixed(2) : '0.00',
      notes: notes.trim(),
      ocr_raw_filename: scannerState.ocr_raw_filename ?? existingDoc?.ocr_raw_filename ?? '',
      ...(lines.length > 0 && {
        items_write: lines.filter((l) => l.product_name.trim()).map((l) => ({
          product_name: l.product_name,
          unit: l.unit || 'szt',
          quantity: l.quantity || '1',
          unit_price_gross: l.unit_price_gross || '0',
          vat_rate: l.vat_rate || '23',
        })),
      }),
    };

    try {
      if (isEdit && id) {
        await patchMutation.mutateAsync({ id, data: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      navigate('/purchase-documents');
    } catch {
      setError('Nie udało się zapisać dokumentu.');
    }
  }

  return (
    <div
      className="min-h-full pb-16"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", background: '#F5F5F7' }}
    >
      <div className="mx-auto max-w-2xl px-4 pt-8 sm:px-6">

        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm hover:bg-gray-50 transition-colors"
            aria-label="Wróć"
          >
            <svg className="h-5 w-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-gray-900">
              {isEdit ? 'Edytuj dokument zakupowy' : 'Nowy dokument zakupowy'}
            </h1>
            <p className="text-[13px] text-gray-500">Faktura zakupowa, paragon lub paragon z NIP</p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">

          {/* Doc type selector */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <label className="mb-3 block text-[13px] font-semibold text-gray-700">Rodzaj dokumentu</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'FZ',      label: 'Faktura (FZ)',   sub: 'Faktura zakupowa' },
                { value: 'PAR',     label: 'Paragon',        sub: 'Paragon fiskalny' },
                { value: 'PAR_VAT', label: 'Paragon z NIP',  sub: 'Faktura uproszczona' },
              ] as const).map(({ value, label, sub }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDocType(value)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-xl border-2 px-3 py-3 text-center transition-all',
                    docType === value
                      ? 'border-[#5856D6] bg-[#5856D6]/5 text-[#5856D6]'
                      : 'border-gray-200 text-gray-600 hover:border-[#5856D6]/30',
                  )}
                >
                  <span className="text-[13px] font-semibold">{label}</span>
                  <span className="mt-0.5 text-[10px] text-gray-400">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Supplier info */}
          <div className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-[15px] font-semibold text-gray-900">Dostawca</h2>

            <div>
              <label htmlFor="supplier_name" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                Nazwa dostawcy
              </label>
              <input
                id="supplier_name"
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="np. Firma ABC Sp. z o.o."
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
              />
            </div>

            <div>
              <label htmlFor="supplier_nip" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                NIP dostawcy
              </label>
              <input
                id="supplier_nip"
                type="text"
                value={supplierNip}
                onChange={(e) => setSupplierNip(e.target.value)}
                placeholder="10 cyfr"
                maxLength={10}
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
              />
            </div>
          </div>

          {/* Document details */}
          <div className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-[15px] font-semibold text-gray-900">Dane dokumentu</h2>

            <div>
              <label htmlFor="document_number" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                Numer dokumentu
              </label>
              <input
                id="document_number"
                type="text"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="np. FV/2026/001, nr paragonu"
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="issue_date" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                  Data wystawienia
                </label>
                <input
                  id="issue_date"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
                />
              </div>
              <div>
                <label htmlFor="due_date" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                  Termin płatności
                </label>
                <input
                  id="due_date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="payment_method" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                Sposób płatności
              </label>
              <select
                id="payment_method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'transfer' | 'cash' | 'card')}
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
              >
                <option value="transfer">Przelew</option>
                <option value="cash">Gotówka</option>
                <option value="card">Karta</option>
              </select>
            </div>
          </div>

          {/* Amounts */}
          <div className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-[15px] font-semibold text-gray-900">Kwoty</h2>

            <div>
              <label htmlFor="total_gross" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                Kwota brutto (PLN) <span className="text-red-500">*</span>
              </label>
              <input
                id="total_gross"
                type="number"
                min="0"
                step="0.01"
                required
                value={totalGross}
                onChange={(e) => setTotalGross(e.target.value)}
                placeholder="0.00"
                className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="total_net" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                  Netto (opcjonalnie)
                </label>
                <input
                  id="total_net"
                  type="number"
                  min="0"
                  step="0.01"
                  value={totalNet}
                  onChange={(e) => setTotalNet(e.target.value)}
                  placeholder="0.00"
                  className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
                />
              </div>
              <div>
                <label htmlFor="total_vat" className="mb-1.5 block text-[12px] font-medium text-gray-500">
                  VAT (opcjonalnie)
                </label>
                <input
                  id="total_vat"
                  type="number"
                  min="0"
                  step="0.01"
                  value={totalVat}
                  onChange={(e) => setTotalVat(e.target.value)}
                  placeholder="0.00"
                  className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-gray-900">Pozycje</h2>
              <button
                type="button"
                onClick={() => setLines((prev) => [
                  ...prev,
                  { id: Date.now(), product_name: '', quantity: '1', unit: 'szt', unit_price_gross: '', vat_rate: '23' },
                ])}
                className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:border-[#5856D6] hover:text-[#5856D6] transition-colors"
              >
                + Dodaj pozycję
              </button>
            </div>
            {lines.length === 0 ? (
              <p className="text-[13px] text-gray-400">Brak pozycji — kliknij „+ Dodaj pozycję".</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[640px] space-y-2">
                  <div className="grid grid-cols-[minmax(120px,1fr)_4rem_3.5rem_4.5rem_4rem_4.5rem_4rem_4.5rem_2rem] gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <span>Nazwa</span><span>Ilość</span><span>J.m.</span><span>Cena br.</span><span>VAT %</span>
                    <span className="text-right">Netto</span><span className="text-right">VAT zł</span><span className="text-right">Brutto</span><span />
                  </div>
                  {lines.map((line) => {
                    const qty = parseFloat(line.quantity) || 0;
                    const price = parseFloat(line.unit_price_gross) || 0;
                    const vat = parseFloat(line.vat_rate) || 0;
                    const gross = qty * price;
                    const net = gross > 0 ? gross / (1 + vat / 100) : 0;
                    const vatAmt = gross - net;
                    return (
                      <div key={line.id} className="grid grid-cols-[minmax(120px,1fr)_4rem_3.5rem_4.5rem_4rem_4.5rem_4rem_4.5rem_2rem] gap-1.5 items-center">
                        <input type="text" value={line.product_name} placeholder="Nazwa"
                          onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, product_name: e.target.value } : l))}
                          className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-1 focus:ring-[#5856D6]/20" />
                        <input type="number" min="0" step="0.001" value={line.quantity}
                          onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, quantity: e.target.value } : l))}
                          className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[13px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-1 focus:ring-[#5856D6]/20" />
                        <input type="text" value={line.unit} placeholder="szt"
                          onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, unit: e.target.value } : l))}
                          className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[13px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-1 focus:ring-[#5856D6]/20" />
                        <input type="number" min="0" step="0.01" value={line.unit_price_gross} placeholder="0.00"
                          onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, unit_price_gross: e.target.value } : l))}
                          className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[13px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-1 focus:ring-[#5856D6]/20" />
                        <select value={line.vat_rate}
                          onChange={(e) => setLines((p) => p.map((l) => l.id === line.id ? { ...l, vat_rate: e.target.value } : l))}
                          className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-1 text-[13px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-1 focus:ring-[#5856D6]/20">
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="8">8%</option>
                          <option value="23">23%</option>
                        </select>
                        <span className="text-right text-[12px] tabular-nums text-gray-400">{net > 0 ? net.toFixed(2) : '—'}</span>
                        <span className="text-right text-[12px] tabular-nums text-gray-400">{vatAmt > 0 ? vatAmt.toFixed(2) : '—'}</span>
                        <span className="text-right text-[13px] font-semibold tabular-nums text-gray-900 pr-1">{gross > 0 ? gross.toFixed(2) : '—'}</span>
                        <button type="button"
                          onClick={() => setLines((p) => p.filter((l) => l.id !== line.id))}
                          className="flex h-9 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {(() => {
                    const totals = lines.reduce((acc, l) => {
                      const gross = (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price_gross) || 0);
                      const net = gross > 0 ? gross / (1 + (parseFloat(l.vat_rate) || 0) / 100) : 0;
                      return { gross: acc.gross + gross, net: acc.net + net, vat: acc.vat + (gross - net) };
                    }, { gross: 0, net: 0, vat: 0 });
                    return (
                      <div className="mt-2 flex justify-end gap-6 border-t border-gray-100 pt-2">
                        <span className="text-[13px] text-gray-400">Netto: <span className="font-semibold tabular-nums text-gray-900">{totals.net.toFixed(2)} PLN</span></span>
                        <span className="text-[13px] text-gray-400">VAT: <span className="font-semibold tabular-nums text-gray-900">{totals.vat.toFixed(2)} PLN</span></span>
                        <span className="text-[13px] text-gray-400">Brutto: <span className="font-bold tabular-nums text-gray-900">{totals.gross.toFixed(2)} PLN</span></span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <label htmlFor="notes" className="mb-1.5 block text-[12px] font-medium text-gray-500">
              Notatki
            </label>
            <textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcjonalnie — dodatkowe informacje o dokumencie"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20 resize-none"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pb-8">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[14px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || patchMutation.isPending}
              className="flex-1 rounded-xl bg-[#5856D6] px-4 py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-[#4744C4] disabled:opacity-60 transition-colors"
            >
              {(createMutation.isPending || patchMutation.isPending) ? 'Zapisuję…' : isEdit ? 'Zapisz zmiany' : 'Utwórz dokument'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

/**
 * PurchaseDocumentsPage — unified incoming documents page.
 *
 * Tabs:
 *   Wszystkie    — merged KSeF + FZ + PAR_VAT + PAR, date-filtered, sorted by date
 *   Z KSeF       — full KSeF inbox (KSeFInboxContent, paginated, all features)
 *   Faktury (FZ) — manually registered FZ + PAR_VAT with full workflow
 *   Paragony     — fiscal receipts (PAR) with full workflow
 *
 * Route: /purchase-documents
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { KSeFInboxContent } from './KSeFInboxPage';
import { ksefService, isKorType } from '@/services/ksef.service';
import { purchaseDocumentService } from '@/services/purchase-document.service';
import {
  usePurchaseDocumentListQuery,
  useDeletePurchaseDocumentMutation,
  useMarkPurchaseDocPaidMutation,
  useSetPurchaseDocCategoryMutation,
  usePatchPurchaseDocumentMutation,
  useSetLinecategoriesMutation,
  useUnlinkPzMutation,
  useMatchProposalsQuery,
  useConfirmLineMatchesMutation,
  type PurchaseDocListFilters,
} from '@/query/use-purchase-documents';
import { useAllPzQuery } from '@/query/use-delivery';
import { useOpexCategoriesQuery, useCreateOpexCategoryMutation } from '@/query/use-cashflow';
import { OpexCategoryManager } from '@/components/features/cashflow/OpexCategoryManager';
import type { PurchaseDocument, PurchaseDocDocType } from '@/services/purchase-document.service';
import type { ReceivedInvoiceMeta } from '@/services/ksef.service';

// ─── Formatters ──────────────────────────────────────────────────────────────

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
const plMoney = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function formatGross(value: string | number | null | undefined, currency = 'PLN'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (Number.isNaN(n)) return '—';
  if (currency === 'PLN') return plMoney.format(n);
  return `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;
}

function docTypeLabel(t: PurchaseDocDocType): string {
  switch (t) {
    case 'FZ':      return 'FZ';
    case 'PAR':     return 'Paragon';
    case 'PAR_VAT': return 'PAR z NIP';
  }
}

function docTypeBadge(t: PurchaseDocDocType): string {
  switch (t) {
    case 'FZ':      return 'bg-blue-100 text-blue-800';
    case 'PAR':     return 'bg-amber-100 text-amber-800';
    case 'PAR_VAT': return 'bg-orange-100 text-orange-800';
  }
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function monthAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

// ─── PurchaseDocPayButton ─────────────────────────────────────────────────────

function PurchaseDocPayButton({ doc }: { doc: PurchaseDocument }) {
  const markPaid = useMarkPurchaseDocPaidMutation();
  const today = todayIso();
  const isOverdue = !doc.is_paid && !!doc.due_date && doc.due_date < today;

  return (
    <button
      type="button"
      disabled={markPaid.isPending}
      onClick={() => markPaid.mutate({ id: doc.id, isPaid: !doc.is_paid })}
      title={doc.is_paid ? 'Kliknij aby cofnąć' : 'Oznacz jako opłacone'}
      className={cn(
        'inline-flex items-center h-7 px-2.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap',
        doc.is_paid
          ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
          : isOverdue
            ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
      )}
    >
      {markPaid.isPending ? '…' : doc.is_paid ? '✓ Opłacono' : isOverdue ? '↑ Zaległe' : 'Opłać'}
    </button>
  );
}

// ─── LineMatchConfirmTable — step 2: confirm auto-proposed line matches ────────

function LineMatchConfirmTable({
  doc,
  pzId,
  onConfirmed,
  onCancel,
}: {
  doc: PurchaseDocument;
  pzId: string;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const { data, isPending, isError } = useMatchProposalsQuery(doc.id, pzId);
  const confirmM = useConfirmLineMatchesMutation();

  // editable quantities keyed by `${invoiceItemId}__${deliveryItemId}`
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // manual pairings: invoice item id → delivery item id (for unmatched items)
  const [manualPairs, setManualPairs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // initialise quantities when proposals load
  useEffect(() => {
    if (!data) return;
    const init: Record<string, string> = {};
    data.proposals.forEach((p) => {
      init[`${p.invoice_item.id}__${p.delivery_item.id}`] = p.quantity_matched;
    });
    setQuantities(init);
  }, [data]);

  const handleConfirm = async () => {
    if (!data) return;
    setError(null);
    const matches = [
      ...data.proposals.map((p) => ({
        invoice_item_id: p.invoice_item.id,
        delivery_item_id: p.delivery_item.id,
        quantity_matched: quantities[`${p.invoice_item.id}__${p.delivery_item.id}`] ?? p.quantity_matched,
      })),
      ...Object.entries(manualPairs)
        .filter(([, delId]) => delId)
        .map(([invId, delId]) => ({
          invoice_item_id: invId,
          delivery_item_id: delId,
          quantity_matched: quantities[`${invId}__${delId}`] ?? '0',
        })),
    ].filter((m) => parseFloat(m.quantity_matched) > 0);

    if (matches.length === 0) {
      setError('Brak pozycji do powiązania — sprawdź ilości.');
      return;
    }

    try {
      await confirmM.mutateAsync({ id: doc.id, payload: { pz_id: pzId, matches } });
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zatwierdzić.');
    }
  };

  if (isPending) return <p className="text-[11px] text-gray-400 py-2">Ładowanie propozycji…</p>;
  if (isError) return <p className="text-[11px] text-red-500 py-2">Błąd ładowania propozycji.</p>;
  if (!data) return null;

  const plNum = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <div className="mt-2 space-y-3">
      <p className="text-[11px] text-gray-500 leading-snug">
        Sprawdź dopasowanie pozycji i skoryguj ilości jeśli potrzeba. Kliknij <strong>Zatwierdź</strong> aby zapisać.
      </p>

      {/* Matched proposals */}
      {data.proposals.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Dopasowane automatycznie</p>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[10px] text-gray-400 border-b border-gray-100">
                <th className="px-3 py-1.5 text-left font-medium">Pozycja faktury</th>
                <th className="px-3 py-1.5 text-left font-medium">Pozycja PZ</th>
                <th className="px-3 py-1.5 text-right font-medium">Fakt.</th>
                <th className="px-3 py-1.5 text-right font-medium">PZ</th>
                <th className="px-3 py-1.5 text-right font-medium">Powiąż</th>
                <th className="px-2 py-1.5 text-center font-medium w-5"
                    title={data.proposals[0]?.match_type === 'exact' ? 'Dokładne' : 'Przybliżone'}>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.proposals.map((p) => {
                const key = `${p.invoice_item.id}__${p.delivery_item.id}`;
                const isExact = p.match_type === 'exact' || p.confidence >= 1.0;
                const confidencePct = Math.round(p.confidence * 100);
                const matchLabel = p.match_type === 'exact'
                  ? 'Dokładne dopasowanie (produkt z bazy)'
                  : p.confidence >= 1.0
                    ? 'Identyczna nazwa'
                    : `Dopasowanie po nazwie (${confidencePct}%)`;
                return (
                  <tr key={key} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-1.5 text-gray-800 max-w-[140px] truncate" title={p.invoice_item.product_name}>
                      {p.invoice_item.product_name}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 max-w-[140px] truncate" title={p.delivery_item.product_name}>
                      {p.delivery_item.product_name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
                      {plNum.format(parseFloat(p.invoice_item.quantity))} {p.invoice_item.unit}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
                      {plNum.format(parseFloat(p.delivery_item.quantity_available))}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={quantities[key] ?? p.quantity_matched}
                        onChange={(e) => setQuantities((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="w-20 rounded border border-gray-200 px-1.5 py-0.5 text-right text-[11px] tabular-nums focus:border-indigo-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span title={matchLabel} className={isExact ? 'text-emerald-500' : 'text-amber-500'}>
                        {isExact ? '●' : `◐${confidencePct}%`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Unmatched invoice items — allow manual pairing */}
      {data.unmatched_invoice_items.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/30 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-amber-100 bg-amber-50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
              Pozycje faktury bez dopasowania na PZ
            </p>
          </div>
          <div className="divide-y divide-amber-50">
            {data.unmatched_invoice_items.map((inv) => (
              <div key={inv.id} className="px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-800 truncate">{inv.product_name}</p>
                  <p className="text-[10px] text-gray-400">{plNum.format(parseFloat(inv.quantity))} {inv.unit}</p>
                </div>
                <select
                  value={manualPairs[inv.id] ?? ''}
                  onChange={(e) => {
                    const delId = e.target.value;
                    setManualPairs((prev) => ({ ...prev, [inv.id]: delId }));
                    if (delId) {
                      const delItem = data.unmatched_delivery_items.find((d) => d.id === delId);
                      if (delItem) {
                        const key = `${inv.id}__${delId}`;
                        setQuantities((prev) => ({
                          ...prev,
                          [key]: String(Math.min(parseFloat(inv.quantity_unmatched), parseFloat(delItem.quantity_available))),
                        }));
                      }
                    }
                  }}
                  className="text-[11px] rounded border border-gray-200 bg-white px-2 py-1 min-w-[160px]"
                >
                  <option value="">— wybierz pozycję PZ —</option>
                  {data.unmatched_delivery_items.map((d) => (
                    <option key={d.id} value={d.id}>{d.product_name} ({plNum.format(parseFloat(d.quantity_available))})</option>
                  ))}
                </select>
                {manualPairs[inv.id] && (
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={quantities[`${inv.id}__${manualPairs[inv.id]}`] ?? ''}
                    onChange={(e) => {
                      const key = `${inv.id}__${manualPairs[inv.id]}`;
                      setQuantities((prev) => ({ ...prev, [key]: e.target.value }));
                    }}
                    className="w-20 rounded border border-gray-200 px-1.5 py-0.5 text-right text-[11px] tabular-nums focus:border-indigo-400 focus:outline-none"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched delivery items — info only */}
      {data.unmatched_delivery_items.length > 0 && data.unmatched_invoice_items.length === 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 mb-1">Tylko na PZ (brak na fakturze)</p>
          {data.unmatched_delivery_items.map((d) => (
            <p key={d.id} className="text-[11px] text-gray-600">+ {d.product_name} ({plNum.format(parseFloat(d.quantity_available))})</p>
          ))}
        </div>
      )}

      {data.proposals.length === 0 && data.unmatched_invoice_items.length === 0 && (
        <p className="text-[11px] text-gray-400 italic">Brak pozycji do dopasowania.</p>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="text-[11px] text-gray-500 hover:text-gray-700 underline">
          Anuluj
        </button>
        <button
          type="button"
          disabled={confirmM.isPending}
          onClick={() => void handleConfirm()}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {confirmM.isPending ? '…' : 'Zatwierdź powiązanie'}
        </button>
      </div>
    </div>
  );
}

// ─── MatchPzPanelForDoc ───────────────────────────────────────────────────────

function MatchPzPanelForDoc({ doc, onClose }: { doc: PurchaseDocument; onClose: () => void }) {
  const { data: allPzs = [], isPending } = useAllPzQuery(true);
  const [confirmingPzId, setConfirmingPzId] = useState<string | null>(null);
  const [justLinkedIds, setJustLinkedIds] = useState<Set<string>>(new Set());

  const alreadyLinkedIds = new Set((doc.pz_documents ?? []).map((p) => p.id));

  return (
    <div className="mt-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 space-y-2 min-w-[300px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-gray-700">
          {confirmingPzId ? 'Dopasuj pozycje' : 'Powiąż z dokumentem PZ'}
        </p>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700">✕</button>
      </div>

      {!confirmingPzId && (
        <>
          <p className="text-[11px] text-gray-500 leading-snug">
            Kliknij <strong>Powiąż</strong> przy wybranym PZ — system pokaże propozycję dopasowania pozycji do zatwierdzenia.
            Możesz powiązać kilka PZ do jednej faktury.
          </p>

          {justLinkedIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
              <p className="text-[11px] text-emerald-700 font-medium">
                ✓ Powiązano {justLinkedIds.size} {justLinkedIds.size === 1 ? 'PZ' : 'PZ'}. Możesz dodać kolejne lub zamknąć panel.
              </p>
              <button type="button" onClick={onClose}
                className="shrink-0 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline">
                Zamknij
              </button>
            </div>
          )}

          {isPending && <p className="text-xs text-gray-400">Ładowanie…</p>}
          {!isPending && allPzs.length === 0 && (
            <p className="text-xs text-gray-400 italic">Brak dokumentów PZ.</p>
          )}
          {!isPending && allPzs.length > 0 && (
            <div className="space-y-1.5">
              {allPzs.map((pz) => {
                const isLinked = alreadyLinkedIds.has(pz.id) || justLinkedIds.has(pz.id);
                return (
                  <div key={pz.id} className={cn(
                    'rounded-lg border bg-white overflow-hidden',
                    isLinked ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200',
                  )}>
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[12px] font-medium text-gray-800">
                            {pz.document_number || pz.id.slice(0, 8)}
                          </p>
                          {isLinked && (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              ✓ powiązano
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400">
                          {pz.issue_date} · {pz.to_warehouse_name ?? '—'}
                          {pz.supplier_name && ` · ${pz.supplier_name}`}
                        </p>
                      </div>
                      {!isLinked ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingPzId(pz.id)}
                          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          Powiąż
                        </button>
                      ) : (
                        <span className="shrink-0 text-[10px] text-emerald-600">✓</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmingPzId && (
        <LineMatchConfirmTable
          doc={doc}
          pzId={confirmingPzId}
          onConfirmed={() => {
            setJustLinkedIds((prev) => new Set([...prev, confirmingPzId]));
            setConfirmingPzId(null);
          }}
          onCancel={() => setConfirmingPzId(null)}
        />
      )}
    </div>
  );
}

// ─── PurchaseDocPzButton ──────────────────────────────────────────────────────

function PurchaseDocPzButton({ doc }: { doc: PurchaseDocument }) {
  const [showMatchPanel, setShowMatchPanel] = useState(false);
  const navigate = useNavigate();
  const unlinkPz = useUnlinkPzMutation();

  // Only FZ and PAR_VAT make sense for PZ creation/matching
  if (doc.doc_type === 'PAR') return null;

  const linkedPzs = doc.pz_documents ?? [];

  // Already has linked PZ — show tags with unlink + option to add more
  if (linkedPzs.length > 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1">
          {linkedPzs.map((pz) => (
            <div key={pz.id} className="inline-flex items-stretch h-7 rounded-md border border-indigo-200 bg-indigo-50 overflow-hidden">
              <Link
                to={`/delivery/${pz.id}`}
                className="flex items-center px-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                title="Przejdź do PZ"
              >
                PZ: {pz.document_number || pz.id.slice(0, 8)}
              </Link>
              <button
                type="button"
                disabled={unlinkPz.isPending}
                onClick={() => unlinkPz.mutate({ id: doc.id, pzId: pz.id })}
                className="flex items-center px-1.5 text-[10px] text-indigo-400 border-l border-indigo-200 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="Odepnij PZ"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setShowMatchPanel((v) => !v)}
            className="inline-flex items-center h-7 px-2 rounded-md border border-dashed border-indigo-300 text-[10px] text-indigo-500 hover:bg-indigo-50 transition-colors whitespace-nowrap"
            title="Dodaj kolejne dopasowanie PZ"
          >
            + PZ
          </button>
        </div>
        {showMatchPanel && <MatchPzPanelForDoc doc={doc} onClose={() => setShowMatchPanel(false)} />}
      </div>
    );
  }

  // No linked PZ — navigate to dedicated creation page (warehouse picker there)
  return (
    <button
      type="button"
      onClick={() => navigate(`/purchase-documents/${doc.id}/create-pz`)}
      className="text-[12px] text-gray-400 hover:text-[#5856D6] transition-colors whitespace-nowrap"
    >
      + Utwórz PZ
    </button>
  );
}

// ─── PurchaseDocAnnotationButton ─────────────────────────────────────────────

type AccountingStatus = 'pending' | 'annotated' | 'booked';

const ACCOUNTING_STATUS_LABEL: Record<AccountingStatus, string> = {
  pending: 'Oczekuje',
  annotated: 'Opisana',
  booked: 'Zaksięgowana',
};
const ACCOUNTING_STATUS_STYLE: Record<AccountingStatus, string> = {
  pending:   'border-gray-200 bg-gray-50 text-gray-500',
  annotated: 'border-blue-200 bg-blue-50 text-blue-700',
  booked:    'border-green-200 bg-green-50 text-green-700',
};

function PurchaseDocAnnotationButton({ doc }: { doc: PurchaseDocument }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AccountingStatus>(doc.accounting_status);
  const [notes, setNotes] = useState(doc.accounting_notes);
  const ref = useRef<HTMLDivElement>(null);
  const patch = usePatchPurchaseDocumentMutation();

  useEffect(() => {
    setStatus(doc.accounting_status);
    setNotes(doc.accounting_notes);
  }, [doc.accounting_status, doc.accounting_notes]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSave() {
    patch.mutate(
      { id: doc.id, data: { accounting_status: status, accounting_notes: notes } },
      { onSuccess: () => setOpen(false) },
    );
  }

  const currentStatus = doc.accounting_status;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setStatus(doc.accounting_status); setNotes(doc.accounting_notes); }}
        className={cn(
          'inline-flex items-center h-7 px-2.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap',
          ACCOUNTING_STATUS_STYLE[currentStatus],
          open && 'ring-1 ring-offset-0',
        )}
        title="Adnotacja kosztowa"
      >
        {ACCOUNTING_STATUS_LABEL[currentStatus]}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status księgowy</div>
          <div className="mb-3 flex gap-1.5 flex-wrap">
            {(Object.keys(ACCOUNTING_STATUS_LABEL) as AccountingStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors',
                  status === s
                    ? ACCOUNTING_STATUS_STYLE[s].replace('bg-', 'bg-').replace('50', '100') + ' ring-1'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                )}
              >
                {ACCOUNTING_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Notatka</div>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="MPK, opis kosztu, projekt…"
            className="w-full resize-none rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-[#5856D6] focus:outline-none focus:ring-1 focus:ring-[#5856D6]/30"
          />
          <button
            type="button"
            disabled={patch.isPending}
            onClick={handleSave}
            className="mt-2 w-full rounded-lg bg-[#5856D6] py-1.5 text-xs font-semibold text-white hover:bg-[#4744C4] disabled:opacity-50"
          >
            {patch.isPending ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PurchaseDocCategoryTag ───────────────────────────────────────────────────

function PurchaseDocCategoryTag({ doc }: { doc: PurchaseDocument }) {
  const [open, setOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useOpexCategoriesQuery();
  const setCategory = useSetPurchaseDocCategoryMutation();
  const createCat = useCreateOpexCategoryMutation();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAddingNew(false);
        setNewName('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(slug: string | null) {
    setCategory.mutate({ id: doc.id, category: slug });
    setOpen(false);
    setAddingNew(false);
    setNewName('');
  }

  async function handleCreateAndSelect() {
    if (!newName.trim()) return;
    const created = await createCat.mutateAsync({ name: newName.trim() });
    if (created.slug) handleSelect(created.slug);
    setAddingNew(false);
    setNewName('');
  }

  const currentCat = doc.opex_category
    ? (categories.find((c) => c.slug === doc.opex_category)?.name ?? doc.opex_category)
    : null;

  const dropdown = (
    <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] rounded-md border border-gray-200 bg-white shadow-lg">
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => handleSelect(cat.slug)}
          className={cn(
            'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50',
            cat.slug === doc.opex_category && 'font-semibold text-[#5856D6]',
          )}
        >
          {cat.name}
        </button>
      ))}
      <div className="border-t border-gray-100">
        {addingNew ? (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateAndSelect(); }}
              placeholder="Nazwa kategorii..."
              className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#5856D6]"
            />
            <button
              type="button"
              onClick={() => void handleCreateAndSelect()}
              disabled={!newName.trim() || createCat.isPending}
              className="shrink-0 text-xs font-medium text-[#5856D6] disabled:opacity-40"
            >
              OK
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="w-full text-left px-3 py-1.5 text-xs text-[#5856D6] hover:bg-gray-50"
          >
            + Dodaj kategorię…
          </button>
        )}
      </div>
      {doc.opex_category && (
        <div className="border-t border-gray-100">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50"
          >
            Usuń kategorię
          </button>
        </div>
      )}
    </div>
  );

  if (currentCat) {
    return (
      <div className="relative inline-flex items-center gap-1 group" ref={ref}>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setAddingNew(false); setNewName(''); }}
          className="text-[12px] text-gray-700 hover:text-gray-900 transition-colors leading-none"
        >
          {currentCat}
        </button>
        <button
          type="button"
          onClick={() => handleSelect(null)}
          disabled={setCategory.isPending}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-300 hover:text-red-400 transition-all leading-none"
          title="Usuń kategorię"
        >
          ✕
        </button>
        {open && dropdown}
      </div>
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setAddingNew(false); setNewName(''); }}
        className="text-[12px] text-gray-400 hover:text-[#5856D6] transition-colors leading-none"
      >
        + Kategoria
      </button>
      {open && dropdown}
    </div>
  );
}

// ─── Unified "Wszystkie" view ─────────────────────────────────────────────────

type UnifiedSource = 'ksef' | 'fz' | 'par_vat' | 'par';

interface UnifiedDoc {
  _key: string;
  source: UnifiedSource;
  date: string;
  number: string;
  supplier: string;
  supplierNip: string;
  gross: number;
  currency: string;
  isPaid?: boolean;
  isKor?: boolean;
  dueDate?: string | null;
  ksefNumber?: string;
  purchaseDoc?: PurchaseDocument; // full obj for non-KSeF actions
}

const SOURCE_LABEL: Record<UnifiedSource, string> = {
  ksef: 'KSeF', fz: 'FZ', par_vat: 'PAR z NIP', par: 'Paragon',
};

const SOURCE_BADGE: Record<UnifiedSource, string> = {
  ksef:    'bg-violet-100 text-violet-800',
  fz:      'bg-blue-100 text-blue-800',
  par_vat: 'bg-orange-100 text-orange-800',
  par:     'bg-amber-100 text-amber-800',
};

function normalizeKseF(inv: ReceivedInvoiceMeta): UnifiedDoc {
  const seller = inv.seller as { name?: string; nip?: string; identifier?: { value?: string } };
  return {
    _key: `ksef-${inv.ksefNumber}`,
    source: 'ksef',
    date: inv.issueDate?.slice(0, 10) ?? '',
    number: inv.invoiceNumber,
    supplier: seller?.name ?? '—',
    supplierNip: seller?.nip ?? seller?.identifier?.value ?? '—',
    gross: inv.grossAmount,
    currency: inv.currency,
    isPaid: inv.isPaid,
    isKor: isKorType(inv.invoiceType),
    ksefNumber: inv.ksefNumber,
  };
}

function normalizePurchaseDoc(doc: PurchaseDocument): UnifiedDoc {
  const srcMap: Record<PurchaseDocDocType, UnifiedSource> = {
    FZ: 'fz', PAR_VAT: 'par_vat', PAR: 'par',
  };
  return {
    _key: `pd-${doc.id}`,
    source: srcMap[doc.doc_type],
    date: doc.issue_date ?? '',
    number: doc.document_number,
    supplier: doc.supplier_name,
    supplierNip: doc.supplier_nip,
    gross: Number.parseFloat(doc.total_gross) || 0,
    currency: 'PLN',
    isPaid: doc.is_paid,
    dueDate: doc.due_date,
    purchaseDoc: doc,
  };
}

function UnifiedDocList({
  dateFrom,
  dateTo,
  ksefEnabled,
  filterSources,
}: {
  dateFrom: string;
  dateTo: string;
  ksefEnabled: boolean;
  filterSources?: UnifiedSource[];
}) {
  const { user } = useAuth();
  const companyId = user?.current_company ?? '';
  const deleteMutation = useDeletePurchaseDocumentMutation();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const ksefQuery = useQuery({
    queryKey: ['ksef', 'inbox', 'unified', { companyId, dateFrom, dateTo }],
    queryFn: () => ksefService.queryReceivedInvoices(dateFrom, dateTo, 1, 100),
    enabled: ksefEnabled && Boolean(companyId),
  });

  const pdQuery = useQuery({
    queryKey: ['purchaseDocs', 'unified', { companyId, dateFrom, dateTo }],
    queryFn: () => purchaseDocumentService.fetchList({
      page_size: 100,
      ...(dateFrom ? { issue_date__gte: dateFrom } : {}),
      ...(dateTo   ? { issue_date__lte: dateTo }   : {}),
    }),
    enabled: Boolean(companyId),
  });

  const ksefDocs: UnifiedDoc[] = ksefEnabled
    ? (ksefQuery.data?.invoices ?? []).map(normalizeKseF)
    : [];
  const purchaseDocs: UnifiedDoc[] = (pdQuery.data?.results ?? []).map(normalizePurchaseDoc);
  const allUnified = [...ksefDocs, ...purchaseDocs].sort((a, b) => b.date.localeCompare(a.date));
  const unified = filterSources ? allUnified.filter((d) => filterSources.includes(d.source)) : allUnified;

  const isLoading = (ksefEnabled && ksefQuery.isPending) || pdQuery.isPending;
  const isError   = (ksefEnabled && ksefQuery.isError)   || pdQuery.isError;

  async function handleDelete(id: string) {
    if (!confirm('Usunąć ten dokument?')) return;
    setDeletingId(id);
    try { await deleteMutation.mutateAsync(id); }
    finally { setDeletingId(null); }
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Ładowanie…</div>;
  if (isError)   return <div className="py-12 text-center text-sm text-red-500">Nie udało się załadować dokumentów.</div>;
  if (unified.length === 0) return (
    <div className="py-12 text-center">
      <p className="text-[15px] font-medium text-gray-500">Brak dokumentów w tym okresie</p>
      <p className="mt-1 text-[13px] text-gray-400">Zmień zakres dat lub dodaj dokumenty ręcznie.</p>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <th className="px-5 py-3 text-left">Źródło</th>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Numer</th>
              <th className="px-4 py-3 text-left">Dostawca / Wystawca</th>
              <th className="px-4 py-3 text-right">Kwota brutto</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {unified.map((doc) => (
              <tr key={doc._key} className="group transition-colors hover:bg-gray-50/60">
                <td className="px-5 py-3.5">
                  <div className="flex flex-col gap-1">
                    <span className={cn('w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold', SOURCE_BADGE[doc.source])}>
                      {SOURCE_LABEL[doc.source]}
                    </span>
                    {doc.isKor && (
                      <span className="w-fit rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-600">KOR</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">{formatDate(doc.date)}</td>
                <td className="px-4 py-3.5">
                  <span className="font-medium text-gray-900">{doc.number || '—'}</span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="text-gray-900">{doc.supplier || '—'}</div>
                  {doc.supplierNip && doc.supplierNip !== '—' && (
                    <div className="text-[11px] text-gray-400">NIP: {doc.supplierNip}</div>
                  )}
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-gray-900 whitespace-nowrap">
                  {formatGross(doc.gross, doc.currency)}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Accounting annotation */}
                    {doc.purchaseDoc && <PurchaseDocAnnotationButton doc={doc.purchaseDoc} />}

                    {/* Category tag — for all purchase docs */}
                    {doc.purchaseDoc && <PurchaseDocCategoryTag doc={doc.purchaseDoc} />}

                    {/* PZ link / create */}
                    {doc.purchaseDoc && <PurchaseDocPzButton doc={doc.purchaseDoc} />}

                    {/* Payment button */}
                    {doc.purchaseDoc && <PurchaseDocPayButton doc={doc.purchaseDoc} />}
                    {doc.source === 'ksef' && (
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        doc.isPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                      )}>
                        {doc.isPaid ? '✓ Opłacono' : 'Nieopłacona'}
                      </span>
                    )}

                    {/* Edit/Delete/File — purchase docs only, on hover */}
                    {doc.purchaseDoc && (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {doc.purchaseDoc.ocr_raw_filename && doc.purchaseDoc.ocr_raw_filename.includes('/') && (
                          <a
                            href={purchaseDocumentService.getFileUrl(doc.purchaseDoc.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100"
                            title="Podgląd zeskanowanego dokumentu"
                          >
                            Plik
                          </a>
                        )}
                        <Link
                          to={`/purchase-documents/${doc.purchaseDoc.id}/edit`}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-[#5856D6] hover:bg-[#5856D6]/5"
                        >
                          Edytuj
                        </Link>
                        <button
                          type="button"
                          disabled={deletingId === doc.purchaseDoc.id}
                          onClick={() => void handleDelete(doc.purchaseDoc!.id)}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-40"
                        >
                          {deletingId === doc.purchaseDoc.id ? '…' : 'Usuń'}
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(ksefQuery.data?.hasMore || (pdQuery.data?.count ?? 0) > 100) && (
        <div className="border-t border-gray-100 px-5 py-3 text-[12px] text-gray-400">
          Wyświetlono pierwsze 100 wyników z każdego źródła — zawęź zakres dat, aby zobaczyć więcej.
        </div>
      )}
    </div>
  );
}

// ─── ExpandedItemsRow — rendered as a <tr> inside the doc table ───────────────

function ExpandedItemsRow({
  doc,
  lineCategories,
  onAssign,
}: {
  doc: PurchaseDocument;
  lineCategories: Record<string, string>;
  onAssign: (itemIds: string[], slug: string) => void;
}) {
  const [editingCategories, setEditingCategories] = useState(false);
  const [checkedLines, setCheckedLines] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const { data: categories = [] } = useOpexCategoriesQuery();
  const createCat = useCreateOpexCategoryMutation();

  const plMoney = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function handleBulkAssign() {
    if (!bulkCategory || bulkCategory === '__new__') return;
    onAssign(Array.from(checkedLines), bulkCategory);
    setCheckedLines(new Set());
    setBulkCategory('');
    setEditingCategories(false);
  }

  function exitCategoryEdit() {
    setEditingCategories(false);
    setCheckedLines(new Set());
    setBulkCategory('');
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    const created = await createCat.mutateAsync({ name: newCategoryName.trim() });
    if (created.slug) setBulkCategory(created.slug);
    setNewCategoryName('');
  }

  if (doc.items.length === 0) {
    return (
      <tr className="border-b border-gray-100 bg-gray-50/40">
        <td colSpan={8} className="px-8 py-2 text-[12px] italic text-gray-400">
          Brak pozycji — edytuj dokument, aby dodać.
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-100 bg-gray-50/20">
      <td colSpan={8} className="px-4 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              {editingCategories && (
                <th className="pb-1 pr-2 font-medium w-6">
                  <input
                    type="checkbox"
                    checked={checkedLines.size === doc.items.length}
                    onChange={(e) => {
                      setCheckedLines(e.target.checked ? new Set(doc.items.map((i) => i.id)) : new Set());
                    }}
                    className="rounded border-gray-300"
                    title="Zaznacz wszystkie"
                  />
                </th>
              )}
              <th className="text-left pb-1 pr-4 font-medium">Nazwa</th>
              <th className="text-right pb-1 pr-4 font-medium">Ilość</th>
              <th className="text-left pb-1 pr-4 font-medium">Jm.</th>
              <th className="text-right pb-1 pr-4 font-medium">Cena netto</th>
              <th className="text-right pb-1 pr-4 font-medium">VAT %</th>
              <th className="text-right pb-1 pr-4 font-medium">Wartość netto</th>
              <th className="text-left pb-1 pr-4 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  Kategoria
                  {!editingCategories && (
                    <button
                      type="button"
                      onClick={() => setEditingCategories(true)}
                      className="text-[10px] text-gray-400 hover:text-[#5856D6] underline underline-offset-2 font-normal"
                      title="Zmień kategorię"
                    >
                      zmień
                    </button>
                  )}
                </span>
              </th>
              <th className="text-left pb-1 font-medium">PZ</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => {
              const qty = parseFloat(item.quantity) || 0;
              const price = parseFloat(item.unit_price_gross) || 0;
              const vat = parseFloat(item.vat_rate) || 0;
              const gross = qty * price;
              const net = gross > 0 ? gross / (1 + vat / 100) : 0;
              const isChecked = checkedLines.has(item.id);
              return (
                <tr key={item.id} className="border-t border-gray-100/70">
                  {editingCategories && (
                    <td className="py-1 pr-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          setCheckedLines((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.id); else next.delete(item.id);
                            return next;
                          });
                        }}
                        className="rounded border-gray-300"
                      />
                    </td>
                  )}
                  <td className="py-1 pr-4 text-gray-700">{item.product_name}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1 pr-4 text-gray-400">{item.unit}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{net > 0 ? plMoney.format(net) : '—'}</td>
                  <td className="py-1 pr-4 text-right tabular-nums text-gray-400">{Math.round(parseFloat(item.vat_rate) || 0)}%</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{net > 0 ? plMoney.format(net) : '—'}</td>
                  <td className="py-1 pr-4">
                    {(() => {
                      const lineSlug = lineCategories[item.id];
                      const effectiveSlug = lineSlug || doc.opex_category;
                      if (!effectiveSlug) return <span className="text-xs text-gray-400">—</span>;
                      const label = categories.find((c) => c.slug === effectiveSlug)?.name ?? effectiveSlug;
                      return (
                        <span className={cn(
                          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
                          lineSlug ? 'bg-[#5856D6]/10 text-[#5856D6]' : 'bg-gray-100 text-gray-500',
                        )}>
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-1">
                    {(() => {
                      const cov = item.coverage;
                      const matched = parseFloat(cov?.quantity_matched_total ?? '0');
                      const total = parseFloat(item.quantity) || 1;
                      const pzNums = cov?.pz_numbers ?? [];
                      if (matched === 0) return <span className="text-xs text-gray-300">—</span>;
                      const remaining = total - matched;
                      const fullyMatched = remaining <= 0;
                      const pzLabel = pzNums.length > 0
                        ? pzNums[0] + (pzNums.length > 1 ? ` +${pzNums.length - 1}` : '')
                        : null;
                      return (
                        <div className="flex flex-col gap-0.5 leading-tight">
                          {pzLabel && (
                            <span className={cn('text-xs font-medium', fullyMatched ? 'text-emerald-600' : 'text-gray-700')} title={pzNums.join(', ')}>
                              {pzLabel}
                            </span>
                          )}
                          {!fullyMatched && (
                            <span className="text-[10px] text-amber-600 whitespace-nowrap">
                              brak {remaining % 1 === 0 ? remaining : remaining.toFixed(2)}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Bulk assign bar */}
        {checkedLines.size > 0 && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2 rounded-lg bg-[#5856D6]/5 border border-[#5856D6]/20 px-3 py-2">
              <span className="text-sm text-gray-500">
                Zaznaczono {checkedLines.size} {checkedLines.size === 1 ? 'linię' : 'linie'}
              </span>
              <select
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                className="text-sm rounded-lg border border-gray-200 bg-white px-2 py-1"
              >
                <option value="">-- wybierz kategorię --</option>
                {categories.filter((c) => c.slug).map((cat) => (
                  <option key={cat.id} value={cat.slug}>{cat.name}</option>
                ))}
                <option value="__new__">+ Utwórz nową kategorię...</option>
              </select>
              <button
                type="button"
                onClick={handleBulkAssign}
                disabled={!bulkCategory || bulkCategory === '__new__'}
                className="text-sm font-medium text-[#5856D6] hover:underline disabled:opacity-40"
              >
                Przypisz
              </button>
              <button
                type="button"
                onClick={exitCategoryEdit}
                className="text-sm text-gray-400 hover:text-gray-700"
              >
                Anuluj
              </button>
            </div>
            {bulkCategory === '__new__' && (
              <div className="flex items-center gap-2 px-3">
                <input
                  type="text"
                  placeholder="Nazwa kategorii..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="text-sm rounded-lg border border-gray-200 px-2 py-1"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateCategory()}
                  disabled={createCat.isPending}
                  className="text-sm font-medium text-[#5856D6]"
                >
                  Utwórz
                </button>
                <button
                  type="button"
                  onClick={() => setBulkCategory('')}
                  className="text-sm text-gray-400"
                >
                  Anuluj
                </button>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── PurchaseDocActionsDropdown ───────────────────────────────────────────────

function PurchaseDocActionsDropdown({
  doc,
  onDelete,
  deletingId,
  onMatchPz,
}: {
  doc: PurchaseDocument;
  onDelete: (id: string) => void;
  deletingId: string | null;
  onMatchPz?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // M:M: can always add more PZ for FZ/PAR_VAT
  const canMatchPz = doc.doc_type !== 'PAR';

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors text-base leading-none',
          open && 'bg-gray-100 text-gray-900',
        )}
        title="Więcej opcji"
      >
        ···
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <Link
            to={`/purchase-documents/${doc.id}/edit`}
            className="flex w-full items-center px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
            onClick={() => setOpen(false)}
          >
            Edytuj
          </Link>
          {canMatchPz && onMatchPz && (
            <button
              type="button"
              onClick={() => { setOpen(false); onMatchPz(); }}
              className="flex w-full items-center px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50 border-t border-gray-100"
            >
              Powiąż z PZ
            </button>
          )}
          <div className="border-t border-gray-100">
            <button
              type="button"
              disabled={deletingId === doc.id}
              onClick={() => { setOpen(false); onDelete(doc.id); }}
              className="flex w-full items-center px-3.5 py-2 text-[13px] text-red-500 hover:bg-red-50 disabled:opacity-40"
            >
              {deletingId === doc.id ? 'Usuwanie…' : 'Usuń'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Purchase doc list (Faktury / Paragony tabs) ──────────────────────────────

function PurchaseDocSection({
  docTypes,
  emptyLabel,
  canInvoices,
}: {
  docTypes: PurchaseDocDocType[];
  emptyLabel: string;
  canInvoices: boolean;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matchingPzDocId, setMatchingPzDocId] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string>('-issue_date');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'paid' | 'unpaid'>('');
  const [pzFilter, setPzFilter] = useState<'' | 'true' | 'false'>('');
  const [dateFrom, setDateFrom] = useState(monthAgoIso());
  const [dateTo, setDateTo] = useState(todayIso());
  // docId → { itemId → categorySlug } — persists across expand/collapse
  const [allLineCategories, setAllLineCategories] = useState<Record<string, Record<string, string>>>({});
  const deleteMutation = useDeletePurchaseDocumentMutation();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const patch = usePatchPurchaseDocumentMutation();
  const setLineCategories = useSetLinecategoriesMutation();
  const { data: categories = [] } = useOpexCategoriesQuery();

  function toggleSort(field: string) {
    setOrdering((prev) => prev === field ? `-${field}` : prev === `-${field}` ? field : `-${field}`);
    setPage(1);
  }

  function SortIcon({ field }: { field: string }) {
    if (ordering === field) return <span className="ml-1 text-[#5856D6] font-bold">↑</span>;
    if (ordering === `-${field}`) return <span className="ml-1 text-[#5856D6] font-bold">↓</span>;
    return <span className="ml-1 text-gray-400 group-hover:text-gray-600">⇅</span>;
  }

  const filters: PurchaseDocListFilters = {};
  if (docTypes.length === 1) filters.doc_type = docTypes[0];
  if (search) filters.search = search;
  if (ordering) filters.ordering = ordering;
  if (categoryFilter) filters.opex_category = categoryFilter;
  if (statusFilter === 'paid') filters.is_paid = true;
  if (statusFilter === 'unpaid') filters.is_paid = false;
  if (pzFilter === 'true') filters.has_pz = true;
  if (pzFilter === 'false') filters.has_pz = false;
  if (dateFrom) filters.issue_date__gte = dateFrom;
  if (dateTo) filters.issue_date__lte = dateTo;

  const { data, isFetching, isError } = usePurchaseDocumentListQuery(page, filters);

  const allItems = data?.results ?? [];
  const items = docTypes.length > 1
    ? allItems.filter((d) => docTypes.includes(d.doc_type))
    : allItems;
  const totalPages = data ? Math.ceil(data.count / 20) : 1;
  const totalCount = data?.count ?? items.length;

  // Seed allLineCategories from backend line_categories when list loads
  useEffect(() => {
    if (!items.length) return;
    setAllLineCategories((prev) => {
      const next = { ...prev };
      items.forEach((doc) => {
        if (!next[doc.id] && doc.line_categories && Object.keys(doc.line_categories).length > 0) {
          const seed: Record<string, string> = {};
          doc.items.forEach((it, i) => {
            const cat = doc.line_categories?.[String(i)];
            if (cat) seed[it.id] = cat;
          });
          if (Object.keys(seed).length > 0) next[doc.id] = seed;
        }
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  // Debounced auto-search
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  async function handleDelete(id: string) {
    if (!confirm('Usunąć ten dokument?')) return;
    setDeletingId(id);
    try { await deleteMutation.mutateAsync(id); }
    finally { setDeletingId(null); }
  }

  const today = todayIso();

  return (
    <div>
      <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[13px] font-medium text-gray-600">Od</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[13px] font-medium text-gray-600">Do</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[13px] text-gray-500 hover:bg-gray-50"
            >
              Wyczyść daty
            </button>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Szukaj po numerze, dostawcy, NIP…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-8 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-[#5856D6] focus:outline-none focus:ring-2 focus:ring-[#5856D6]/20"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            >✕</button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {isFetching && <div className="p-8 text-center text-sm text-gray-400">Ładowanie…</div>}
        {isError && <div className="p-8 text-center text-sm text-red-500">Nie udało się załadować dokumentów.</div>}
        {!isFetching && !isError && items.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-[15px] font-medium text-gray-500">{emptyLabel}</p>
            <p className="mt-1 text-[13px] text-gray-400">Dodaj dokument ręcznie lub zeskanuj fakturę.</p>
            {canInvoices && (
              <Link to="/purchase-documents/new" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#5856D6] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#4744C4]">
                + Nowy dokument
              </Link>
            )}
          </div>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <div className="px-5 py-3 border-b border-gray-100">
              <span className="text-[15px] font-semibold text-gray-900">
                {totalCount} {totalCount === 1 ? 'dokument' : totalCount < 5 ? 'dokumenty' : 'dokumentów'}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs font-semibold text-gray-600">
                  <th className="px-5 py-3 text-left">
                    <button type="button" onClick={() => toggleSort('issue_date')} className="group inline-flex items-center hover:text-gray-900 transition-colors">
                      Data<SortIcon field="issue_date" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button type="button" onClick={() => toggleSort('document_number')} className="group inline-flex items-center hover:text-gray-900 transition-colors">
                      Nr dokumentu<SortIcon field="document_number" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button type="button" onClick={() => toggleSort('supplier_name')} className="group inline-flex items-center hover:text-gray-900 transition-colors">
                      Wystawca<SortIcon field="supplier_name" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button type="button" onClick={() => toggleSort('total_gross')} className="group inline-flex items-center hover:text-gray-900 transition-colors">
                      Kwota<SortIcon field="total_gross" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <select
                      value={categoryFilter}
                      onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                      style={{ fontWeight: 600 }}
                      className={cn(
                        'text-xs bg-transparent border-none outline-none cursor-pointer pr-4',
                        categoryFilter ? 'text-[#5856D6]' : 'text-gray-600 hover:text-gray-900',
                      )}
                    >
                      <option value="">Kategoria</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.slug}>{cat.name}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <select
                      value={statusFilter}
                      onChange={(e) => { setStatusFilter(e.target.value as '' | 'paid' | 'unpaid'); setPage(1); }}
                      style={{ fontWeight: 600 }}
                      className={cn(
                        'text-xs bg-transparent border-none outline-none cursor-pointer pr-4',
                        statusFilter ? 'text-[#5856D6]' : 'text-gray-600 hover:text-gray-900',
                      )}
                    >
                      <option value="">Status</option>
                      <option value="paid">Opłacone</option>
                      <option value="unpaid">Nieopłacone</option>
                    </select>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <select
                      value={pzFilter}
                      onChange={(e) => { setPzFilter(e.target.value as '' | 'true' | 'false'); setPage(1); }}
                      style={{ fontWeight: 600 }}
                      className={cn(
                        'text-xs bg-transparent border-none outline-none cursor-pointer pr-4',
                        pzFilter ? 'text-[#5856D6]' : 'text-gray-600 hover:text-gray-900',
                      )}
                    >
                      <option value="">PZ</option>
                      <option value="true">Z PZ</option>
                      <option value="false">Bez PZ</option>
                    </select>
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((doc) => {
                  const isOverdue = !doc.is_paid && !!doc.due_date && doc.due_date < today;
                  const isExpanded = expandedId === doc.id;
                  return (
                    <React.Fragment key={doc.id}>
                    <tr className="transition-colors hover:bg-gray-50/60">
                      {/* DATA */}
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="text-gray-600">{formatDate(doc.issue_date)}</div>
                        {doc.due_date && (
                          <div className={cn('text-[11px]', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                            płatność do {doc.due_date}
                          </div>
                        )}
                      </td>
                      {/* NR DOKUMENTU */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-gray-900">{doc.document_number || '—'}</div>
                        <span className={cn('mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold', docTypeBadge(doc.doc_type))}>
                          {docTypeLabel(doc.doc_type)}
                        </span>
                      </td>
                      {/* WYSTAWCA */}
                      <td className="px-4 py-3.5">
                        <div className="text-gray-900">{doc.supplier_name || '—'}</div>
                        {doc.supplier_nip && <div className="text-[11px] text-gray-400">{doc.supplier_nip}</div>}
                      </td>
                      {/* KWOTA */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="font-semibold tabular-nums text-gray-900">{formatGross(doc.total_gross)}</div>
                        <div className="text-[11px] tabular-nums text-gray-400">VAT {formatGross(doc.total_vat)}</div>
                      </td>
                      {/* KATEGORIA */}
                      <td className="px-4 py-3.5">
                        {(() => {
                          const docLineCats = allLineCategories[doc.id] ?? {};
                          const uniqueSlugs = [...new Set(Object.values(docLineCats))];
                          if (uniqueSlugs.length > 1) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                {uniqueSlugs.map((slug) => (
                                  <span key={slug} className="text-[12px] text-gray-700 leading-snug">
                                    {categories.find((c) => c.slug === slug)?.name ?? slug}
                                  </span>
                                ))}
                              </div>
                            );
                          }
                          return <PurchaseDocCategoryTag doc={doc} />;
                        })()}
                      </td>
                      {/* STATUS */}
                      <td className="px-4 py-3.5">
                        <PurchaseDocPayButton doc={doc} />
                      </td>
                      {/* PZ */}
                      <td className="px-4 py-3.5">
                        {(() => {
                          const linkedPzs = doc.pz_documents ?? [];
                          if (linkedPzs.length > 0) {
                            return (
                              <div className="flex flex-col gap-0.5">
                                {linkedPzs.map((pz) => (
                                  <Link
                                    key={pz.id}
                                    to={`/delivery/${pz.id}`}
                                    className="text-[12px] text-emerald-600 hover:text-emerald-800 hover:underline transition-colors leading-snug whitespace-nowrap"
                                    title="Przejdź do PZ"
                                  >
                                    {pz.document_number || pz.id.slice(0, 8)}
                                  </Link>
                                ))}
                              </div>
                            );
                          }
                          if (doc.doc_type !== 'PAR') {
                            return <PurchaseDocPzButton doc={doc} />;
                          }
                          return <span className="text-gray-300">—</span>;
                        })()}
                      </td>
                      {/* ··· */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const next = isExpanded ? null : doc.id;
                              setExpandedId(next);
                              // On expand: seed from backend line_categories (index-keyed → id-keyed)
                              if (next && !allLineCategories[doc.id] && doc.items.length > 0) {
                                const seed: Record<string, string> = {};
                                doc.items.forEach((it, i) => {
                                  const cat = doc.line_categories?.[String(i)];
                                  if (cat) seed[it.id] = cat;
                                });
                                if (Object.keys(seed).length > 0) {
                                  setAllLineCategories((prev) => ({ ...prev, [doc.id]: seed }));
                                }
                              }
                            }}
                            title={isExpanded ? 'Zwiń pozycje' : 'Pokaż pozycje'}
                            className={cn(
                              'inline-flex items-center justify-center h-7 w-7 rounded-md text-sm text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 hover:text-gray-800 transition-colors',
                              isExpanded && 'bg-gray-100 text-gray-800',
                            )}
                          >
                            {isExpanded ? '▴' : '▾'}
                          </button>
                          <PurchaseDocActionsDropdown
                            doc={doc}
                            onDelete={(id) => void handleDelete(id)}
                            deletingId={deletingId}
                            onMatchPz={() => setMatchingPzDocId((prev) => prev === doc.id ? null : doc.id)}
                          />
                        </div>
                      </td>
                    </tr>
                    {matchingPzDocId === doc.id && (
                      <tr className="border-b border-gray-100 bg-gray-50/40">
                        <td colSpan={8} className="px-5 py-3">
                          <MatchPzPanelForDoc doc={doc} onClose={() => setMatchingPzDocId(null)} />
                        </td>
                      </tr>
                    )}
                    {isExpanded && (
                      <ExpandedItemsRow
                        doc={doc}
                        lineCategories={allLineCategories[doc.id] ?? {}}
                        onAssign={(itemIds, slug) => {
                          setAllLineCategories((prev) => {
                            const docLines = { ...(prev[doc.id] ?? {}) };
                            itemIds.forEach((id) => { docLines[id] = slug; });
                            return { ...prev, [doc.id]: docLines };
                          });
                          // If every item ends up with the same category → update doc-level pill too
                          const allSlugs = doc.items.map((it) => {
                            const current = allLineCategories[doc.id]?.[it.id];
                            return itemIds.includes(it.id) ? slug : (current ?? null);
                          });
                          const allSame = allSlugs.every((s) => s === slug);
                          if (allSame) {
                            patch.mutate({ id: doc.id, data: { opex_category: slug } });
                          }
                          // Build index-keyed line_categories and persist to backend
                          const updatedDocLines = { ...(allLineCategories[doc.id] ?? {}) };
                          itemIds.forEach((id) => { updatedDocLines[id] = slug; });
                          const indexKeyed: Record<string, string> = {};
                          doc.items.forEach((it, i) => {
                            if (updatedDocLines[it.id]) indexKeyed[String(i)] = updatedDocLines[it.id];
                          });
                          setLineCategories.mutate({ id: doc.id, lineCategories: indexKeyed });
                        }}
                      />
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-gray-500">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40">
            ← Poprzednia
          </button>
          <span>Strona {page} z {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40">
            Następna →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type MainTab = 'all' | 'ksef' | 'fz' | 'par';

const TAB_DEFS: { key: MainTab; label: string; requiresKsef?: boolean }[] = [
  { key: 'all',  label: 'Wszystkie' },
  { key: 'ksef', label: 'Z KSeF', requiresKsef: true },
  { key: 'fz',   label: 'Faktury i PAR z NIP' },
  { key: 'par',  label: 'Paragony' },
];

export function PurchaseDocumentsPage() {
  const ksefEnabled = useModuleGuard('ksef');
  const canInvoices = usePermission('can_manage_invoices');
  const [activeTab, setActiveTab] = useState<MainTab>('all');
  const [dateFrom, setDateFrom] = useState(monthAgoIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [catManagerOpen, setCatManagerOpen] = useState(false);

  return (
    <div
      className="min-h-full pb-16"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", background: '#F5F5F7' }}
    >
      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-gray-900">Dokumenty zakupowe</h1>
            <p className="mt-0.5 text-[13px] text-gray-500">Faktury i paragony — z KSeF i spoza KSeF</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCatManagerOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[14px] font-medium text-gray-500 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-700"
            >
              Kategorie kosztów
            </button>
            <Link
              to="/ksef/scan-paper"
              className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-4 py-2 text-[14px] font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50"
            >
              Skanuj
            </Link>
            {canInvoices && (
              <Link
                to="/purchase-documents/new"
                className="flex items-center gap-1.5 rounded-full bg-[#5856D6] px-4 py-2 text-[14px] font-semibold text-white shadow-sm transition-all hover:bg-[#4744C4] active:scale-95"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                Nowy dokument
              </Link>
            )}
          </div>
        </div>

        <OpexCategoryManager open={catManagerOpen} onClose={() => setCatManagerOpen(false)} />

        {/* Tabs */}
        <div className="mb-3 flex gap-1.5 flex-wrap">
          {TAB_DEFS.filter((t) => !t.requiresKsef || ksefEnabled).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'rounded-full px-4 py-2 text-[14px] font-medium transition-all',
                activeTab === t.key
                  ? 'bg-[#5856D6] text-white shadow-sm'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>


        {/* Wszystkie — all sources merged */}
        {activeTab === 'all' && (
          <UnifiedDocList dateFrom={dateFrom} dateTo={dateTo} ksefEnabled={ksefEnabled} />
        )}

        {/* Z KSeF — full KSeF inbox with all original features */}
        {activeTab === 'ksef' && ksefEnabled && <KSeFInboxContent onOpenCatManager={() => setCatManagerOpen(true)} />}

        {/* Faktury i PAR z NIP — FZ + PAR_VAT (oba dają prawo do odliczenia VAT) */}
        {activeTab === 'fz' && (
          <PurchaseDocSection
            docTypes={['FZ', 'PAR_VAT']}
            emptyLabel="Brak faktur zakupowych i paragonów z NIP"
            canInvoices={canInvoices}
          />
        )}

        {activeTab === 'par' && (
          <PurchaseDocSection
            docTypes={['PAR']}
            emptyLabel="Brak paragonów"
            canInvoices={canInvoices}
          />
        )}

      </div>
    </div>
  );
}

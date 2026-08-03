import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useKsefInboxParseQuery, useKsefInboxQuery, useKsefInboxSyncMutation, useKsefSessionQuery, useKsefTagOpexMutation, useKsefOpexLinesQuery, useKsefLineOpexMutation } from '@/query/use-invoices';
import { useLinkInvoiceToPzMutation, useUnmatchedPzQuery } from '@/query/use-delivery';
import { useCostProjectsQuery, useInvoiceAnnotationQuery, useSaveInvoiceAnnotationMutation } from '@/query/use-cost-allocation';
import { useCreateOpexCategoryMutation, useOpexCategoriesQuery } from '@/query/use-cashflow';
import { OpexCategoryManager } from '@/components/features/cashflow/OpexCategoryManager';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { OpexCategory, PzDocumentRef, ReceivedInvoiceMeta } from '@/services/ksef.service';
import { isKorType, OPEX_CATEGORY_LABELS } from '@/services/ksef.service';
import type { AccountingStatus, InvoiceAnnotationWrite, LineAnnotation, LineSplitWrite } from '@/types/cost-allocation.types';
import { ACCOUNTING_STATUS_COLORS, ACCOUNTING_STATUS_LABELS } from '@/types/cost-allocation.types';

const PAGE_SIZE = 20;

const plDateTime = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const plMoney = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isoToDisplay(iso: string): string {
  if (!iso) return '—';
  try {
    return plDateTime.format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatAmount(value: number | undefined, currency: string): string {
  if (value === undefined || value === null) return '—';
  return `${plMoney.format(value)} ${currency}`;
}

function downloadXml(ksefNumber: string) {
  const token = authStorage.getAccessToken();
  const url = `/api/ksef/inbox/${encodeURIComponent(ksefNumber)}/xml/`;
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    })
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${ksefNumber}.xml`;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(`Błąd pobierania XML: ${err}`));
}


interface InvoiceRowProps {
  inv: ReceivedInvoiceMeta;
  downloading: string | null;
  onDownload: (ref: string) => void;
  onCreatePz: (ref: string) => void;
  onCreatePzKor: (ref: string) => void;
  onOpenCatManager: () => void;
}

function OpexTagButton({ inv, onOpenManager }: { inv: ReceivedInvoiceMeta; onOpenManager: () => void }) {
  const [open, setOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const tagMutation = useKsefTagOpexMutation();
  const { data: companyCategories = [] } = useOpexCategoriesQuery();
  const createCatMutation = useCreateOpexCategoryMutation();

  // Close dropdown on outside click
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

  const handleTag = (category: string | null) => {
    tagMutation.mutate({ ksefNumber: inv.ksefNumber, opex_category: category as OpexCategory | null });
    setOpen(false);
    setAddingNew(false);
    setNewName('');
  };

  const handleCreateAndTag = async () => {
    if (!newName.trim()) return;
    const created = await createCatMutation.mutateAsync({ name: newName.trim() });
    if (created.slug) handleTag(created.slug);
    setAddingNew(false);
    setNewName('');
  };

  // Label for current category — use company category name if available
  const currentLabel = inv.opex_category
    ? (companyCategories.find((c) => c.slug === inv.opex_category)?.name
        ?? OPEX_CATEGORY_LABELS[inv.opex_category as OpexCategory]
        ?? inv.opex_category)
    : null;

  const categoryList = companyCategories.length > 0
    ? companyCategories.filter((c) => c.slug).map((c) => ({ slug: c.slug, name: c.name }))
    : (Object.entries(OPEX_CATEGORY_LABELS) as [string, string][]).map(([slug, name]) => ({ slug, name }));

  const dropdown = (
    <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-md border border-border bg-background shadow-lg">
      {categoryList.map((cat) => (
        <button
          key={cat.slug}
          type="button"
          onClick={() => handleTag(cat.slug)}
          className={cn(
            'w-full text-left px-3 py-1.5 text-xs hover:bg-muted',
            cat.slug === inv.opex_category && 'font-semibold text-primary',
          )}
        >
          {cat.name}
        </button>
      ))}
      <div className="border-t border-border">
        {addingNew ? (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateAndTag(); }}
              placeholder="Nazwa kategorii..."
              className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => void handleCreateAndTag()}
              disabled={!newName.trim() || createCatMutation.isPending}
              className="shrink-0 text-xs font-medium text-primary disabled:opacity-40"
            >
              OK
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted"
          >
            + Dodaj kategorię...
          </button>
        )}
      </div>
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => { setOpen(false); setAddingNew(false); onOpenManager(); }}
          className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted flex items-center gap-1.5"
        >
          ⚙ Zarządzaj kategoriami
        </button>
      </div>
    </div>
  );

  if (inv.opex_category) {
    return (
      <div className="relative inline-flex items-center gap-0.5" ref={ref}>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setAddingNew(false); setNewName(''); }}
          className="inline-flex items-center rounded-l px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary"
          title="Zmień kategorię"
        >
          {currentLabel}
        </button>
        <button
          type="button"
          onClick={() => handleTag(null)}
          disabled={tagMutation.isPending}
          className="inline-flex items-center rounded-r px-1 py-0.5 text-xs font-medium bg-primary/10 text-primary border-l border-primary/20 hover:bg-primary/20"
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
      <Button
        size="sm"
        variant="outline"
        onClick={() => { setOpen((v) => !v); setAddingNew(false); setNewName(''); }}
        className={cn(open && 'bg-muted')}
        title="Przypisz kategorię kosztu"
      >
        Kategoria
      </Button>
      {open && dropdown}
    </div>
  );
}

function MatchPzPanel({ inv, onClose }: { inv: ReceivedInvoiceMeta; onClose: () => void }) {
  const supplierId = (inv.seller as { id?: string })?.id ?? undefined;
  const { data: unmatchedPzs = [], isPending } = useUnmatchedPzQuery(supplierId, true);
  const linkM = useLinkInvoiceToPzMutation();
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchedId, setMatchedId] = useState<string | null>(null);

  const handleLink = async (pzId: string) => {
    setMatchError(null);
    try {
      await linkM.mutateAsync({ pzId, ksefInvoiceId: inv.id });
      setMatchedId(pzId);
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : 'Nie udało się dopasować PZ.');
    }
  };

  if (matchedId) {
    return (
      <div className="mt-2 rounded-xl border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-3">
        <span>✓ Faktura dopasowana do PZ.</span>
        <button type="button" onClick={onClose} className="text-xs underline text-emerald-700">Zamknij</button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/30 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">Dopasuj do istniejącego PZ</p>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <p className="text-xs text-muted-foreground">
        Wybierz PZ, które zostało utworzone ręcznie dla tej faktury (bez KSeF).
        {supplierId ? ' Poniżej PZ od tego dostawcy.' : ' Poniżej wszystkie PZ bez faktury.'}
      </p>
      {matchError && <p className="text-xs text-destructive">{matchError}</p>}
      {isPending && <p className="text-xs text-muted-foreground">Ładowanie…</p>}
      {!isPending && unmatchedPzs.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Brak PZ bez przypisanej faktury.</p>
      )}
      {!isPending && unmatchedPzs.length > 0 && (
        <div className="space-y-1.5">
          {unmatchedPzs.map((pz) => (
            <div key={pz.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">
                  {pz.document_number || pz.id.slice(0, 8)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {pz.issue_date} · {pz.to_warehouse_name ?? '—'} · {pz.status}
                </p>
              </div>
              <button
                type="button"
                disabled={linkM.isPending}
                onClick={() => void handleLink(pz.id)}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
              >
                {linkM.isPending ? '…' : 'Dopasuj'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Annotation panel -------------------------------------------------------

interface AnnotationPanelProps {
  ksefNumber: string;
  lines: Array<{ name: string; position?: number; quantity?: number }> | null;
}

interface DraftSplit {
  project: string;
  percentage: string;  // always stored as %; qty mode converts on save
  qty: string;         // only used when splitMode === 'qty'
  note: string;
}

interface DraftLineAnn {
  isPrivate: boolean;
  note: string;
  splits: DraftSplit[];
  splitMode: 'pct' | 'qty';
}

function emptyDraft(): DraftLineAnn {
  return { isPrivate: false, note: '', splitMode: 'pct', splits: [{ project: '', percentage: '100', qty: '', note: '' }] };
}

function seedDraft(la: LineAnnotation): DraftLineAnn {
  const hasQty = la.splits.some((s) => s.quantity !== null && s.quantity !== undefined);
  return {
    isPrivate: la.isPrivate,
    note: la.note,
    splitMode: hasQty ? 'qty' : 'pct',
    splits: la.splits.length > 0
      ? la.splits.map((s) => ({ project: s.project ?? '', percentage: String(parseFloat(s.percentage)), qty: s.quantity ?? '', note: s.note }))
      : [{ project: '', percentage: '100', qty: '', note: '' }],
  };
}

function AnnotationPanel({ ksefNumber, lines }: AnnotationPanelProps) {
  const { data: annotation, isPending: annLoading } = useInvoiceAnnotationQuery(ksefNumber, true);
  const { data: projects = [] } = useCostProjectsQuery();
  const saveMutation = useSaveInvoiceAnnotationMutation(ksefNumber);

  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<AccountingStatus>('pending');
  const [notes, setNotes] = useState('');
  const [lineAnns, setLineAnns] = useState<Record<string, DraftLineAnn>>({});

  useEffect(() => {
    if (!annotation) return;
    setStatus(annotation.accounting_status);
    setNotes(annotation.accounting_notes);
    setLineAnns(
      Object.fromEntries(
        Object.entries(annotation.line_annotations ?? {}).map(([pos, la]) => [pos, seedDraft(la)])
      )
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation?.id]);

  const hasAnnotation = !!annotation?.id && (
    annotation.accounting_status !== 'pending' ||
    annotation.accounting_notes.trim().length > 0 ||
    Object.values(annotation.line_annotations ?? {}).some(
      (la) => la.isPrivate || (la.note ?? '').trim() || la.splits.some((s) => s.project)
    )
  );

  const isReadMode = hasAnnotation && !editing;

  const handleSave = async () => {
    const hasContent =
      notes.trim().length > 0 ||
      Object.values(lineAnns).some(
        (la) => la.isPrivate || la.note.trim() || la.splits.some((s) => s.project)
      );
    const effectiveStatus: AccountingStatus =
      status === 'pending' && hasContent ? 'annotated' : status;
    if (effectiveStatus !== status) setStatus(effectiveStatus);

    const payload: InvoiceAnnotationWrite = {
      accountingStatus: effectiveStatus,
      accountingNotes: notes,
      lineAnnotations: Object.fromEntries(
        Object.entries(lineAnns).map(([pos, la]) => {
          // Convert qty mode → percentages
          let splits = la.splits.filter((s) => s.project || parseFloat(s.percentage) > 0 || parseFloat(s.qty) > 0);
          if (la.splitMode === 'qty') {
            const totalQty = splits.reduce((sum, s) => sum + (parseFloat(s.qty) || 0), 0);
            if (totalQty > 0) {
              let runningPct = 0;
              splits = splits.map((s, i) => {
                const isLast = i === splits.length - 1;
                // Last split gets the remainder to guarantee sum = exactly 100
                const pct = isLast
                  ? Math.round((100 - runningPct) * 100) / 100
                  : Math.round(((parseFloat(s.qty) || 0) / totalQty * 100) * 100) / 100;
                runningPct += pct;
                return { ...s, percentage: String(pct) };
              });
            }
          }
          return [
            pos,
            {
              isPrivate: la.isPrivate,
              note: la.note,
              splits: splits.map((s): LineSplitWrite => ({
                project: s.project || null,
                percentage: parseFloat(s.percentage) || 0,
                quantity: la.splitMode === 'qty' && s.qty ? parseFloat(s.qty) : null,
                note: s.note,
              })),
            },
          ];
        })
      ),
    };
    await saveMutation.mutateAsync(payload);
    setEditing(false);
  };

  const handleCancel = () => {
    if (annotation) {
      setStatus(annotation.accounting_status);
      setNotes(annotation.accounting_notes);
      setLineAnns(
        Object.fromEntries(
          Object.entries(annotation.line_annotations ?? {}).map(([pos, la]) => [pos, seedDraft(la)])
        )
      );
    }
    setEditing(false);
  };

  const updateSplit = (pos: string, idx: number, field: string, value: string) => {
    setLineAnns((prev) => {
      const la = prev[pos] ?? emptyDraft();
      const splits = la.splits.map((s, i) => i === idx ? { ...s, [field]: value } : s);
      return { ...prev, [pos]: { ...la, splits } };
    });
  };

  const addSplit = (pos: string) => {
    setLineAnns((prev) => {
      const la = prev[pos] ?? emptyDraft();
      return { ...prev, [pos]: { ...la, splits: [...la.splits, { project: '', percentage: '', qty: '', note: '' }] } };
    });
  };

  const removeSplit = (pos: string, idx: number) => {
    setLineAnns((prev) => {
      const la = prev[pos] ?? emptyDraft();
      const splits = la.splits.filter((_, i) => i !== idx);
      return { ...prev, [pos]: { ...la, splits: splits.length ? splits : [{ project: '', percentage: '100', qty: '', note: '' }] } };
    });
  };

  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));

  const splitTotal = (pos: string) => {
    const la = lineAnns[pos];
    if (!la) return 0;
    if (la.splitMode === 'qty')
      return la.splits.reduce((sum, s) => sum + (parseFloat(s.qty) || 0), 0);
    return la.splits.reduce((sum, s) => sum + (parseFloat(s.percentage) || 0), 0);
  };

  if (annLoading) {
    return <p className="text-xs text-muted-foreground py-2">Ładowanie adnotacji…</p>;
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">Adnotacje kosztowe</p>
        {isReadMode && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edytuj</Button>
        )}
      </div>

      {/* ── READ MODE ─────────────────────────────────────────────── */}
      {isReadMode && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span className={cn('rounded px-1.5 py-0.5 font-medium', ACCOUNTING_STATUS_COLORS[annotation!.accounting_status])}>
                {ACCOUNTING_STATUS_LABELS[annotation!.accounting_status]}
              </span>
            </div>
            {annotation!.accounting_notes.trim() && (
              <div>
                <span className="text-muted-foreground">Notatka: </span>
                <span className="text-foreground">{annotation!.accounting_notes}</span>
              </div>
            )}
          </div>
          {lines && lines.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Pozycje</p>
              {lines.map((line, i) => {
                const pos = String(line.position ?? i);
                const la = annotation!.line_annotations?.[pos];
                const activeSplits = (la?.splits ?? []).filter((s) => s.project);
                const hasContent = activeSplits.length > 0 || la?.isPrivate || (la?.note ?? '').trim();
                if (!hasContent) return null;
                return (
                  <div key={pos} className="rounded-lg border border-border bg-background px-3 py-2 space-y-1.5">
                    <p className="text-xs font-medium text-foreground">{line.name}</p>
                    {activeSplits.map((s, si) => {
                      const proj = s.project ? projectById[s.project] : null;
                      return (
                        <div key={si} className="flex flex-wrap gap-3 text-xs pl-2 border-l-2 border-primary/30">
                          {proj && (
                            <div>
                              <span className="text-muted-foreground">Projekt: </span>
                              <span className="font-medium">{proj.code ? `${proj.code} – ${proj.name}` : proj.name}</span>
                            </div>
                          )}
                          {s.quantity !== null && s.quantity !== undefined ? (
                            <div>
                              <span className="text-muted-foreground">Ilość: </span>
                              <span className="font-medium">{parseFloat(s.quantity)}</span>
                            </div>
                          ) : s.percentage !== '100' && (
                            <div>
                              <span className="text-muted-foreground">Udział: </span>
                              <span className="font-medium">{parseFloat(s.percentage)}%</span>
                            </div>
                          )}
                          {s.note.trim() && (
                            <div>
                              <span className="text-muted-foreground">Uwaga: </span>
                              <span className="italic">"{s.note}"</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-3 text-xs">
                      {la?.isPrivate && (
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 font-medium">prywatne</span>
                      )}
                      {(la?.note ?? '').trim() && (
                        <div>
                          <span className="text-muted-foreground">Uwaga do pozycji: </span>
                          <span className="italic">"{la!.note}"</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EDIT MODE ─────────────────────────────────────────────── */}
      {!isReadMode && (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AccountingStatus)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {(Object.keys(ACCOUNTING_STATUS_LABELS) as AccountingStatus[]).map((s) => (
                  <option key={s} value={s}>{ACCOUNTING_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-48">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notatka dla księgowości</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                placeholder="Ogólna notatka do całej faktury…"
              />
            </div>
          </div>

          {lines && lines.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Pozycje</p>
              {lines.map((line, i) => {
                const pos = String(line.position ?? i);
                const la = lineAnns[pos] ?? emptyDraft();
                return (
                  <div key={pos} className="rounded-lg border border-border bg-background px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">{line.name}</p>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={la.isPrivate}
                          onChange={(e) => setLineAnns((prev) => ({ ...prev, [pos]: { ...la, isPrivate: e.target.checked } }))}
                          className="rounded border-input"
                        />
                        prywatne
                      </label>
                    </div>

                    {/* Split mode toggle */}
                    {la.splits.length >= 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">Podział wg:</span>
                        {(['pct', 'qty'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setLineAnns((prev) => ({ ...prev, [pos]: { ...la, splitMode: m } }))}
                            className={cn(
                              'rounded px-2 py-0.5 text-[10px] font-medium border',
                              la.splitMode === m
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-input hover:bg-muted',
                            )}
                          >
                            {m === 'pct' ? 'procent %' : `ilości${line.quantity ? ` (z ${line.quantity})` : ''}`}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Splits */}
                    <div className="space-y-1.5">
                      {la.splits.map((split, si) => (
                        <div key={si} className="grid grid-cols-[1fr_20_1fr_auto] gap-1.5 items-center">
                          <div>
                            {si === 0 && <p className="text-[10px] text-muted-foreground mb-0.5">Projekt</p>}
                            <select
                              value={split.project}
                              onChange={(e) => updateSplit(pos, si, 'project', e.target.value)}
                              className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              <option value="">— projekt —</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>{p.code ? `${p.code} – ${p.name}` : p.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="w-20">
                            {si === 0 && (
                              <p className="text-[10px] text-muted-foreground mb-0.5">
                                {la.splitMode === 'qty' ? 'Ilość' : 'Udział %'}
                              </p>
                            )}
                            {la.splitMode === 'qty' ? (
                              <input
                                type="number"
                                min="0"
                                value={split.qty}
                                onChange={(e) => updateSplit(pos, si, 'qty', e.target.value)}
                                className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                placeholder="0"
                              />
                            ) : (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={split.percentage}
                                onChange={(e) => updateSplit(pos, si, 'percentage', e.target.value)}
                                className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                placeholder="100"
                              />
                            )}
                          </div>
                          <div>
                            {si === 0 && <p className="text-[10px] text-muted-foreground mb-0.5">Uwaga</p>}
                            <input
                              type="text"
                              value={split.note}
                              onChange={(e) => updateSplit(pos, si, 'note', e.target.value)}
                              placeholder="Opcjonalna uwaga…"
                              className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                          <div className={si === 0 ? 'mt-4' : ''}>
                            {la.splits.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeSplit(pos, si)}
                                className="text-muted-foreground hover:text-destructive text-xs px-1"
                                title="Usuń podział"
                              >✕</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => addSplit(pos)}
                        className="text-xs text-primary hover:underline"
                      >
                        + Dodaj projekt
                      </button>
                      {la.splits.length > 1 && (() => {
                        const total = splitTotal(pos);
                        const expected = la.splitMode === 'qty' ? (line.quantity ?? null) : 100;
                        const ok = expected === null
                          ? total > 0
                          : Math.abs(total - expected) < 0.01;
                        const label = la.splitMode === 'qty'
                          ? `Suma: ${total}${expected !== null ? ` / ${expected}` : ''}`
                          : `Suma: ${total.toFixed(0)}%`;
                        return (
                          <span className={cn('text-xs', ok ? 'text-emerald-600' : 'text-destructive')}>
                            {label}{!ok && la.splitMode === 'pct' && ' (musi być 100%)'}
                          </span>
                        );
                      })()}
                    </div>

                    <div>
                      <p className="text-[10px] text-muted-foreground mb-0.5">Uwaga do całej pozycji</p>
                      <input
                        type="text"
                        value={la.note}
                        onChange={(e) => setLineAnns((prev) => ({ ...prev, [pos]: { ...la, note: e.target.value } }))}
                        placeholder="Dotyczy całej pozycji…"
                        className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => void handleSave()} loading={saveMutation.isPending}>
              Zapisz adnotacje
            </Button>
            {hasAnnotation && (
              <Button size="sm" variant="outline" onClick={handleCancel}>Anuluj</Button>
            )}
            {saveMutation.isSuccess && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Zapisano</span>
            )}
            {saveMutation.isError && (
              <span className="text-xs text-destructive">Błąd zapisu.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InvoiceRow({ inv, downloading, onDownload, onCreatePz, onCreatePzKor, onOpenCatManager }: InvoiceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showMatchPanel, setShowMatchPanel] = useState(false);
  const hasCostAllocation = useModuleGuard('cost_allocation');

  // OPEX line categorization state
  const [checkedLines, setCheckedLines] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [newCategoryName, setNewCategoryName] = useState<string>('');

  const { data: categories = [] } = useOpexCategoriesQuery();
  const createCatMutation = useCreateOpexCategoryMutation();
  const lineOpexMutation = useKsefLineOpexMutation(inv.ksefNumber);
  const { data: opexData } = useKsefOpexLinesQuery(inv.ksefNumber, expanded);

  const isKor = isKorType(inv.invoiceType);
  const hasActivePz = (inv.pzDocuments ?? []).some((pz) => pz.status !== 'cancelled');
  // Close match panel automatically once invoice becomes linked
  if (showMatchPanel && hasActivePz) setShowMatchPanel(false);

  const sellerName = inv.seller?.name ?? '—';
  const sellerNip = inv.seller?.nip ?? inv.seller?.identifier?.value ?? '—';

  // Only fires when expanded; React Query caches result — instant on re-open
  const { data: parsed, isPending: linesLoading, isError: linesError } = useKsefInboxParseQuery(
    inv.ksefNumber,
    expanded,
  );

  const lines = parsed?.lines ?? null;
  const annotationStatus = (inv as ReceivedInvoiceMeta & { annotationStatus?: string }).annotationStatus ?? null;

  const handleBulkAssign = async () => {
    if (!bulkCategory || !lines) return;
    const line_categories: Record<string, string> = {};
    checkedLines.forEach((pos) => {
      line_categories[String(pos)] = bulkCategory;
    });
    await lineOpexMutation.mutateAsync(line_categories);
    setCheckedLines(new Set());
    setBulkCategory('');
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    const created = await createCatMutation.mutateAsync({ name: newCategoryName });
    if (created.slug) setBulkCategory(created.slug);
    setNewCategoryName('');
  };

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/30 transition-colors">
        <td className="px-3 py-2 text-sm text-muted-foreground whitespace-nowrap">
          {isoToDisplay(inv.issueDate)}
        </td>
        <td className="px-3 py-2 text-sm font-medium">
          <div className="flex items-center gap-1.5 flex-wrap">
            {inv.invoiceNumber || '—'}
            {isKor && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 whitespace-nowrap">
                {inv.invoiceType}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-sm">
          <div>{sellerName}</div>
          <div className="text-xs text-muted-foreground">{sellerNip}</div>
        </td>
        <td className="px-3 py-2 text-sm text-right tabular-nums whitespace-nowrap">
          {formatAmount(inv.grossAmount, inv.currency)}
        </td>
        <td className="px-3 py-2 text-sm text-right tabular-nums text-muted-foreground whitespace-nowrap">
          {formatAmount(inv.vatAmount, inv.currency)}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {hasCostAllocation && annotationStatus && (
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
                  ACCOUNTING_STATUS_COLORS[annotationStatus as AccountingStatus],
                )}
              >
                {ACCOUNTING_STATUS_LABELS[annotationStatus as AccountingStatus] ?? annotationStatus}
              </span>
            )}
            {(inv.pzDocuments ?? []).map((pz: PzDocumentRef) => {
              const cancelled = pz.status === 'cancelled';
              return (
                <Link
                  key={pz.id}
                  to={`/delivery/${pz.id}`}
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium hover:underline whitespace-nowrap',
                    cancelled
                      ? 'bg-muted text-muted-foreground line-through'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                  )}
                  title={cancelled ? 'PZ anulowany' : 'Przejdź do dokumentu PZ'}
                >
                  {pz.documentNumber}
                </Link>
              );
            })}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded((v) => !v)}
              className={cn('w-7 px-0', expanded && 'bg-muted')}
              title={expanded ? 'Zwiń' : 'Pokaż pozycje'}
            >
              {expanded ? '▲' : '▼'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={downloading === inv.ksefNumber}
              onClick={() => onDownload(inv.ksefNumber)}
            >
              XML
            </Button>
            {isKor ? (
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => onCreatePzKor(inv.ksefNumber)}
                title="Utwórz korektę PZ na podstawie tej faktury korygującej"
              >
                PZ-KOR
              </Button>
            ) : (
              <Button size="sm" onClick={() => onCreatePz(inv.ksefNumber)}>
                + PZ
              </Button>
            )}
            {!hasActivePz && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowMatchPanel((v) => !v)}
                className={cn(showMatchPanel && 'bg-muted')}
                title="Dopasuj do istniejącego PZ"
              >
                Dopasuj
              </Button>
            )}
            <OpexTagButton inv={inv} onOpenManager={onOpenCatManager} />
          </div>
        </td>
      </tr>
      {showMatchPanel && (
        <tr className="border-b border-border">
          <td colSpan={6} className="px-4 pb-3 pt-0">
            <MatchPzPanel inv={inv} onClose={() => setShowMatchPanel(false)} />
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            {linesLoading && <p className="text-sm text-muted-foreground">Pobieranie pozycji…</p>}
            {linesError && <p className="text-sm text-destructive">Błąd pobierania pozycji.</p>}
            {!linesLoading && !linesError && lines !== null && lines.length === 0 && (
              <p className="text-sm text-muted-foreground">Brak pozycji w fakturze.</p>
            )}
            {!linesLoading && lines !== null && lines.length > 0 && (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="pb-1 pr-2 font-medium w-6">
                        <input
                          type="checkbox"
                          checked={checkedLines.size === lines.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCheckedLines(new Set(lines.map((line) => line.position ?? 0)));
                            } else {
                              setCheckedLines(new Set());
                            }
                          }}
                          className="rounded border-input"
                          title="Zaznacz wszystkie"
                        />
                      </th>
                      <th className="text-left pb-1 pr-4 font-medium">Nazwa</th>
                      <th className="text-right pb-1 pr-4 font-medium">Ilość</th>
                      <th className="text-left pb-1 pr-4 font-medium">Jm.</th>
                      <th className="text-right pb-1 pr-4 font-medium">Cena netto</th>
                      <th className="text-right pb-1 pr-4 font-medium">VAT %</th>
                      <th className="text-right pb-1 pr-4 font-medium">Wartość netto</th>
                      <th className="text-left pb-1 pr-4 font-medium">Kategoria</th>
                      <th className="text-left pb-1 font-medium">PZ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => {
                      const linePos = line.position ?? i;
                      const linePzDocs = line.existing_pz_documents ?? [];
                      const hasActivePzLine = linePzDocs.some((p) => p.status !== 'cancelled');
                      const lineOpexCategory = opexData?.line_categories?.[String(linePos)] ?? null;
                      const categoryObj = lineOpexCategory
                        ? categories.find((c) => c.slug === lineOpexCategory)
                        : null;
                      const isChecked = checkedLines.has(linePos);
                      return (
                        <tr key={linePos} className={cn('border-t border-border/50', hasActivePzLine && 'bg-emerald-50/50 dark:bg-emerald-950/20')}>
                          <td className="py-1 pr-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setCheckedLines((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(linePos);
                                  else next.delete(linePos);
                                  return next;
                                });
                              }}
                              className="rounded border-input"
                            />
                          </td>
                          <td className="py-1 pr-4">{line.name}</td>
                          <td className="py-1 pr-4 text-right tabular-nums">{line.quantity}</td>
                          <td className="py-1 pr-4 text-muted-foreground">{line.unit}</td>
                          <td className="py-1 pr-4 text-right tabular-nums">{plMoney.format(line.unit_net_price)}</td>
                          <td className="py-1 pr-4 text-right tabular-nums text-muted-foreground">{line.vat_rate}%</td>
                          <td className="py-1 pr-4 text-right tabular-nums">{plMoney.format(line.line_net)}</td>
                          <td className="py-1 pr-4">
                            {categoryObj ? (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary whitespace-nowrap">
                                {categoryObj.name}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-1">
                            {linePzDocs.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {linePzDocs.map((pz: PzDocumentRef) => {
                                  const cancelled = pz.status === 'cancelled';
                                  return (
                                    <Link
                                      key={pz.id}
                                      to={`/delivery/${pz.id}`}
                                      className={cn(
                                        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium hover:underline whitespace-nowrap',
                                        cancelled
                                          ? 'bg-muted text-muted-foreground line-through'
                                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                                      )}
                                      title={cancelled ? 'PZ anulowany' : undefined}
                                    >
                                      {pz.documentNumber}
                                    </Link>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Bulk assign bar */}
                {checkedLines.size > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                      <span className="text-sm text-muted-foreground">
                        Zaznaczono {checkedLines.size} {checkedLines.size === 1 ? 'linię' : 'linie'}
                      </span>
                      <select
                        value={bulkCategory}
                        onChange={(e) => setBulkCategory(e.target.value)}
                        className="text-sm rounded-lg border border-input bg-background px-2 py-1"
                      >
                        <option value="">-- wybierz kategorię --</option>
                        {categories.filter((cat) => cat.slug).map((cat) => (
                          <option key={cat.id} value={cat.slug}>{cat.name}</option>
                        ))}
                        <option value="__new__">+ Utwórz nową kategorię...</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleBulkAssign()}
                        disabled={!bulkCategory || bulkCategory === '__new__' || lineOpexMutation.isPending}
                        className="text-sm font-medium text-primary hover:underline disabled:opacity-40"
                      >
                        Przypisz
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheckedLines(new Set())}
                        className="text-sm text-muted-foreground hover:text-foreground"
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
                          className="text-sm rounded-lg border border-input px-2 py-1"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCreateCategory()}
                          disabled={createCatMutation.isPending}
                          className="text-sm font-medium text-primary"
                        >
                          Utwórz
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkCategory('')}
                          className="text-sm text-muted-foreground"
                        >
                          Anuluj
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {hasCostAllocation && (
              <AnnotationPanel
                ksefNumber={inv.ksefNumber}
                lines={lines?.map((l, i) => ({ name: l.name, position: i, quantity: l.quantity })) ?? null}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function lastWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type InboxFilter = 'all' | 'pz' | 'category' | 'unassigned';

export function KSeFInboxPage() {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(lastWeekIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<InboxFilter>('all');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [catFilterOpen, setCatFilterOpen] = useState(false);
  const catFilterRef = useRef<HTMLDivElement>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const { data: allCategories = [] } = useOpexCategoriesQuery();

  const { data: session } = useKsefSessionQuery();
  const syncMutation = useKsefInboxSyncMutation();

  const { data, isPending, isError, error } = useKsefInboxQuery(
    dateFrom,
    dateTo,
    page,
    true,
  );

  // Close category filter dropdown on outside click
  useEffect(() => {
    if (!catFilterOpen) return;
    function handleClick(e: MouseEvent) {
      if (catFilterRef.current && !catFilterRef.current.contains(e.target as Node)) {
        setCatFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [catFilterOpen]);

  const handleSync = () => {
    syncMutation.mutate({ dateFrom, dateTo });
  };

  const handleDownload = (ksefRef: string) => {
    setDownloading(ksefRef);
    downloadXml(ksefRef);
    setTimeout(() => setDownloading(null), 3000);
  };

  const allInvoices = data?.invoices ?? [];
  const invoices = allInvoices.filter((inv) => {
    const hasPz = (inv.pzDocuments ?? []).some((p) => p.status !== 'cancelled');
    if (viewFilter === 'pz') return hasPz;
    if (viewFilter === 'category') {
      if (selectedCategories.size === 0) return !!inv.opex_category;
      return !!inv.opex_category && selectedCategories.has(inv.opex_category);
    }
    if (viewFilter === 'unassigned') return !hasPz && !inv.opex_category;
    return true;
  });
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const newCount = data?.new_count ?? 0;

  return (
    <div className="max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">
          Odebrane faktury KSeF
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCatManagerOpen((v) => !v)}
            title="Zarządzaj kategoriami kosztów"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            ⚙
          </button>
        {!session?.active && (
          <Link
            to="/settings/certificate"
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium',
              'ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground',
            )}
          >
            Zaloguj się do KSeF
          </Link>
        )}
        </div>
      </div>

      <OpexCategoryManager open={catManagerOpen} onClose={() => setCatManagerOpen(false)} />

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Od"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-40"
            />
            <Input
              label="Do"
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-40"
            />
            {(dateFrom || dateTo) && (
              <div className="pt-5">
                <Button
                  variant="outline"
                  onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
                >
                  Wyczyść
                </Button>
              </div>
            )}
            {session?.active && (
              <div className="pt-5">
                <Button onClick={handleSync} loading={syncMutation.isPending}>
                  Synchronizuj z KSeF
                </Button>
              </div>
            )}
          </div>
          {syncMutation.isSuccess && (syncMutation.data?.new_count ?? 0) > 0 && (
            <p className="mt-2 text-xs text-green-600 dark:text-green-400">
              Pobrano {syncMutation.data!.new_count} nowych faktur.
            </p>
          )}
          {syncMutation.isSuccess && syncMutation.data?.new_count === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Brak nowych faktur.</p>
          )}
          {syncMutation.isError && (
            <p className="mt-2 text-xs text-destructive">
              {syncMutation.error instanceof Error ? syncMutation.error.message : 'Błąd synchronizacji'}
            </p>
          )}
          {!session?.active && (
            <p className="mt-2 text-xs text-muted-foreground">
              Przeglądasz zapisane faktury. Aby pobrać nowe, zaloguj się do KSeF.
            </p>
          )}
          {/* View filter */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {([
              { id: 'all', label: 'Wszystkie' },
              { id: 'pz', label: 'Z PZ' },
              { id: 'unassigned', label: 'Nieprzypisane' },
            ] as { id: InboxFilter; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setViewFilter(id); setSelectedCategories(new Set()); }}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  viewFilter === id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}

            {/* Category multi-filter dropdown */}
            <div className="relative" ref={catFilterRef}>
              <button
                type="button"
                onClick={() => { setViewFilter('category'); setCatFilterOpen((v) => !v); }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  viewFilter === 'category'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                Kategorie
                {viewFilter === 'category' && selectedCategories.size > 0 && (
                  <span className="ml-0.5 rounded-full bg-white/30 px-1.5 text-[10px] font-semibold">
                    {selectedCategories.size}
                  </span>
                )}
                <span className="ml-0.5 text-[10px]">▾</span>
              </button>

              {catFilterOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[200px] rounded-xl border border-border bg-background shadow-lg py-1">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Filtruj według kategorii
                  </p>
                  {allCategories.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Brak kategorii</p>
                  )}
                  {allCategories.map((cat) => {
                    const checked = selectedCategories.has(cat.slug || cat.id);
                    return (
                      <label
                        key={cat.id}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const slug = cat.slug || cat.id;
                            setSelectedCategories((prev) => {
                              const next = new Set(prev);
                              if (checked) next.delete(slug);
                              else next.add(slug);
                              return next;
                            });
                          }}
                          className="rounded"
                        />
                        {cat.name}
                      </label>
                    );
                  })}
                  {selectedCategories.size > 0 && (
                    <div className="border-t border-border mt-1 pt-1 px-3">
                      <button
                        type="button"
                        onClick={() => setSelectedCategories(new Set())}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Wyczyść zaznaczenie
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Błąd pobierania faktur'}
        </p>
      )}

      {/* Results */}
      {!isError && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-3">
              <span>
                {isPending
                  ? 'Ładowanie…'
                  : total === 0
                    ? 'Brak zapisanych faktur'
                    : `${total} faktur${total === 1 ? 'a' : total < 5 ? 'y' : ''}`}
              </span>
              {newCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  +{newCount} nowych
                </span>
              )}
            </CardTitle>
          </CardHeader>
          {invoices.length > 0 && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Data</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Nr faktury</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Wystawca</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Brutto</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">VAT</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv: ReceivedInvoiceMeta) => (
                      <InvoiceRow
                        key={inv.ksefNumber}
                        inv={inv}
                        downloading={downloading}
                        onDownload={handleDownload}
                        onCreatePz={(ref) => navigate(`/ksef/inbox/${encodeURIComponent(ref)}/pz`)}
                        onCreatePzKor={(ref) => navigate(`/ksef/inbox/${encodeURIComponent(ref)}/pz-kor`)}
                        onOpenCatManager={() => setCatManagerOpen(true)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {(page > 1 || hasMore) && (
                <div className="flex items-center justify-between border-t border-border px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    Strona {page}{total > 0 && ` z ${Math.ceil(total / PAGE_SIZE)}`}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Poprzednia
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!hasMore}
                      onClick={() => setPage(page + 1)}
                    >
                      Następna
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

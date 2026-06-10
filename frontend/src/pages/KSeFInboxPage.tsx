import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useKsefInboxParseQuery, useKsefInboxQuery, useKsefInboxSyncMutation, useKsefSessionQuery } from '@/query/use-invoices';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import type { PzDocumentRef, ReceivedInvoiceMeta } from '@/services/ksef.service';

interface ParsedInvoiceLine {
  name: string;
  unit: string;
  quantity: number;
  unitNetPrice: number;
  vatRate: string;
  lineNet: number;
}

interface ParsedInvoice {
  lines: ParsedInvoiceLine[];
  error?: string;
}

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

async function fetchAndParseXml(ksefNumber: string): Promise<ParsedInvoice> {
  const token = authStorage.getAccessToken();
  const url = `/api/ksef/inbox/${encodeURIComponent(ksefNumber)}/xml/`;
  const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!resp.ok) return { lines: [], error: `HTTP ${resp.status}` };
  const xml = await resp.text();
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = 'http://crd.gov.pl/wzor/2025/06/25/13775/';
    const rows = Array.from(doc.getElementsByTagNameNS(ns, 'FaWiersz'));
    const lines: ParsedInvoiceLine[] = rows.map((row) => {
      const t = (tag: string) => row.getElementsByTagNameNS(ns, tag)[0]?.textContent ?? '';
      const qty = parseFloat(t('P_8B')) || 0;
      const unitNet = parseFloat(t('P_9A')) || 0;
      return {
        name: t('P_7'),
        unit: t('P_8A'),
        quantity: qty,
        unitNetPrice: unitNet,
        vatRate: t('P_12'),
        lineNet: parseFloat(t('P_11')) || qty * unitNet,
      };
    });
    return { lines };
  } catch {
    return { lines: [], error: 'Błąd parsowania XML' };
  }
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
}

function InvoiceRow({ inv, downloading, onDownload, onCreatePz }: InvoiceRowProps) {
  const [expanded, setExpanded] = useState(false);

  const sellerName = inv.seller?.name ?? '—';
  const sellerNip = inv.seller?.nip ?? inv.seller?.identifier?.value ?? '—';

  // Only fires when expanded; React Query caches result — instant on re-open
  const { data: parsed, isPending: linesLoading, isError: linesError } = useKsefInboxParseQuery(
    inv.ksefNumber,
    expanded,
  );

  const lines = parsed?.lines ?? null;

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/30 transition-colors">
        <td className="px-3 py-2 text-sm text-muted-foreground whitespace-nowrap">
          {isoToDisplay(inv.issueDate)}
        </td>
        <td className="px-3 py-2 text-sm font-medium">{inv.invoiceNumber || '—'}</td>
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
            <Button size="sm" onClick={() => onCreatePz(inv.ksefNumber)}>
              + PZ
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            {linesLoading && <p className="text-sm text-muted-foreground">Pobieranie pozycji…</p>}
            {linesError && <p className="text-sm text-destructive">Błąd pobierania pozycji.</p>}
            {!linesLoading && !linesError && lines !== null && lines.length === 0 && (
              <p className="text-sm text-muted-foreground">Brak pozycji w fakturze.</p>
            )}
            {!linesLoading && lines !== null && lines.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left pb-1 pr-4 font-medium">Nazwa</th>
                    <th className="text-right pb-1 pr-4 font-medium">Ilość</th>
                    <th className="text-left pb-1 pr-4 font-medium">Jm.</th>
                    <th className="text-right pb-1 pr-4 font-medium">Cena netto</th>
                    <th className="text-right pb-1 pr-4 font-medium">VAT %</th>
                    <th className="text-right pb-1 pr-4 font-medium">Wartość netto</th>
                    <th className="text-left pb-1 font-medium">PZ</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const linePzDocs = line.existing_pz_documents ?? [];
                    const hasActivePz = linePzDocs.some((p) => p.status !== 'cancelled');
                    return (
                      <tr key={i} className={cn('border-t border-border/50', hasActivePz && 'bg-emerald-50/50 dark:bg-emerald-950/20')}>
                        <td className="py-1 pr-4">{line.name}</td>
                        <td className="py-1 pr-4 text-right tabular-nums">{line.quantity}</td>
                        <td className="py-1 pr-4 text-muted-foreground">{line.unit}</td>
                        <td className="py-1 pr-4 text-right tabular-nums">{plMoney.format(line.unit_net_price)}</td>
                        <td className="py-1 pr-4 text-right tabular-nums text-muted-foreground">{line.vat_rate}%</td>
                        <td className="py-1 pr-4 text-right tabular-nums">{plMoney.format(line.line_net)}</td>
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

export function KSeFInboxPage() {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(lastWeekIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: session } = useKsefSessionQuery();
  const syncMutation = useKsefInboxSyncMutation();

  const { data, isPending, isError, error } = useKsefInboxQuery(
    dateFrom,
    dateTo,
    page,
    true,
  );

  const handleSync = () => {
    syncMutation.mutate({ dateFrom, dateTo });
  };

  const handleDownload = (ksefRef: string) => {
    setDownloading(ksefRef);
    downloadXml(ksefRef);
    setTimeout(() => setDownloading(null), 3000);
  };

  const invoices = data?.invoices ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const newCount = data?.new_count ?? 0;

  return (
    <div className="max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">
          Odebrane faktury KSeF
        </h1>
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

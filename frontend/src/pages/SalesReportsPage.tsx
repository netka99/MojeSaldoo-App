import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { pl } from 'date-fns/locale';

import { Button } from '@/components/ui/Button';
import {
  useSalesReportsQuery,
  useDeleteSalesReportMutation,
  useSalesTemplatesQuery,
  useDeleteSalesTemplateMutation,
  useUpdateSalesTemplateMutation,
} from '@/query/use-sales-reports';
import type { DailySalesReportSummary, SalesReportTemplate } from '@/types/sales-reports.types';
import { apiClient } from '@/services/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatDate(iso: string) {
  try { return format(parseISO(iso), 'd MMM yyyy', { locale: pl }); }
  catch { return iso; }
}

function marginPct(amount: string, cost: string | null): string | null {
  const rev = parseFloat(amount);
  const cost_ = cost ? parseFloat(cost) : null;
  if (!cost_ || rev === 0) return null;
  return ((rev - cost_) / rev * 100).toFixed(1) + '%';
}

// ---------------------------------------------------------------------------
// Report row
// ---------------------------------------------------------------------------

function ReportRow({ report }: { report: DailySalesReportSummary }) {
  const deleteMutation = useDeleteSalesReportMutation();
  const [confirming, setConfirming] = useState(false);

  const margin = marginPct(report.amount, report.cost_total);
  const isDraft = report.status === 'draft';

  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/sprzedaz/${report.id}`}
            className="text-sm font-semibold hover:text-primary transition-colors"
          >
            {report.report_number || 'SZKIC'}
          </Link>
          {isDraft && (
            <span className="text-xs bg-muted text-muted-foreground rounded-md px-1.5 py-0.5">
              szkic
            </span>
          )}
          {report.notes && (
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">{report.notes}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDate(report.date)} · {report.line_count} {report.line_count === 1 ? 'produkt' : 'produktów'}
        </p>
      </div>

      {margin && (
        <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
          marża {margin}
        </span>
      )}

      <span className="text-base font-bold text-green-600 shrink-0 w-28 text-right">
        {pln.format(parseFloat(report.amount))}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        <Link
          to={`/sprzedaz/${report.id}`}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors"
        >
          Edytuj
        </Link>
        <button
          onClick={() => confirming ? deleteMutation.mutate(report.id) : setConfirming(true)}
          disabled={deleteMutation.isPending}
          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
            confirming ? 'bg-destructive text-white' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          }`}
        >
          {confirming ? 'Tak' : 'Usuń'}
        </button>
        {confirming && (
          <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground hover:text-foreground px-1">
            Anuluj
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template row
// ---------------------------------------------------------------------------

function TemplateRow({ template }: { template: SalesReportTemplate }) {
  const deleteMutation = useDeleteSalesTemplateMutation();
  const updateMutation = useUpdateSalesTemplateMutation();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{template.name}</span>
          {template.is_default && (
            <span className="text-xs bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-medium">
              domyślny
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {template.lines.length} {template.lines.length === 1 ? 'produkt' : 'produktów'}
          {' · '}
          {formatDate(template.created_at)}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!template.is_default && (
          <button
            onClick={() => updateMutation.mutate({ id: template.id, data: { is_default: true } })}
            disabled={updateMutation.isPending}
            className="text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-lg hover:bg-muted transition-colors"
          >
            Ustaw domyślny
          </button>
        )}
        <button
          onClick={() => confirming ? deleteMutation.mutate(template.id) : setConfirming(true)}
          disabled={deleteMutation.isPending}
          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
            confirming ? 'bg-destructive text-white' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          }`}
        >
          {confirming ? 'Tak' : 'Usuń'}
        </button>
        {confirming && (
          <button onClick={() => setConfirming(false)} className="text-xs text-muted-foreground hover:text-foreground px-1">
            Anuluj
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type TabKey = 'all' | 'saved' | 'draft' | 'templates';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function SalesReportsPage() {
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [exportMonth, setExportMonth] = useState(currentMonth);
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const response = await apiClient.get(`/sales/reports/export-csv/`, {
        params: { month: exportMonth },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RK_${exportMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const statusFilter = activeTab === 'templates' ? undefined : (activeTab === 'all' ? undefined : activeTab);

  const { data, isLoading: reportsLoading } = useSalesReportsQuery({
    status: statusFilter,
    page,
  });
  const { data: templates = [], isLoading: templatesLoading } = useSalesTemplatesQuery();

  const reports = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.ceil(total / 20);

  const totalRevenue = reports.reduce((s, r) => s + parseFloat(r.amount), 0);

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'all', label: 'Wszystkie' },
    { key: 'saved', label: 'Zapisane' },
    { key: 'draft', label: 'Szkice' },
    { key: 'templates', label: `Szablony${templates.length > 0 ? ` (${templates.length})` : ''}` },
  ];

  const isTemplatesTab = activeTab === 'templates';

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Sprzedaż gotówkowa</h1>
          <p className="text-xs text-muted-foreground">Raporty kasowe (RK) — sprzedaż B2C / gotówkowa</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-2 py-1">
            <span className="text-xs text-muted-foreground shrink-0">Eksport CSV</span>
            <input
              type="month"
              value={exportMonth}
              onChange={(e) => setExportMonth(e.target.value)}
              className="text-xs border-0 bg-transparent focus:outline-none focus:ring-0 text-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportCsv}
              disabled={exporting}
              loading={exporting}
              className="h-7 px-2 text-xs"
            >
              ↓
            </Button>
          </div>
          <Link to="/sprzedaz/nowy">
            <Button>+ Nowy raport</Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Templates tab */}
      {isTemplatesTab && (
        <div className="rounded-xl border border-border bg-background">
          {templatesLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Ładowanie…</p>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm text-muted-foreground">Brak szablonów</p>
              <p className="text-xs text-muted-foreground">
                Podczas tworzenia raportu zaznacz "Zapisz jako szablon"
              </p>
            </div>
          ) : (
            templates.map((t) => <TemplateRow key={t.id} template={t} />)
          )}
        </div>
      )}

      {/* Reports list */}
      {!isTemplatesTab && (
        <>
          <div className="rounded-xl border border-border bg-background">
            {reportsLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Ładowanie…</p>
            ) : reports.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Brak raportów</p>
                <Link to="/sprzedaz/nowy">
                  <Button variant="outline" size="sm">Utwórz pierwszy raport</Button>
                </Link>
              </div>
            ) : (
              <>
                {reports.map((r) => <ReportRow key={r.id} report={r} />)}
                <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    {total} {total === 1 ? 'raport' : 'raportów'}
                  </span>
                  <span className="text-sm font-bold text-green-600">
                    {pln.format(totalRevenue)} (ta strona)
                  </span>
                </div>
              </>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
                className="text-sm text-muted-foreground disabled:opacity-40 hover:text-foreground px-3 py-1 rounded-lg hover:bg-muted"
              >
                ‹ Poprzednia
              </button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="text-sm text-muted-foreground disabled:opacity-40 hover:text-foreground px-3 py-1 rounded-lg hover:bg-muted"
              >
                Następna ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

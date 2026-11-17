import { useState, useRef, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useInventoryReportQuery, useExpiryAlertsQuery } from '@/query/use-reports';
import { authStorage } from '@/services/api';
import { cn } from '@/lib/utils';
import { downloadCsv } from '@/lib/downloadCsv';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import type { ExpiryAlertRow, InventoryReportRow } from '@/types/reporting.types';

const qty2 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function formatQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isNaN(n) ? '—' : qty2.format(n);
}

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isNaN(n) ? '—' : pln.format(n);
}

const tableClass = 'w-full border-collapse text-sm';
const thClass = 'border-b bg-muted/50 px-3 py-2 text-left font-medium text-muted-foreground';
const tdClass = 'border-b px-3 py-2';

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  finished: 'Wyrób gotowy',
  material: 'Surowiec',
  trade: 'Towar',
  service: 'Usługa',
};

type TypeFilter = 'all' | 'finished' | 'material' | 'trade' | 'service';

function TypeFilterHeader({
  presentTypes,
  value,
  onChange,
}: {
  presentTypes: string[];
  value: TypeFilter;
  onChange: (v: TypeFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const options: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: 'Wszystkie' },
    ...(['finished', 'material', 'trade', 'service'] as const)
      .filter((t) => presentTypes.includes(t))
      .map((t) => ({ value: t, label: PRODUCT_TYPE_LABEL[t] })),
  ];

  const activeLabel = options.find((o) => o.value === value)?.label ?? 'Typ';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {value !== 'all' ? (
          <span className="text-primary font-semibold">{activeLabel}</span>
        ) : (
          'Typ'
        )}
        <svg className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-border bg-white py-1 shadow-apple-md">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50',
                value === opt.value ? 'font-semibold text-primary' : 'text-slate-700',
              )}
            >
              {value === opt.value && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              {value !== opt.value && <span className="h-1.5 w-1.5" />}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function daysOfStockClass(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days <= 7) return 'text-red-600 font-semibold';
  if (days <= 14) return 'text-orange-500 font-semibold';
  if (days <= 30) return 'text-yellow-600';
  return 'text-green-600';
}

function expiryClass(row: ExpiryAlertRow): string {
  if (row.expired) return 'text-red-600 font-semibold';
  if (row.daysUntilExpiry <= 7) return 'text-red-500 font-semibold';
  if (row.daysUntilExpiry <= 14) return 'text-orange-500';
  if (row.daysUntilExpiry <= 30) return 'text-yellow-600';
  return '';
}

function StockTable({ rows, showWarehouse }: { rows: InventoryReportRow[]; showWarehouse: boolean }) {
  const [showOnlyLow, setShowOnlyLow] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // Determine which type buttons to show (only types that exist in data)
  const presentTypes = Array.from(new Set(rows.map((r) => r.productType).filter(Boolean))) as string[];

  let filtered = typeFilter === 'all' ? rows : rows.filter((r) => r.productType === typeFilter);
  if (showOnlyLow) filtered = filtered.filter((r) => r.belowMinimum);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnlyLow}
            onChange={(e) => setShowOnlyLow(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Tylko poniżej minimum
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} z {rows.length} pozycji
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak danych.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass} aria-label="Stan magazynowy">
            <thead>
              <tr>
                <th className={thClass}>Produkt</th>
                <th className={thClass}>
                  <TypeFilterHeader
                    presentTypes={presentTypes}
                    value={typeFilter}
                    onChange={setTypeFilter}
                  />
                </th>
                {showWarehouse && <th className={thClass}>Magazyn</th>}
                <th className={cn(thClass, 'text-right')}>Dostępne</th>
                <th className={cn(thClass, 'text-right')}>Min. alert</th>
                <th className={cn(thClass, 'text-right')}>Dni zapasów</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={`${row.productName}-${row.warehouseCode}-${i}`} className={row.belowMinimum ? 'bg-red-50/60' : ''}>
                  <td className={tdClass}>
                    {row.belowMinimum && (
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" aria-label="Poniżej minimum" />
                    )}
                    {row.productName}
                  </td>
                  <td className={cn(tdClass, 'text-muted-foreground text-xs')}>
                    {row.productType ? (PRODUCT_TYPE_LABEL[row.productType] ?? row.productType) : '—'}
                  </td>
                  {showWarehouse && (
                    <td className={cn(tdClass, 'font-mono text-xs')}>{row.warehouseCode}</td>
                  )}
                  <td className={cn(tdClass, 'text-right tabular-nums')}>{formatQty(row.quantityAvailable)}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums text-muted-foreground')}>
                    {row.minStockAlert != null ? formatQty(row.minStockAlert) : '—'}
                  </td>
                  <td className={cn(tdClass, 'text-right tabular-nums', daysOfStockClass(row.daysOfStock))}>
                    {row.daysOfStock !== null ? `${row.daysOfStock} dni` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpiryTable({ rows, showWarehouse }: { rows: ExpiryAlertRow[]; showWarehouse: boolean }) {
  const [horizonDays, setHorizonDays] = useState(90);

  const filtered = rows.filter((r) => r.daysUntilExpiry <= horizonDays);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Pokaż partie wygasające w ciągu:</span>
        {[30, 60, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setHorizonDays(d)}
            className={cn(
              'rounded px-3 py-1 text-sm font-medium transition-colors',
              horizonDays === d
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {d} dni
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} partii</span>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak partii wygasających w tym okresie.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass} aria-label="Partie bliskie terminu ważności">
            <thead>
              <tr>
                <th className={thClass}>Produkt</th>
                {showWarehouse && <th className={thClass}>Magazyn</th>}
                <th className={thClass}>Partia</th>
                <th className={cn(thClass, 'text-right')}>Data wygaśnięcia</th>
                <th className={cn(thClass, 'text-right')}>Pozostało dni</th>
                <th className={cn(thClass, 'text-right')}>Ilość</th>
                <th className={cn(thClass, 'text-right')}>Koszt/szt.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.batchId}>
                  <td className={tdClass}>{row.productName}</td>
                  {showWarehouse && (
                    <td className={cn(tdClass, 'font-mono text-xs')}>{row.warehouseCode || '—'}</td>
                  )}
                  <td className={cn(tdClass, 'text-xs text-muted-foreground')}>{row.batchNumber || '—'}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums')}>{row.expiryDate}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums', expiryClass(row))}>
                    {row.expired ? `Wygasło ${Math.abs(row.daysUntilExpiry)} dni temu` : `${row.daysUntilExpiry} dni`}
                  </td>
                  <td className={cn(tdClass, 'text-right tabular-nums')}>{formatQty(row.quantityRemaining)}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums text-muted-foreground')}>
                    {formatMoney(row.unitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function InventoryReportPage() {
  const location = useLocation();
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <InventoryReportPageContent />;
}

function InventoryReportPageContent() {
  const warehousesEnabled = useModuleGuard('warehouses');
  const inventory = useInventoryReportQuery();
  const expiry = useExpiryAlertsQuery(90);

  const lowStockCount = inventory.data?.filter((r) => r.belowMinimum).length ?? 0;
  const expiredCount = expiry.data?.filter((r) => r.expired).length ?? 0;
  const expiringSoonCount = expiry.data?.filter((r) => !r.expired && r.daysUntilExpiry <= 30).length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-foreground">Stan magazynu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stan zapasów, rotacja towaru i partie bliskie terminu ważności.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void downloadCsv('/reports/inventory/', {}, 'raport-magazyn.csv')}
          className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Eksport CSV
        </button>
      </div>

      {/* Summary badges */}
      {(lowStockCount > 0 || expiredCount > 0 || expiringSoonCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {lowStockCount > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span className="font-semibold">{lowStockCount}</span> pozycji poniżej minimum
            </div>
          )}
          {expiredCount > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span className="font-semibold">{expiredCount}</span> wygasłych partii
            </div>
          )}
          {expiringSoonCount > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
              <span className="font-semibold">{expiringSoonCount}</span> partii wygasa w ciągu 30 dni
            </div>
          )}
        </div>
      )}

      {/* Stock levels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Stan zapasów</CardTitle>
          <p className="text-xs text-muted-foreground">
            Dni zapasów = suma dostępnych ÷ średnia dzienna sprzedaż z ostatnich 90 dni
          </p>
        </CardHeader>
        <CardContent>
          {inventory.isError && (
            <p className="text-sm text-destructive">
              {inventory.error instanceof Error ? inventory.error.message : 'Błąd ładowania danych'}
            </p>
          )}
          {inventory.isFetching && !inventory.data && (
            <p className="text-sm text-muted-foreground">Ładowanie…</p>
          )}
          {inventory.data && <StockTable rows={inventory.data} showWarehouse={warehousesEnabled} />}
        </CardContent>
      </Card>

      {/* Expiry alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Partie bliskie terminu ważności</CardTitle>
          <p className="text-xs text-muted-foreground">
            Partie z ustawionym terminem ważności i pozostałą ilością &gt; 0
          </p>
        </CardHeader>
        <CardContent>
          {expiry.isError && (
            <p className="text-sm text-destructive">
              {expiry.error instanceof Error ? expiry.error.message : 'Błąd ładowania danych'}
            </p>
          )}
          {expiry.isFetching && !expiry.data && (
            <p className="text-sm text-muted-foreground">Ładowanie…</p>
          )}
          {expiry.data && expiry.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Brak partii z terminem ważności w ciągu 90 dni.</p>
          )}
          {expiry.data && expiry.data.length > 0 && (
            <ExpiryTable rows={expiry.data} showWarehouse={warehousesEnabled} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

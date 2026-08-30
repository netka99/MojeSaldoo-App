import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { WarehouseForm } from '@/components/features/warehouses/WarehouseForm';
import { AddStockDialog } from '@/components/features/warehouses/AddStockDialog';
import { StockCorrectionDialog } from '@/components/features/warehouses/StockCorrectionDialog';
import { LossDialog } from '@/components/features/warehouses/LossDialog';
import { TransferDialog } from '@/components/features/warehouses/TransferDialog';
import { ProductHistoryDrawer } from '@/components/features/warehouses/ProductHistoryDrawer';
import { StockRowExpanded } from '@/components/features/warehouses/StockRowExpanded';
import { Accordion } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  useDeleteWarehouseMutation,
  useUpdateWarehouseMutation,
  useWarehouseQuery,
  useWarehouseStockQuery,
} from '@/query/use-warehouses';
import { usePermission } from '@/hooks/usePermission';
import { authStorage } from '@/services/api';
import type { WarehouseStockItem, WarehouseWrite } from '@/types';

function fmt(v: string | number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  return unit ? `${s} ${unit}` : s;
}

function StockBadge({ item }: { item: WarehouseStockItem }) {
  if (item.is_below_minimum) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
        ⚠ Poniżej min.
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
      OK
    </span>
  );
}

function ExpiryTag({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  const expired = days < 0;
  const urgent = days <= 7;
  const warning = days <= 30;
  if (!expired && !warning) return null;

  const label = expired
    ? `Partia wygasła ${Math.abs(days)} d. temu`
    : days === 0
      ? 'Partia wygasa dziś'
      : `Partia wg. za ${days} d.`;

  return (
    <span className={`mt-0.5 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
      expired || urgent ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'
    }`}>
      ⚠ {label}
    </span>
  );
}

type ActiveDialog =
  | { type: 'correction'; item: WarehouseStockItem }
  | { type: 'loss'; item: WarehouseStockItem }
  | { type: 'transfer' }
  | { type: 'add' }
  | null;

export function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const warehouseQ = useWarehouseQuery(id);
  const update = useUpdateWarehouseMutation();
  const remove = useDeleteWarehouseMutation();
  const canManage = usePermission('can_manage_products');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

  // inline expanded row — stores product_id of expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // full-history drawer — stores the stock item
  const [drawerItem, setDrawerItem] = useState<WarehouseStockItem | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showBelowMin, setShowBelowMin] = useState(false);
  const [expiringDays, setExpiringDays] = useState<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const stockQ = useWarehouseStockQuery(id, {
    search: search || undefined,
    below_minimum: showBelowMin || undefined,
    expiring_days: expiringDays ?? undefined,
  });

  const stockItems = useMemo(() => stockQ.data ?? [], [stockQ.data]);
  const existingProductIds = useMemo(() => new Set(stockItems.map((s) => s.product_id)), [stockItems]);

  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!id) return <Navigate to="/warehouses" replace />;

  const warehouse = warehouseQ.data;

  const handleDelete = async () => {
    if (!warehouse) return;
    if (!window.confirm(`Usunąć magazyn ${warehouse.code} (${warehouse.name})?`)) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(warehouse.id);
      navigate('/warehouses');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Usunięcie nie powiodło się');
    }
  };

  const closeDialog = () => setActiveDialog(null);

  // how many columns the table has (for the colSpan of expanded row)
  const colCount = canManage ? 8 : 7;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
          Wróć do listy
        </Button>
      </div>

      {warehouseQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie magazynu…</p>}
      {warehouseQ.isError && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {warehouseQ.error instanceof Error ? warehouseQ.error.message : 'Nie udało się wczytać magazynu'}
        </div>
      )}

      {warehouse && (
        <>
          <Card className="shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">
                    {warehouse.code} — {warehouse.name}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Stan produktów w tym magazynie.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <input
                      type="search"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Szukaj produktu…"
                      className="h-8 rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      aria-label="Szukaj produktu"
                    />
                  </div>

                  <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showBelowMin}
                      onChange={(e) => setShowBelowMin(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Poniżej min.
                  </label>

                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    Ważność partii:
                    <select
                      value={expiringDays ?? ''}
                      onChange={(e) => setExpiringDays(e.target.value ? Number(e.target.value) : null)}
                      className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">wszystkie</option>
                      <option value="7">wygasa ≤ 7 dni</option>
                      <option value="14">wygasa ≤ 14 dni</option>
                      <option value="30">wygasa ≤ 30 dni</option>
                    </select>
                  </label>

                  {canManage && (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => setActiveDialog({ type: 'transfer' })}>
                        ⇄ Przesuń
                      </Button>
                      <Button type="button" size="sm" onClick={() => setActiveDialog({ type: 'add' })}>
                        + Dodaj produkt
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              {stockQ.isLoading && <p className="text-sm text-muted-foreground">Ładowanie stanów…</p>}
              {stockQ.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {stockQ.error instanceof Error ? stockQ.error.message : 'Nie udało się wczytać stanu magazynu'}
                </p>
              )}
              {!stockQ.isLoading && !stockQ.isError && stockItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {search || showBelowMin || expiringDays ? 'Brak wyników dla tych filtrów.' : 'Brak pozycji na tym magazynie.'}
                </p>
              )}
              {!stockQ.isLoading && !stockQ.isError && stockItems.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Produkt</th>
                        <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">SKU</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Dostępne</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Zarezerwowane</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Razem</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Min. stan</th>
                        <th scope="col" className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                        {canManage && (
                          <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">Akcje</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {stockItems.map((row) => {
                        const isExpanded = expandedId === row.product_id;
                        return (
                          <>
                            <tr
                              key={row.id}
                              className={`cursor-pointer transition-colors ${isExpanded ? 'bg-muted/40' : row.is_below_minimum ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-muted/30'}`}
                              onClick={() => setExpandedId(isExpanded ? null : row.product_id)}
                            >
                              <td className="px-4 py-3 font-medium text-foreground">
                                <div className="flex items-center gap-1.5">
                                  <svg
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                    aria-hidden
                                  >
                                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  <div className="min-w-0">
                                    <div className="truncate">{row.product_name}</div>
                                    <ExpiryTag dateStr={row.nearest_expiry_date} />
                                  </div>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                                {row.product_sku ?? '—'}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                                {fmt(row.quantity_available, row.product_unit)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                                {fmt(row.quantity_reserved, row.product_unit)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-foreground">
                                {fmt(row.quantity_total, row.product_unit)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                                {fmt(row.min_stock_alert)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <StockBadge item={row} />
                              </td>
                              {canManage && (
                                <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      className="rounded-md px-2 py-1 text-xs font-medium text-primary ring-1 ring-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                      onClick={() => setActiveDialog({ type: 'correction', item: row })}
                                    >
                                      Korekta
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md px-2 py-1 text-xs font-medium text-destructive ring-1 ring-destructive/30 hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                                      onClick={() => setActiveDialog({ type: 'loss', item: row })}
                                    >
                                      Strata
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>

                            {isExpanded && (
                              <StockRowExpanded
                                key={`${row.id}-expanded`}
                                item={row}
                                warehouseId={warehouse.id}
                                colSpan={colCount}
                                onOpenDrawer={() => setDrawerItem(row)}
                              />
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dialogs */}
          {activeDialog?.type === 'add' && (
            <AddStockDialog
              warehouseId={warehouse.id}
              warehouseName={`${warehouse.code} — ${warehouse.name}`}
              existingProductIds={existingProductIds}
              onClose={closeDialog}
            />
          )}
          {activeDialog?.type === 'correction' && (
            <StockCorrectionDialog
              productId={activeDialog.item.product_id}
              productName={activeDialog.item.product_name}
              productUnit={activeDialog.item.product_unit}
              currentQty={parseFloat(String(activeDialog.item.quantity_available))}
              warehouseId={warehouse.id}
              warehouseName={`${warehouse.code} — ${warehouse.name}`}
              onClose={closeDialog}
            />
          )}
          {activeDialog?.type === 'loss' && (
            <LossDialog
              productId={activeDialog.item.product_id}
              productName={activeDialog.item.product_name}
              productUnit={activeDialog.item.product_unit}
              currentQty={parseFloat(String(activeDialog.item.quantity_available))}
              warehouseId={warehouse.id}
              warehouseName={`${warehouse.code} — ${warehouse.name}`}
              onClose={closeDialog}
            />
          )}
          {activeDialog?.type === 'transfer' && (
            <TransferDialog
              sourceWarehouseId={warehouse.id}
              sourceWarehouseCode={warehouse.code}
              sourceWarehouseName={warehouse.name}
              stockItems={stockItems}
              onClose={closeDialog}
            />
          )}

          {/* Full history drawer */}
          {drawerItem && (
            <ProductHistoryDrawer
              item={drawerItem}
              warehouseId={warehouse.id}
              warehouseName={`${warehouse.code} — ${warehouse.name}`}
              onClose={() => setDrawerItem(null)}
            />
          )}

          <Accordion
            title="Ustawienia magazynu"
            description="Edycja danych, opcji oraz trwałe usunięcie magazynu"
            defaultOpen={false}
          >
            <div className="space-y-6">
              {submitError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                  {submitError}
                </p>
              )}
              <WarehouseForm
                warehouse={warehouse}
                presentation="embedded"
                submitLabel="Zapisz ustawienia"
                onSubmit={async (data: WarehouseWrite) => {
                  setSubmitError(null);
                  try {
                    await update.mutateAsync({ id: warehouse.id, body: data });
                  } catch (e) {
                    setSubmitError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian');
                  }
                }}
                onCancel={() => navigate(-1)}
                isLoading={update.isPending}
              />

              <div className="border-t border-border pt-6">
                {deleteError && (
                  <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                    {deleteError}
                  </p>
                )}
                <p className="text-sm font-medium text-foreground">Usuń magazyn</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Usunięcie jest nieodwracalne. Nie usuwaj magazynu, jeśli nadal są na nim dokumenty lub rezerwacje.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-3"
                  disabled={remove.isPending}
                  loading={remove.isPending}
                  onClick={() => void handleDelete()}
                >
                  Usuń magazyn
                </Button>
              </div>
            </div>
          </Accordion>
        </>
      )}
    </div>
  );
}

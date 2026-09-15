/**
 * PurchaseOrdersPage — lista i zarządzanie Zamówieniami do Dostawców (ZD).
 *
 * Route: /purchase-orders
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { useAllSuppliersQuery } from '@/query/use-suppliers';
import { useWarehouseListQuery } from '@/query/use-warehouses';
import {
  useSupplierOrderListQuery,
  useCreateSupplierOrderMutation,
  useSendSupplierOrderMutation,
  useCancelSupplierOrderMutation,
  useCreatePzFromSupplierOrderMutation,
} from '@/query/use-purchase-orders';
import type { SupplierOrder, SupplierOrderStatus } from '@/types/purchase-order.types';

// ─── formatters ───────────────────────────────────────────────────────────────

const plDate = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return plDate.format(d);
}

function statusLabel(s: SupplierOrderStatus): string {
  switch (s) {
    case 'draft':     return 'Szkic';
    case 'sent':      return 'Wysłane';
    case 'partial':   return 'Częściowo';
    case 'fulfilled': return 'Zrealizowane';
    case 'cancelled': return 'Anulowane';
  }
}

function statusBadge(s: SupplierOrderStatus): string {
  switch (s) {
    case 'draft':     return 'bg-gray-100 text-gray-700';
    case 'sent':      return 'bg-blue-100 text-blue-800';
    case 'partial':   return 'bg-amber-100 text-amber-800';
    case 'fulfilled': return 'bg-green-100 text-green-800';
    case 'cancelled': return 'bg-red-100 text-red-700';
  }
}

// ─── Create modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
}

function CreateModal({ onClose }: CreateModalProps) {
  const { data: suppliers } = useAllSuppliersQuery();
  const createMut = useCreateSupplierOrderMutation();

  const [supplierId, setSupplierId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ productId: '', productName: '', qty: '', price: '' }]);
  const [productSearch, setProductSearch] = useState('');

  // We need product list — import via product query
  const [products, setProducts] = useState<{ id: string; name: string; unit: string }[]>([]);

  // Fetch products on mount
  React.useEffect(() => {
    import('@/services/product.service').then(({ productService }) => {
      productService.fetchList({ page: 1, page_size: 500 }).then((r) => {
        setProducts((r.results ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit ?? '' })));
      });
    });
  }, []);

  function updateLine(idx: number, field: string, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, { productId: '', productName: '', qty: '', price: '' }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const items = lines
      .filter((l) => l.productId && l.qty)
      .map((l) => ({
        product_id: l.productId,
        quantity_ordered: l.qty,
        ...(l.price ? { unit_price_net: l.price } : {}),
      }));
    if (!items.length) return;
    await createMut.mutateAsync({
      supplier_id: supplierId || null,
      issue_date: issueDate || undefined,
      expected_delivery_date: expectedDate || null,
      notes,
      items,
    });
    onClose();
  }

  const filteredProducts = products.filter(
    (p) => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="mb-4 text-lg font-semibold">Nowe zamówienie ZD</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Supplier */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dostawca</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">— brak dostawcy —</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data wystawienia</label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Oczekiwana dostawa</label>
              <input
                type="date"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Pozycje zamówienia</label>
              <input
                type="text"
                placeholder="Szukaj produktu…"
                className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-2 text-sm"
                    value={line.productId}
                    onChange={(e) => {
                      const prod = products.find((p) => p.id === e.target.value);
                      updateLine(idx, 'productId', e.target.value);
                      if (prod) updateLine(idx, 'productName', prod.name);
                    }}
                    required
                  >
                    <option value="">— wybierz produkt —</option>
                    {filteredProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Ilość"
                    className="w-24 rounded-lg border border-gray-300 px-2 py-2 text-sm"
                    value={line.qty}
                    onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                    required
                  />
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="Cena netto"
                    className="w-28 rounded-lg border border-gray-300 px-2 py-2 text-sm"
                    value={line.price}
                    onChange={(e) => updateLine(idx, 'price', e.target.value)}
                  />
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      className="text-red-500 hover:text-red-700 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLine}
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              + Dodaj pozycję
            </button>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Uwagi</label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {createMut.isError && (
            <p className="text-sm text-red-600">Błąd podczas tworzenia zamówienia.</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createMut.isPending ? 'Zapisywanie…' : 'Utwórz ZD'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── CreatePZ modal ───────────────────────────────────────────────────────────

interface CreatePzModalProps {
  order: SupplierOrder;
  onClose: () => void;
}

function CreatePzModal({ order, onClose }: CreatePzModalProps) {
  const { data: warehousesData } = useWarehouseListQuery(1);
  const createPzMut = useCreatePzFromSupplierOrderMutation();
  const [warehouseId, setWarehouseId] = useState('');
  const [extDoc, setExtDoc] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId) return;
    await createPzMut.mutateAsync({
      id: order.id,
      body: { to_warehouse_id: warehouseId, external_document_number: extDoc },
    });
    onClose();
  }

  const warehouses = warehousesData?.results ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          Przyjmij dostawę — {order.document_number}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Magazyn docelowy <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              required
            >
              <option value="">— wybierz magazyn —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nr dokumentu dostawcy (WZ/list)
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={extDoc}
              onChange={(e) => setExtDoc(e.target.value)}
              placeholder="np. WZ/2026/0123"
            />
          </div>

          <p className="text-xs text-gray-500">
            Zostanie utworzony szkic PZ z {order.items.length} pozycją/pozycjami.
            Możesz go edytować przed zatwierdzeniem.
          </p>

          {createPzMut.isError && (
            <p className="text-sm text-red-600">Błąd podczas tworzenia PZ.</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={createPzMut.isPending || !warehouseId}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              {createPzMut.isPending ? 'Tworzę PZ…' : 'Utwórz PZ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface OrderRowProps {
  order: SupplierOrder;
  canManage: boolean;
}

function OrderRow({ order, canManage }: OrderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPzModal, setShowPzModal] = useState(false);
  const sendMut = useSendSupplierOrderMutation();
  const cancelMut = useCancelSupplierOrderMutation();

  const canSend = order.status === 'draft';
  const canReceive = order.status === 'sent' || order.status === 'partial';
  const canCancel = order.status !== 'cancelled' && order.status !== 'fulfilled';

  return (
    <>
      <tr
        className="border-b hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
      >
        <td className="px-4 py-3 font-mono text-sm text-blue-700">{order.document_number}</td>
        <td className="px-4 py-3 text-sm">{order.supplier_name || <span className="text-gray-400">—</span>}</td>
        <td className="px-4 py-3 text-sm">{fmtDate(order.issue_date)}</td>
        <td className="px-4 py-3 text-sm">{fmtDate(order.expected_delivery_date)}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(order.status)}`}>
            {statusLabel(order.status)}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-500">{order.pz_count > 0 ? `${order.pz_count} PZ` : '—'}</td>
        {canManage && (
          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-2">
              {canSend && (
                <button
                  onClick={() => sendMut.mutate(order.id)}
                  disabled={sendMut.isPending}
                  className="rounded-lg bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Wyślij
                </button>
              )}
              {canReceive && (
                <button
                  onClick={() => setShowPzModal(true)}
                  className="rounded-lg bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                >
                  Przyjmij
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => {
                    if (confirm('Anulować to zamówienie?')) cancelMut.mutate(order.id);
                  }}
                  disabled={cancelMut.isPending}
                  className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Anuluj
                </button>
              )}
            </div>
          </td>
        )}
      </tr>

      {/* Expanded items */}
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={canManage ? 7 : 6} className="px-6 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase">
                  <th className="text-left pb-1">Produkt</th>
                  <th className="text-right pb-1">Zamówiono</th>
                  <th className="text-right pb-1">Odebrano</th>
                  <th className="text-right pb-1">Cena netto</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => {
                  const qty = parseFloat(item.quantity_ordered);
                  const rcv = parseFloat(item.quantity_received);
                  const pct = qty > 0 ? Math.round((rcv / qty) * 100) : 0;
                  return (
                    <tr key={item.id} className="border-t border-gray-100">
                      <td className="py-1">{item.product_name}</td>
                      <td className="text-right py-1">
                        {item.quantity_ordered} {item.product_unit}
                      </td>
                      <td className="text-right py-1">
                        <span className={rcv >= qty ? 'text-green-700' : rcv > 0 ? 'text-amber-700' : ''}>
                          {item.quantity_received} {item.product_unit}
                        </span>
                        {qty > 0 && (
                          <span className="ml-1 text-xs text-gray-400">({pct}%)</span>
                        )}
                      </td>
                      <td className="text-right py-1">
                        {item.unit_price_net ? `${parseFloat(item.unit_price_net).toFixed(4)} zł` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {order.notes && (
              <p className="mt-2 text-xs text-gray-500">Uwagi: {order.notes}</p>
            )}
          </td>
        </tr>
      )}

      {showPzModal && (
        <CreatePzModal order={order} onClose={() => setShowPzModal(false)} />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const enabled = useModuleGuard('purchase_orders');
  const canManage = usePermission('can_manage_purchase_orders');
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useSupplierOrderListQuery(page, {
    status: statusFilter || undefined,
    search: search || undefined,
  });

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-gray-500 text-lg">Moduł Zamówień do Dostawców nie jest aktywny.</p>
        <button
          className="mt-4 text-sm text-blue-600 hover:underline"
          onClick={() => navigate('/settings/modules')}
        >
          Włącz moduł w ustawieniach
        </button>
      </div>
    );
  }

  const orders = data?.results ?? [];
  const totalPages = data ? Math.ceil(data.count / 20) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Zamówienia do dostawców (ZD)</h1>
          <p className="text-sm text-gray-500 mt-1">
            Planuj zakupy, śledź towar w drodze, kontroluj ceny dostaw.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Nowe ZD
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <input
          type="text"
          placeholder="Szukaj (nr, dostawca)…"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-64"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">Wszystkie statusy</option>
          <option value="draft">Szkic</option>
          <option value="sent">Wysłane</option>
          <option value="partial">Częściowo zrealizowane</option>
          <option value="fulfilled">Zrealizowane</option>
          <option value="cancelled">Anulowane</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-20 text-center text-gray-400">Ładowanie…</div>
      ) : orders.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          <p className="text-lg">Brak zamówień</p>
          {canManage && (
            <p className="text-sm mt-1">
              Kliknij <strong>+ Nowe ZD</strong> żeby zamówić towar u dostawcy.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Nr ZD</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Dostawca</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Data</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Dostawa</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">PZ</th>
                {canManage && (
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Akcje</th>
                )}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow key={order.id} order={order} canManage={canManage} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            ← Poprzednia
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-600">
            Strona {page} z {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Następna →
          </button>
        </div>
      )}

      {/* Create modal */}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

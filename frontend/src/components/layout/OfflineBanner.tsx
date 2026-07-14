import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOfflineSync } from '@/context/OfflineSyncContext';
import type { PendingOperation } from '@/lib/offline-db';
import type { OrderCreate, StandaloneWzCreate } from '@/types';
import type { Customer } from '@/types';
import type { Product } from '@/types';

// ---------------------------------------------------------------------------
// Helpers to read names from React Query cache (already warm from prefetch)
// ---------------------------------------------------------------------------

function useCustomerName(customerId: string): string {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueriesData<{ results: Customer[] }>({ queryKey: ['customers'] });
  for (const [, data] of cache) {
    const found = data?.results?.find((c) => c.id === customerId);
    if (found) return found.name;
  }
  return customerId;
}

function useProductNames(): Map<string, string> {
  const queryClient = useQueryClient();
  const map = new Map<string, string>();
  const cache = queryClient.getQueriesData<{ pages?: { results: Product[] }[]; results?: Product[] }>({
    queryKey: ['products'],
  });
  for (const [, data] of cache) {
    const pages = data?.pages ?? (data?.results ? [{ results: data.results }] : []);
    for (const page of pages) {
      for (const p of page.results ?? []) {
        map.set(p.id, p.name);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Single queued operation row
// ---------------------------------------------------------------------------

function OrderRow({ op, productNames }: { op: PendingOperation; productNames: Map<string, string> }) {
  const payload = op.payload as OrderCreate;
  const customerName = useCustomerName(payload.customer_id);

  return (
    <div className="rounded border border-white/20 bg-white/10 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">Zamówienie — {customerName}</span>
        <span className="text-white/70">{payload.delivery_date}</span>
      </div>
      {payload.items && payload.items.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-white/80">
          {payload.items.map((item, i) => (
            <li key={i} className="flex justify-between">
              <span>{productNames.get(item.product_id) ?? item.product_id}</span>
              <span>× {item.quantity}</span>
            </li>
          ))}
        </ul>
      )}
      {op.error_message && (
        <p className="mt-1 text-red-200">⚠ {op.error_message}</p>
      )}
    </div>
  );
}

function WzRow({ op, productNames }: { op: PendingOperation; productNames: Map<string, string> }) {
  const payload = op.payload as StandaloneWzCreate;
  const customerName = useCustomerName(payload.to_customer_id ?? '');

  return (
    <div className="rounded border border-white/20 bg-white/10 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">WZ — {customerName}</span>
        <span className="text-white/70">{payload.issue_date}</span>
      </div>
      {payload.items && payload.items.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-white/80">
          {payload.items.map((item, i) => (
            <li key={i} className="flex justify-between">
              <span>{productNames.get(item.product_id) ?? item.product_id}</span>
              <span>× {item.quantity_planned}</span>
            </li>
          ))}
        </ul>
      )}
      {op.error_message && (
        <p className="mt-1 text-red-200">⚠ {op.error_message}</p>
      )}
    </div>
  );
}

function QueueDetails({ ops }: { ops: PendingOperation[] }) {
  const productNames = useProductNames();
  return (
    <div className="mt-2 space-y-2">
      {ops.map((op) =>
        op.type === 'create_order' ? (
          <OrderRow key={op.id} op={op} productNames={productNames} />
        ) : (
          <WzRow key={op.id} op={op} productNames={productNames} />
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export function OfflineBanner() {
  const { isOnline, pendingCount, pendingOperations, isSyncing, triggerSync } = useOfflineSync();
  const [expanded, setExpanded] = useState(false);

  if (isOnline && pendingCount === 0) return null;

  const plural = pendingCount === 1 ? 'operacja' : pendingCount < 5 ? 'operacje' : 'operacji';

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 shadow-md print:hidden">
        <div className="flex items-center justify-between bg-amber-500 px-4 py-2 text-sm font-medium text-white">
          <span>⚠ Brak połączenia</span>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="rounded-full bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
              >
                {pendingCount} {plural} w kolejce {expanded ? '▲' : '▼'}
              </button>
            )}
          </div>
        </div>
        {expanded && pendingOperations.length > 0 && (
          <div className="bg-amber-600 px-4 py-3">
            <QueueDetails ops={pendingOperations} />
          </div>
        )}
      </div>
    );
  }

  // Online but pending items remain
  return (
    <div className="fixed top-0 left-0 right-0 z-50 shadow-md print:hidden">
      <div className="flex items-center justify-between bg-blue-600 px-4 py-2 text-sm font-medium text-white">
        {isSyncing ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin">↻</span>
            Synchronizacja… ({pendingCount} pozostało)
          </span>
        ) : (
          <span>
            {pendingCount} {plural} oczekuje na wysłanie
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
          >
            Pokaż {expanded ? '▲' : '▼'}
          </button>
          {!isSyncing && (
            <button
              onClick={triggerSync}
              className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30"
            >
              Wyślij teraz
            </button>
          )}
        </div>
      </div>
      {expanded && pendingOperations.length > 0 && (
        <div className="bg-blue-700 px-4 py-3">
          <QueueDetails ops={pendingOperations} />
        </div>
      )}
    </div>
  );
}

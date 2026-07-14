import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  getPendingOperations,
  markOperationError,
  markOperationSynced,
  queueOperation,
  resetErrorOperations,
  type PendingOperation,
  type PendingOperationType,
} from '@/lib/offline-db';
import { orderService } from '@/services/order.service';
import { deliveryService } from '@/services/delivery.service';
import type { OrderCreate, StandaloneWzCreate } from '@/types';
import { orderKeys } from '@/query/keys';
import { deliveryKeys } from '@/query/keys';

interface OfflineSyncContextValue {
  isOnline: boolean;
  pendingCount: number;
  pendingOperations: PendingOperation[];
  isSyncing: boolean;
  /** Queue an operation for later sync when offline. Returns the local queue id. */
  enqueue: (
    type: PendingOperationType,
    payload: PendingOperation['payload'],
    company_id: string,
  ) => Promise<number>;
  /** Manually trigger sync (e.g. after user taps "retry"). */
  triggerSync: () => void;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | null>(null);

async function executePendingOperation(op: PendingOperation): Promise<void> {
  switch (op.type) {
    case 'create_order': {
      const order = await orderService.createOrder(op.payload as OrderCreate);
      await orderService.confirmOrder(order.id);
      break;
    }
    case 'create_standalone_wz': {
      await deliveryService.createStandaloneWz(op.payload as StandaloneWzCreate);
      break;
    }
    default:
      throw new Error(`Unknown operation type: ${String((op as PendingOperation).type)}`);
  }
}

export function OfflineSyncProvider({ children, company_id }: { children: ReactNode; company_id: string }) {
  const isOnline = useOnlineStatus();
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingOperations, setPendingOperations] = useState<PendingOperation[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncLockRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    if (!company_id) return;
    const ops = await getPendingOperations(company_id);
    setPendingOperations(ops);
    setPendingCount(ops.length);
  }, [company_id]);

  // Refresh count on mount and whenever company changes
  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  const runSync = useCallback(async () => {
    if (!company_id || syncLockRef.current) return;
    syncLockRef.current = true;
    setIsSyncing(true);

    try {
      // Reset any previous errors so they get retried
      await resetErrorOperations(company_id);
      const ops = await getPendingOperations(company_id);
      if (ops.length === 0) return;

      for (const op of ops) {
        if (!op.id) continue;
        try {
          await executePendingOperation(op);
          await markOperationSynced(op.id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Błąd synchronizacji';
          await markOperationError(op.id, msg);
        }
      }

      // Invalidate all affected queries so lists update
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    } finally {
      syncLockRef.current = false;
      setIsSyncing(false);
      await refreshPendingCount();
    }
  }, [company_id, queryClient, refreshPendingCount]);

  // Trigger sync when coming back online
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const justCameOnline = !wasOnlineRef.current && isOnline;
    wasOnlineRef.current = isOnline;
    if (justCameOnline) {
      void runSync();
    }
  }, [isOnline, runSync]);

  const enqueue = useCallback(
    async (
      type: PendingOperationType,
      payload: PendingOperation['payload'],
      cid: string,
    ): Promise<number> => {
      const id = await queueOperation(type, payload, cid);
      await refreshPendingCount();
      return id;
    },
    [refreshPendingCount],
  );

  const triggerSync = useCallback(() => {
    if (isOnline) void runSync();
  }, [isOnline, runSync]);

  return (
    <OfflineSyncContext.Provider
      value={{ isOnline, pendingCount, pendingOperations, isSyncing, enqueue, triggerSync }}
    >
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error('useOfflineSync must be used inside OfflineSyncProvider');
  return ctx;
}

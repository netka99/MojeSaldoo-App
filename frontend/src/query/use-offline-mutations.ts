/**
 * Offline-aware mutation hooks.
 *
 * When the device is offline, these hooks queue the operation to IndexedDB
 * (via Dexie) and throw `OfflineQueuedError` so the calling page knows to
 * show a "queued" message instead of an error message.
 *
 * When back online, OfflineSyncContext drains the queue automatically.
 */
import { useAuth } from '@/context/AuthContext';
import { useOfflineSync } from '@/context/OfflineSyncContext';
import type { OrderCreate, StandaloneWzCreate } from '@/types';

/** Thrown when an operation was queued for offline sync instead of sent immediately. */
export class OfflineQueuedError extends Error {
  constructor(message = 'Zapisano lokalnie. Zostanie wysłane po powrocie online.') {
    super(message);
    this.name = 'OfflineQueuedError';
  }
}

/**
 * Returns a function that creates an order.
 * If offline → queues it locally and throws OfflineQueuedError.
 * If online → calls the provided `onlineFn` (the normal API call).
 */
export function useOfflineOrderCreate() {
  const { user } = useAuth();
  const { isOnline, enqueue } = useOfflineSync();

  return async function createOrderWithOffline(
    body: OrderCreate,
    onlineFn: (body: OrderCreate) => Promise<unknown>,
  ): Promise<void> {
    if (!isOnline) {
      const company_id = user?.current_company ?? '';
      await enqueue('create_order', body, company_id);
      throw new OfflineQueuedError();
    }
    await onlineFn(body);
  };
}

/**
 * Returns a function that creates a standalone WZ delivery document.
 * If offline → queues it locally and throws OfflineQueuedError.
 * If online → calls the provided `onlineFn` (the normal API call).
 */
export function useOfflineStandaloneWzCreate() {
  const { user } = useAuth();
  const { isOnline, enqueue } = useOfflineSync();

  return async function createWzWithOffline(
    body: StandaloneWzCreate,
    onlineFn: (body: StandaloneWzCreate) => Promise<unknown>,
  ): Promise<void> {
    if (!isOnline) {
      const company_id = user?.current_company ?? '';
      await enqueue('create_standalone_wz', body, company_id);
      throw new OfflineQueuedError();
    }
    await onlineFn(body);
  };
}

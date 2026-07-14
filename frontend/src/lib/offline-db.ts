import Dexie, { type Table } from 'dexie';
import type { OrderCreate, StandaloneWzCreate } from '@/types';

export type PendingOperationType = 'create_order' | 'create_standalone_wz';
export type PendingOperationStatus = 'pending' | 'syncing' | 'error';

export interface PendingOperation {
  id?: number;
  type: PendingOperationType;
  payload: OrderCreate | StandaloneWzCreate;
  company_id: string;
  created_at: string;
  status: PendingOperationStatus;
  error_message?: string;
  retry_count: number;
}

class OfflineDb extends Dexie {
  pending_operations!: Table<PendingOperation>;

  constructor() {
    super('mojesaldoo_offline');
    this.version(1).stores({
      pending_operations: '++id, type, status, company_id, created_at',
    });
  }
}

export const offlineDb = new OfflineDb();

export async function queueOperation(
  type: PendingOperationType,
  payload: PendingOperation['payload'],
  company_id: string,
): Promise<number> {
  return offlineDb.pending_operations.add({
    type,
    payload,
    company_id,
    created_at: new Date().toISOString(),
    status: 'pending',
    retry_count: 0,
  });
}

export async function getPendingCount(company_id?: string): Promise<number> {
  if (company_id) {
    return offlineDb.pending_operations
      .where({ company_id, status: 'pending' })
      .count();
  }
  return offlineDb.pending_operations.where('status').equals('pending').count();
}

export async function getPendingOperations(company_id: string): Promise<PendingOperation[]> {
  return offlineDb.pending_operations
    .where({ company_id, status: 'pending' })
    .sortBy('created_at');
}

export async function markOperationSynced(id: number): Promise<void> {
  await offlineDb.pending_operations.delete(id);
}

export async function markOperationError(id: number, error_message: string): Promise<void> {
  await offlineDb.pending_operations.update(id, {
    status: 'error',
    error_message,
    retry_count: (await offlineDb.pending_operations.get(id))?.retry_count ?? 0 + 1,
  });
}

export async function resetErrorOperations(company_id: string): Promise<void> {
  await offlineDb.pending_operations
    .where({ company_id, status: 'error' })
    .modify({ status: 'pending', retry_count: 0, error_message: undefined });
}

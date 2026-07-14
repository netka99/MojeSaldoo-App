import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  offlineDb,
  queueOperation,
  getPendingCount,
  getPendingOperations,
  markOperationSynced,
  markOperationError,
  resetErrorOperations,
} from './offline-db';
import type { OrderCreate } from '@/types';

const COMPANY_ID = 'company-abc';

const sampleOrder: OrderCreate = {
  customer_id: 'cust-1',
  delivery_date: '2026-07-14',
  items: [{ product_id: 'prod-1', quantity: 3 }],
};

beforeEach(async () => {
  await offlineDb.pending_operations.clear();
});

describe('queueOperation', () => {
  it('adds a pending operation and returns its id', async () => {
    const id = await queueOperation('create_order', sampleOrder, COMPANY_ID);
    expect(typeof id).toBe('number');
    const op = await offlineDb.pending_operations.get(id);
    expect(op).toBeDefined();
    expect(op?.type).toBe('create_order');
    expect(op?.status).toBe('pending');
    expect(op?.company_id).toBe(COMPANY_ID);
    expect(op?.retry_count).toBe(0);
  });
});

describe('getPendingCount', () => {
  it('counts only pending operations for the company', async () => {
    await queueOperation('create_order', sampleOrder, COMPANY_ID);
    await queueOperation('create_order', sampleOrder, COMPANY_ID);
    await queueOperation('create_order', sampleOrder, 'other-company');

    const count = await getPendingCount(COMPANY_ID);
    expect(count).toBe(2);
  });

  it('returns 0 when no pending operations', async () => {
    const count = await getPendingCount(COMPANY_ID);
    expect(count).toBe(0);
  });
});

describe('getPendingOperations', () => {
  it('returns pending operations sorted by created_at', async () => {
    await queueOperation('create_order', sampleOrder, COMPANY_ID);
    await queueOperation('create_standalone_wz', { items: [] }, COMPANY_ID);

    const ops = await getPendingOperations(COMPANY_ID);
    expect(ops).toHaveLength(2);
    expect(ops[0]?.type).toBe('create_order');
    expect(ops[1]?.type).toBe('create_standalone_wz');
  });
});

describe('markOperationSynced', () => {
  it('deletes the operation from the queue', async () => {
    const id = await queueOperation('create_order', sampleOrder, COMPANY_ID);
    await markOperationSynced(id);
    const op = await offlineDb.pending_operations.get(id);
    expect(op).toBeUndefined();
  });
});

describe('markOperationError', () => {
  it('sets status to error with message', async () => {
    const id = await queueOperation('create_order', sampleOrder, COMPANY_ID);
    await markOperationError(id, 'Network timeout');
    const op = await offlineDb.pending_operations.get(id);
    expect(op?.status).toBe('error');
    expect(op?.error_message).toBe('Network timeout');
  });
});

describe('resetErrorOperations', () => {
  it('resets error operations back to pending', async () => {
    const id = await queueOperation('create_order', sampleOrder, COMPANY_ID);
    await markOperationError(id, 'Some error');

    await resetErrorOperations(COMPANY_ID);

    const op = await offlineDb.pending_operations.get(id);
    expect(op?.status).toBe('pending');
    expect(op?.error_message).toBeUndefined();
  });
});

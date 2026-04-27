import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
}));

import { invoiceService } from './invoice.service';

describe('invoiceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchList calls GET /invoices/ with pagination and django-filter params', async () => {
    const page = { count: 0, next: null, previous: null, results: [] };
    mocks.get.mockResolvedValue(page);

    const result = await invoiceService.fetchList({
      page: 2,
      status: 'draft',
      ksef_status: 'not_sent',
      customer: 'cust-uuid',
      issue_date_after: '2026-04-01',
      issue_date_before: '2026-04-30',
    });

    expect(result).toBe(page);
    expect(mocks.get).toHaveBeenCalledWith('/invoices/', {
      params: {
        page: 2,
        status: 'draft',
        ksef_status: 'not_sent',
        customer: 'cust-uuid',
        issue_date_after: '2026-04-01',
        issue_date_before: '2026-04-30',
      },
    });
  });

  it('fetchById calls GET /invoices/:id/', async () => {
    mocks.get.mockResolvedValue({ id: 'i1' });
    await invoiceService.fetchById('i1');
    expect(mocks.get).toHaveBeenCalledWith('/invoices/i1/');
  });

  it('create posts to /invoices/', async () => {
    const body = {
      order_id: 'o1',
      issue_date: '2026-05-01',
      sale_date: '2026-05-01',
      due_date: '2026-05-14',
    };
    mocks.post.mockResolvedValue({ id: 'new' });
    await invoiceService.create(body);
    expect(mocks.post).toHaveBeenCalledWith('/invoices/', body);
  });

  it('patch patches /invoices/:id/', async () => {
    mocks.patch.mockResolvedValue({ id: 'i1' });
    await invoiceService.patch('i1', { notes: 'x' });
    expect(mocks.patch).toHaveBeenCalledWith('/invoices/i1/', { notes: 'x' });
  });

  it('delete sends DELETE /invoices/:id/', async () => {
    mocks.delete.mockResolvedValue({});
    await invoiceService.delete('i1');
    expect(mocks.delete).toHaveBeenCalledWith('/invoices/i1/');
  });

  it('generateFromOrder posts to generate-from-order/:orderId/', async () => {
    mocks.post.mockResolvedValue({ id: 'i-new' });
    await invoiceService.generateFromOrder('o-99', { delivery_document_id: 'd1' });
    expect(mocks.post).toHaveBeenCalledWith('/invoices/generate-from-order/o-99/', {
      delivery_document_id: 'd1',
    });
  });

  it('generateFromOrder sends dates and payment_method when provided', async () => {
    mocks.post.mockResolvedValue({ id: 'i-new' });
    const body = {
      issue_date: '2026-04-15',
      sale_date: '2026-04-10',
      due_date: '2026-05-01',
      payment_method: 'cash' as const,
    };
    await invoiceService.generateFromOrder('o-99', body);
    expect(mocks.post).toHaveBeenCalledWith('/invoices/generate-from-order/o-99/', body);
  });

  it('generateFromOrder posts empty object by default', async () => {
    mocks.post.mockResolvedValue({ id: 'i-new' });
    await invoiceService.generateFromOrder('o-99');
    expect(mocks.post).toHaveBeenCalledWith('/invoices/generate-from-order/o-99/', {});
  });

  it('issue posts to /invoices/:id/issue/', async () => {
    mocks.post.mockResolvedValue({ id: 'i1' });
    await invoiceService.issue('i1');
    expect(mocks.post).toHaveBeenCalledWith('/invoices/i1/issue/', {});
  });

  it('markPaid posts to /invoices/:id/mark-paid/', async () => {
    mocks.post.mockResolvedValue({ id: 'i1' });
    await invoiceService.markPaid('i1');
    expect(mocks.post).toHaveBeenCalledWith('/invoices/i1/mark-paid/', {});
  });

  it('fetchPreview GETs /invoices/:id/preview/', async () => {
    mocks.get.mockResolvedValue({ meta: {}, lines: [] });
    await invoiceService.fetchPreview('i1');
    expect(mocks.get).toHaveBeenCalledWith('/invoices/i1/preview/');
  });
});

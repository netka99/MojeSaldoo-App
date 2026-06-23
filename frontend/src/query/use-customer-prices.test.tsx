/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createTestQueryClient } from '@/query/query-client';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import { customerPriceKeys } from './keys';
import {
  useCustomerPricesQuery,
  useCreateCustomerPriceMutation,
  useUpdateCustomerPriceMutation,
  useDeleteCustomerPriceMutation,
} from './use-customers';

const customerPriceServiceMock = vi.hoisted(() => ({
  fetchByCustomer: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/services/customer.service', () => ({
  customerService: {
    fetchList: vi.fn(),
    fetchById: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    partialUpdateItem: vi.fn(),
  },
  customerPriceService: customerPriceServiceMock,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { current_company: 'co-001' } }),
}));

const CUSTOMER_ID = 'cust-001';
const PRODUCT_ID = 'prod-001';

const makePrice = (over = {}) => ({
  id: 'cpp-001',
  customer: CUSTOMER_ID,
  product: PRODUCT_ID,
  product_name: 'Chleb',
  product_unit: 'szt.',
  product_price_net: '3.50',
  price_net: '2.80',
  note: 'stały klient',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('useCustomerPricesQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches prices for given customer and uses customerPriceKeys', async () => {
    const prices = [makePrice()];
    customerPriceServiceMock.fetchByCustomer.mockResolvedValue(prices);
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () => useCustomerPricesQuery(CUSTOMER_ID),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(prices);
    expect(customerPriceServiceMock.fetchByCustomer).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(queryClient.getQueryData(customerPriceKeys.byCustomer(CUSTOMER_ID))).toEqual(prices);
  });

  it('does not fetch when customerId is undefined', () => {
    customerPriceServiceMock.fetchByCustomer.mockResolvedValue([]);
    const queryClient = createTestQueryClient();

    renderHook(
      () => useCustomerPricesQuery(undefined),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> },
    );

    expect(customerPriceServiceMock.fetchByCustomer).not.toHaveBeenCalled();
  });
});

describe('useCreateCustomerPriceMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls create and invalidates customer price cache', async () => {
    const created = makePrice();
    customerPriceServiceMock.create.mockResolvedValue(created);
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useCreateCustomerPriceMutation(CUSTOMER_ID),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> },
    );

    await act(async () => {
      await result.current.mutateAsync({
        customer: CUSTOMER_ID,
        product: PRODUCT_ID,
        price_net: '2.80',
        note: 'test',
      });
    });

    expect(customerPriceServiceMock.create).toHaveBeenCalledWith({
      customer: CUSTOMER_ID,
      product: PRODUCT_ID,
      price_net: '2.80',
      note: 'test',
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: customerPriceKeys.byCustomer(CUSTOMER_ID) }),
    );
  });
});

describe('useUpdateCustomerPriceMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls update with id, price_net, note and invalidates', async () => {
    const updated = makePrice({ price_net: '1.99', note: 'rabat' });
    customerPriceServiceMock.update.mockResolvedValue(updated);
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useUpdateCustomerPriceMutation(CUSTOMER_ID),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> },
    );

    await act(async () => {
      await result.current.mutateAsync({ id: 'cpp-001', price_net: '1.99', note: 'rabat' });
    });

    expect(customerPriceServiceMock.update).toHaveBeenCalledWith('cpp-001', { price_net: '1.99', note: 'rabat' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: customerPriceKeys.byCustomer(CUSTOMER_ID) }),
    );
  });
});

describe('useDeleteCustomerPriceMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls delete by id and invalidates', async () => {
    customerPriceServiceMock.delete.mockResolvedValue({});
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useDeleteCustomerPriceMutation(CUSTOMER_ID),
      { wrapper: ({ children }) => <TestQueryProvider client={queryClient}>{children}</TestQueryProvider> },
    );

    await act(async () => {
      await result.current.mutateAsync('cpp-001');
    });

    expect(customerPriceServiceMock.delete).toHaveBeenCalledWith('cpp-001');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: customerPriceKeys.byCustomer(CUSTOMER_ID) }),
    );
  });
});

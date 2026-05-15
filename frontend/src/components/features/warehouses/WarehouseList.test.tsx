/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WarehouseList } from './WarehouseList';
import { TestQueryProvider } from '@/test/TestQueryProvider';
import type { Warehouse } from '@/types';

const mocks = vi.hoisted(() => ({
  fetchList: vi.fn(),
}));

vi.mock('@/services/warehouse.service', () => ({
  warehouseService: {
    fetchList: mocks.fetchList,
  },
}));

function warehouse(over: Partial<Warehouse> = {}): Warehouse {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    user: 1,
    code: 'MG',
    name: 'Main',
    warehouse_type: 'main',
    address: '',
    is_active: true,
    allow_negative_stock: false,
    fifo_enabled: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

function renderList(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <TestQueryProvider>{ui}</TestQueryProvider>
    </MemoryRouter>,
  );
}

describe('WarehouseList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchList.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [warehouse()],
    });
  });

  it('loads warehouses and shows heading', async () => {
    renderList(<WarehouseList />);

    expect(screen.getByRole('heading', { name: /magazyny/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.fetchList).toHaveBeenCalledWith({
        page: 1,
        ordering: 'code',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('1 magazyn')).toBeInTheDocument();
    });

    expect(screen.getByText('MG')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
  });

  it('calls onRowClick when a data row is activated', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    renderList(<WarehouseList onRowClick={onRowClick} />);

    await waitFor(() => {
      expect(screen.getByText('MG')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await user.click(rows[1]!);

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ code: 'MG' }));
  });
});

/**
 * Prefetches data needed to work offline.
 * Called once on app load while online — populates the React Query cache
 * so that OrderCreatePage and DeliveryCreatePage work without network.
 *
 * Prefetches:
 * - All active customers (for the customer picker)
 * - First page of active products (for the product picker)
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customerService } from '@/services/customer.service';
import { productService } from '@/services/product.service';
import { customerKeys } from '@/query/keys';
import { useOnlineStatus } from './useOnlineStatus';

export function usePrefetchOfflineData(companyId: string) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const didPrefetch = useRef(false);

  useEffect(() => {
    if (!companyId || !isOnline || didPrefetch.current) return;
    didPrefetch.current = true;

    // Customers page 1, no search — matches useCustomerListQuery(1, '') used in OrderCreatePage and DeliveryCreatePage
    void queryClient.prefetchQuery({
      queryKey: customerKeys.list({ page: 1, search: '', companyId }),
      queryFn: () =>
        customerService.fetchList({ page: 1, ordering: '-created_at' }),
      staleTime: 1000 * 60 * 5,
    });

    // Products first page, no search — matches the useInfiniteQuery key in OrderCreatePage and DeliveryCreatePage
    void queryClient.prefetchInfiniteQuery({
      queryKey: ['products', 'order-create', companyId, ''] as const,
      queryFn: () =>
        productService.fetchList({ page: 1, page_size: 30, is_active: true, ordering: 'name' }),
      initialPageParam: 1,
      pages: 1,
    });
  }, [companyId, isOnline, queryClient]);
}

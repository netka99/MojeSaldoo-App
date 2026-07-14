import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,       // data is fresh for 5 min
        gcTime: 1000 * 60 * 60 * 24,    // keep cache for 24h — available offline
        retry: 1,
        refetchOnWindowFocus: false,
        networkMode: 'offlineFirst',     // serve cached data immediately, refetch when online
      },
      mutations: {
        networkMode: 'offlineFirst',
      },
    },
  });
}

/** Fast-fail client for unit tests (no retries, stable cache during assertions). */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

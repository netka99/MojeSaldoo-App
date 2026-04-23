import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/query/query-client';

type Props = {
  children: ReactNode;
  client?: QueryClient;
};

export function TestQueryProvider({ children, client }: Props) {
  const queryClient = client ?? createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

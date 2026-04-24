export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (params: { page: number; search: string }) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
};

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params: { page: number; sku: string }) => [...productKeys.lists(), params] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

export const warehouseKeys = {
  all: ['warehouses'] as const,
  lists: () => [...warehouseKeys.all, 'list'] as const,
  list: (params: { page: number }) => [...warehouseKeys.lists(), params] as const,
  details: () => [...warehouseKeys.all, 'detail'] as const,
  detail: (id: string) => [...warehouseKeys.details(), id] as const,
};

export const companyKeys = {
  all: ['companies'] as const,
  me: () => [...companyKeys.all, 'me'] as const,
  modules: (companyId: string) => [...companyKeys.all, 'modules', companyId] as const,
};

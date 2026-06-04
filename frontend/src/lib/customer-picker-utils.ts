/** Resolve selected customer id from explicit pick or a single exact name match. */
export function resolveCustomerIdFromSearch(
  customerId: string,
  search: string,
  customers: Array<{ id: string; name: string }>,
): string | null {
  if (customerId) return customerId;
  const q = search.trim().toLowerCase();
  if (!q) return null;
  const exact = customers.filter((c) => (c.name || '').trim().toLowerCase() === q);
  if (exact.length === 1) return exact[0].id;
  return null;
}

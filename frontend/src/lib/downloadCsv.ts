import { API_BASE_URL, authStorage } from '@/services/api';

/**
 * Fetches a CSV export from the given report endpoint and triggers a browser download.
 *
 * @param path     Relative API path, e.g. '/reports/payment-aging/'
 * @param params   Additional query params (date filters etc.)
 * @param filename Suggested download filename, e.g. 'raport-naleznosci.csv'
 */
export async function downloadCsv(
  path: string,
  params: Record<string, string> = {},
  filename: string,
): Promise<void> {
  const qs = new URLSearchParams({ ...params, export: 'csv' }).toString();
  const url = `${API_BASE_URL}${path}?${qs}`;

  const token = authStorage.getAccessToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    throw new Error(`CSV export failed: ${res.status} ${res.statusText}`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv } from './downloadCsv';

vi.mock('@/services/api', () => ({
  API_BASE_URL: 'http://api.test',
  authStorage: {
    getAccessToken: vi.fn(() => 'test-token'),
  },
}));

describe('downloadCsv', () => {
  let objectUrls: string[] = [];
  let anchors: HTMLAnchorElement[] = [];

  beforeEach(() => {
    objectUrls = [];
    anchors = [];

    URL.createObjectURL = vi.fn((_blob) => {
      const url = `blob:test-${objectUrls.length}`;
      objectUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, opts) => {
      const el = origCreate(tag as string, opts as ElementCreationOptions);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {});
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches with Authorization header and ?export=csv param', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['col1,col2\n'], { type: 'text/csv' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadCsv('/reports/inventory/', {}, 'raport.csv');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.test/reports/inventory/?export=csv',
      { headers: { Authorization: 'Bearer test-token' } },
    );
  });

  it('passes extra query params alongside export=csv', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([''], { type: 'text/csv' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadCsv('/reports/profit-loss/', { date_from: '2026-01-01', date_to: '2026-06-01' }, 'pl.csv');

    const calledUrl: string = mockFetch.mock.calls[0][0];
    const params = new URLSearchParams(calledUrl.split('?')[1]);
    expect(params.get('export')).toBe('csv');
    expect(params.get('date_from')).toBe('2026-01-01');
    expect(params.get('date_to')).toBe('2026-06-01');
  });

  it('triggers anchor download with the given filename', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['data'], { type: 'text/csv' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadCsv('/reports/payment-aging/', {}, 'raport-naleznosci.csv');

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('raport-naleznosci.csv');
    expect(anchors[0].click).toHaveBeenCalled();
  });

  it('revokes the object URL after download', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([''], { type: 'text/csv' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadCsv('/reports/inventory/', {}, 'x.csv');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(objectUrls[0]);
  });

  it('throws when the response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(downloadCsv('/reports/inventory/', {}, 'x.csv')).rejects.toThrow(
      'CSV export failed: 403 Forbidden',
    );
  });

  it('omits Authorization header when no token', async () => {
    const { authStorage } = await import('@/services/api');
    vi.mocked(authStorage.getAccessToken).mockReturnValueOnce(null);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([''], { type: 'text/csv' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadCsv('/reports/inventory/', {}, 'x.csv');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      { headers: {} },
    );
  });
});

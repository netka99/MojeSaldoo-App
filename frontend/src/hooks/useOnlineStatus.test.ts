// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

// Mock @capacitor/network to simulate the native module being unavailable on web
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn().mockRejectedValue(new Error('not available in test env')),
    addListener: vi.fn().mockRejectedValue(new Error('not available in test env')),
  },
}));

describe('useOnlineStatus (browser fallback)', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    }
  });

  it('returns true when navigator.onLine is true', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('returns false when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('updates to false when offline event fires', async () => {
    const { result } = renderHook(() => useOnlineStatus());

    // Wait for the async effect (Capacitor getStatus rejects → catch → browser fallback registers)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe(false);
  });

  it('updates to true when online event fires', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() => useOnlineStatus());

    // Wait for async effect to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe(true);
  });
});

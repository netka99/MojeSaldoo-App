/**
 * @vitest-environment jsdom
 *
 * Tests for useWebPushSubscription hook.
 *
 * The hook is intentionally a side-effect-only hook (returns void).
 * We verify:
 *   1. Does nothing when browser doesn't support Push API
 *   2. Does nothing when notification permission is denied
 *   3. Registers SW, fetches key, subscribes, and POSTs to backend on success
 *   4. Uses existing subscription instead of creating a new one
 */

import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useWebPushSubscription } from './useWebPushSubscription';
import { api } from '@/services/api';

vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockSubscriptionJson = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
  keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
};

const mockSubscription = {
  toJSON: () => mockSubscriptionJson,
};

function makeMockRegistration(subscription: typeof mockSubscription | null = null) {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn().mockResolvedValue(mockSubscription),
    },
  };
}

describe('useWebPushSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub Notification globally (jsdom doesn't include it)
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('granted'),
      permission: 'default',
    });
    // Stub PushManager to signal support
    vi.stubGlobal('PushManager', {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when PushManager is not supported', async () => {
    vi.stubGlobal('PushManager', undefined);

    const { unmount } = renderHook(() => useWebPushSubscription());
    await new Promise((r) => setTimeout(r, 50));
    unmount();

    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does nothing when notification permission is denied', async () => {
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('denied'),
      permission: 'denied',
    });

    const mockReg = makeMockRegistration();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(mockReg),
        ready: Promise.resolve(mockReg),
      },
      configurable: true,
    });

    const { unmount } = renderHook(() => useWebPushSubscription());
    await new Promise((r) => setTimeout(r, 50));
    unmount();

    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('subscribes and registers with backend when permission is granted', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { public_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    vi.mocked(api.post).mockResolvedValue({ data: { registered: true, created: true } });

    const mockReg = makeMockRegistration(null);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(mockReg),
        ready: Promise.resolve(mockReg),
      },
      configurable: true,
    });

    const { unmount } = renderHook(() => useWebPushSubscription());
    await new Promise((r) => setTimeout(r, 100));
    unmount();

    expect(api.get).toHaveBeenCalledWith('/auth/push-public-key/');
    expect(api.post).toHaveBeenCalledWith('/auth/push-subscription/', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
      p256dh: 'test-p256dh',
      auth: 'test-auth',
    });
  });

  it('uses existing subscription instead of creating a new one', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { public_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    vi.mocked(api.post).mockResolvedValue({ data: { registered: true, created: false } });

    const mockReg = makeMockRegistration(mockSubscription);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(mockReg),
        ready: Promise.resolve(mockReg),
      },
      configurable: true,
    });

    const { unmount } = renderHook(() => useWebPushSubscription());
    await new Promise((r) => setTimeout(r, 100));
    unmount();

    expect(mockReg.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/auth/push-subscription/', expect.any(Object));
  });
});

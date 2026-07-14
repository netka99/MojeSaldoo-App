import { useState, useEffect } from 'react';

async function addCapacitorNetworkListener(
  onChange: (connected: boolean) => void,
): Promise<(() => void) | null> {
  try {
    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    onChange(status.connected);
    const handle = await Network.addListener('networkStatusChange', (s) => onChange(s.connected));
    return () => handle.remove();
  } catch {
    return null;
  }
}

/**
 * Returns true when the device has network connectivity.
 * Uses @capacitor/network on mobile (more reliable than navigator.onLine —
 * detects WiFi with no internet, airplane mode, etc.), falls back to
 * browser `online`/`offline` events on web.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    let removeCapacitor: (() => void) | null = null;

    addCapacitorNetworkListener(setIsOnline).then((remove) => {
      if (remove) {
        // Capacitor is available — native network detection active
        removeCapacitor = remove;
      } else {
        // Browser fallback
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        removeCapacitor = () => {
          window.removeEventListener('online', onOnline);
          window.removeEventListener('offline', onOffline);
        };
      }
    });

    return () => removeCapacitor?.();
  }, []);

  return isOnline;
}

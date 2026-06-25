/**
 * usePushNotifications — registers device for Firebase Cloud Messaging via Capacitor.
 *
 * On web: no-op (Capacitor Push Notifications only works in native Android/iOS builds).
 * On Android/iOS: requests permission, retrieves the FCM token, and registers it
 * with our backend at POST /api/auth/fcm-token/.
 *
 * Call this once at app startup from App.tsx inside an auth-guarded route.
 *
 * Installation: npm install @capacitor/push-notifications && npx cap sync android
 */

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from '@/services/api';

async function registerPushToken(): Promise<void> {
  // Only available in native builds
  if (!Capacitor.isNativePlatform()) return;

  let PushNotifications: (typeof import('@capacitor/push-notifications'))['PushNotifications'];
  try {
    ({ PushNotifications } = await import('@capacitor/push-notifications'));
  } catch {
    // Package not installed — silently skip (dev environment without native build)
    return;
  }

  // Request permission
  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') return;

  // Register with FCM
  await PushNotifications.register();

  // Handle the token once received
  PushNotifications.addListener('registration', async (token) => {
    try {
      await api.post('/auth/fcm-token/', {
        token: token.value,
        device_name: `${Capacitor.getPlatform()} device`,
      });
    } catch (err) {
      console.warn('[Push] Failed to register token with backend:', err);
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[Push] Registration error:', err.error);
  });

  // Show foreground notifications as an in-app alert (Capacitor doesn't auto-show them)
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    const title = notification.title ?? 'Powiadomienie';
    const body = notification.body ?? '';
    // Simple console log in dev; on Android/iOS the system notification tray handles background ones
    console.info(`[Push] ${title}: ${body}`);
  });
}

/**
 * Call once after the user is authenticated to set up FCM push notifications.
 */
export function usePushNotifications(): void {
  useEffect(() => {
    void registerPushToken();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

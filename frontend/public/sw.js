/* Service Worker for Web Push notifications */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'MojeSaldoo', body: event.data.text() };
  }

  const title = payload.title || 'MojeSaldoo';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: payload.data || {},
    tag: payload.data?.invoice_number || 'mojesaldoo',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        if (windowClients.length > 0) {
          const client = windowClients[0];
          if (data.invoice_number) {
            client.postMessage({ type: 'navigate', path: '/invoices' });
          }
          return client.focus();
        }
        return clients.openWindow('/');
      })
  );
});

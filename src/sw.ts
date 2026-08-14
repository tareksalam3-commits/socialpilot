/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ------------------------------------------------------------------
// Precaching (app shell) — mirrors the old generateSW `workbox:` config.
// ------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
self.clients.claim();

// Offline-first SPA fallback: any navigation that isn't precached (deep
// link, refresh on a client route) still resolves to the cached app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// ------------------------------------------------------------------
// Runtime caching
// ------------------------------------------------------------------
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// Supabase auth/data must always be fresh — never served from cache.
registerRoute(({ url }) => url.hostname.endsWith('.supabase.co'), new NetworkOnly());

// ------------------------------------------------------------------
// Web Push
// ------------------------------------------------------------------
type PushPayload = {
  title?: string;
  body?: string;
  url?: string; // in-app path to open on click, e.g. /app/notifications
  tag?: string; // notifications with the same tag replace each other
  icon?: string;
  notificationId?: string;
};

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'SocialPilot AI', body: event.data?.text() ?? '' };
  }

  const title = payload.title || 'SocialPilot AI';
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    dir: 'auto',
    data: { url: payload.url || '/app/notifications', notificationId: payload.notificationId },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an already-open tab on the target route if one exists, otherwise
// open a new one — the standard "tap a push notification" behavior every
// native app gives you.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) || '/app/notifications';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await (existing as WindowClient).focus();
        (existing as WindowClient).navigate(targetUrl);
        return;
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// A push subscription can expire/rotate silently; when the browser tells us,
// re-subscribe with the same key and persist the new endpoint so the next
// push isn't silently dropped. Sending the update to Supabase happens from
// here (rather than only from the page) because this can fire while the app
// isn't open at all.
self.addEventListener('pushsubscriptionchange', (event: PushSubscriptionChangeEvent) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options.applicationServerKey;
      if (!applicationServerKey) return;
      const newSubscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clientsList[0];
      if (client) {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: newSubscription.toJSON() });
      }
    })(),
  );
});

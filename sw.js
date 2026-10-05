// Craft Spend — Offline-First Service Worker v1
const CACHE_NAME = 'craft-spend-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
  './favicon.png'
];

// Install: Pre-cache static assets and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching offline assets for Craft Spend');
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Could not pre-cache asset:', asset, err);
        }
      }
    })
  );
});

// Activate: Clean up older cache versions and take immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. External Supabase Cloud API calls: Network only (with offline 503 fallback)
  if (url.origin.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'offline', message: 'Offline mode: changes queued locally' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2. Navigation & HTML: Stale-While-Revalidate with guaranteed cache fallback
  const isHtml = event.request.mode === 'navigate' || 
                 (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) ||
                 url.pathname.endsWith('.html') ||
                 url.pathname === '/';

  if (isHtml) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          console.log('[SW] Network offline, serving cached app shell');
          const match = await caches.match(event.request)
                     || await caches.match('./index.html')
                     || await caches.match('./')
                     || await caches.match('/index.html')
                     || await caches.match('/');
          if (match) return match;
          return new Response('Craft Spend: Offline Ready', { status: 200, headers: { 'Content-Type': 'text/plain' } });
        })
    );
    return;
  }

  // 3. Static Assets: Cache-First with background revalidation
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});

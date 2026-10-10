// Mahumbezi PWA Service Worker
// Version: increment when changing cached assets or deployment
const CACHE_NAME = 'mahumbezi-v2';
const STATIC_CACHE = 'mahumbezi-static-v2';
const DYNAMIC_CACHE = 'mahumbezi-dynamic-v2';
const DATA_CACHE = 'mahumbezi-data-v2';

// Assets to cache on install (same-origin only - no CDN resources)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/logo.png',
  '/assets/favicon.png',
  '/assets/icons/icon-72x72.png',
  '/assets/icons/icon-96x96.png',
  '/assets/icons/icon-128x128.png',
  '/assets/icons/icon-144x144.png',
  '/assets/icons/icon-152x152.png',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-384x384.png',
  '/assets/icons/icon-512x512.png',
];

// API paths that should NEVER be cached
const EXCLUDED_PATHS = [
  '/api/',
  '/auth/',
  '/login',
  '/logout',
  '/refresh'
];

// Check if a request should be excluded from caching
function shouldExclude(url) {
  return EXCLUDED_PATHS.some(path => url.pathname.startsWith(path));
}

// Install event - cache static assets (same-origin only)
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => {
          // Only cache same-origin requests; skip cross-origin CDN resources
          if (new URL(url).origin === self.location.origin) {
            return new Request(url, { credentials: 'omit' });
          }
          // For cross-origin, just return a valid response to avoid install failure
          return new Response(null, { status: 200 });
        })).catch(err => {
          console.warn('[SW] Some static assets failed to cache:', err);
        });
      })
      .then(() => {
        console.log('[SW] Skip waiting on install');
        self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Keep only our cache names; delete everything else
              return name.startsWith('mahumbezi-');
            })
            .map((name) => {
              if (name !== STATIC_CACHE && name !== DYNAMIC_CACHE && name !== DATA_CACHE) {
                console.log('[SW] Deleting old cache:', name);
                return caches.delete(name);
              }
            })
        );
      })
      .then(() => {
        console.log('[SW] Clients claimed');
        return self.clients.claim();
      })
  );
});

// Fetch event - handle different request types appropriately
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip excluded paths (API, auth, login, logout, refresh)
  if (shouldExclude(url)) {
    // For excluded API paths, handle with network only, no caching
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      // Network-first for API responses, no caching
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            // Don't cache API responses
            return response;
          })
          .catch(() => {
            // For API requests offline, return error JSON
            if (url.pathname.startsWith('/api/')) {
              return new Response(
                JSON.stringify({ error: 'Offline' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            }
            return fetch(event.request);
          })
      );
    }
    return;
  }

  // Same-origin requests: proceed with caching strategy
  // Cross-origin requests: only handle our own CDN, skip everything else
  if (url.origin !== self.location.origin) {
    // For cross-origin requests that aren't our controlled resources, just fetch from network
    if (!url.pathname.startsWith('/assets/') && !url.pathname.endsWith('.webmanifest')) {
      // Skip third-party CDN and other cross-origin requests
      return;
    }
    // For same-origin assets and manifest, fall through to caching logic below
  }

  // Handle navigation requests (HTML pages) - network-first with cache fallback
  if (event.request.mode === 'navigate' || event.request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful navigation responses for offline use
          if (response.ok && response.type === 'basic') {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline fallback - serve cached homepage or offline page
          return caches.match('/index.html')
            .then((cached) => {
              if (cached) return cached;
              // If no cache, return basic offline response
              return new Response(
                '<html><body><h1>Offline</h1><p>Mahumbezi is offline. Please check your connection.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            });
        })
    );
    return;
  }

  // Handle static assets (CSS, JS, images, fonts, manifest)
  const isAsset = event.request.destination === 'style' ||
                 event.request.destination === 'script' ||
                 event.request.destination === 'image' ||
                 event.request.destination === 'font' ||
                 event.request.destination === 'manifest';

  if (isAsset) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached version, but also fetch fresh version in background
            fetch(event.request)
              .then((networkResponse) => {
                if (networkResponse.ok && networkResponse.type !== 'opaque') {
                  const responseClone = networkResponse.clone();
                  caches.open(STATIC_CACHE).then((cache) => {
                    try {
                      cache.put(event.request, responseClone);
                    } catch (e) {
                      // Cache might be full or offline
                    }
                  });
                }
              })
              .catch(() => {
                // Ignore fetch errors during background update
              });
            return cachedResponse;
          }
          // Not in cache, fetch from network
          return fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse.ok && networkResponse.type !== 'opaque') {
                const responseClone = networkResponse.clone();
                caches.open(STATIC_CACHE).then((cache) => {
                  cache.put(event.request, responseClone);
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // For images offline: return transparent placeholder
              if (event.request.destination === 'image') {
                return new Response('', { status: 404, headers: { 'Content-Type': 'image/png' } });
              }
              // For other assets offline: return fallback
              return new Response('Offline', { status: 503 });
            });
        })
    );
    return;
  }

  // For other requests (font, etc.), try network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Handle messages from clients (for SW control)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Background sync (optional enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOrders());
  }
});

async function syncOrders() {
  console.log('[SW] Background sync triggered');
}
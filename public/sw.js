// ============================================
// ALtoy Service Worker
// Caches static assets and data for faster loads
// ============================================

const CACHE_VERSION = 'v2.1';
const STATIC_CACHE = `altoy-static-${CACHE_VERSION}`;
const DATA_CACHE = `altoy-data-${CACHE_VERSION}`;

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
    '/altoy/js/utils.js',
    '/altoy/js/global.script.js'
];

// Install: pre-cache critical static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key =>
                    (key.startsWith('altoy-static-') || key.startsWith('altoy-data-')) &&
                    key !== STATIC_CACHE && key !== DATA_CACHE
                ).map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch strategy:
// - Data files (JSON): Network first, fallback to cache (stale-while-revalidate)
// - Static assets (JS/CSS/images): Cache first, fallback to network
// - External resources: Network only (don't cache CDN/GitHub raw)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip external resources (CDN, GitHub raw, fonts, analytics)
    if (url.origin !== self.location.origin) return;

    // Data files: stale-while-revalidate
    if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
        event.respondWith(staleWhileRevalidate(event.request, DATA_CACHE));
        return;
    }

    // Static assets: cache first
    if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/)) {
        event.respondWith(cacheFirst(event.request, STATIC_CACHE));
        return;
    }
});

/**
 * Cache-first strategy: serve from cache, fallback to network
 */
async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        return new Response('Offline', { status: 503 });
    }
}

/**
 * Stale-while-revalidate: serve from cache immediately,
 * update cache in background from network
 */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(() => cached);

    return cached || fetchPromise;
}

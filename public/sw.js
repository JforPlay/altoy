// ============================================
// ALtoy Service Worker
// Caches static assets and data for faster loads
// ============================================

const CACHE_VERSION = 'v3.9';
const STATIC_CACHE = `altoy-static-${CACHE_VERSION}`;
const DATA_CACHE = `altoy-data-${CACHE_VERSION}`;

// Derive base path from SW's own location (e.g. '/altoy' or '')
const BASE = self.location.pathname.replace(/\/sw\.js$/, '');

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
    `${BASE}/js/utils.js`,
    `${BASE}/js/global.script.js`
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
// - Data files (JSON): Stale-while-revalidate (serve cached, update in background)
// - JS/CSS: Stale-while-revalidate (serve cached, update in background)
// - Images/fonts: Cache first, fallback to network (content-addressed, rarely change)
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

    // JS/CSS: stale-while-revalidate (ensures updates propagate on next visit)
    if (url.pathname.match(/\.(js|css)$/)) {
        event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
        return;
    }

    // Images/fonts: cache first (content rarely changes at same URL)
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/)) {
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

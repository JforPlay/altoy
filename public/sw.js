// ============================================
// ALtoy Service Worker
// Caches static assets and data for faster loads
//
// CACHE_VERSION must stay in sync with public/js/utils.js DATA_VERSION (semver).
// Bump both whenever data files / deployed JS / CSS changes — a single bump
// invalidates BOTH the SW caches (here) AND the IndexedDB JSON cache (utils.js).
// See CLAUDE.md "Cache & Data Versioning" for the bump rules.
// ============================================

const CACHE_VERSION = '1.49.0';
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

// Activate: claim clients FIRST so any in-flight fetch sees the new SW, then
// clean up old caches. Previous order (clean → claim) left a brief window
// where the activating SW was responsible for fetches but had no claim yet.
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await self.clients.claim();
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(key =>
                (key.startsWith('altoy-static-') || key.startsWith('altoy-data-')) &&
                key !== STATIC_CACHE && key !== DATA_CACHE
            ).map(key => caches.delete(key))
        );
    })());
});

// Fetch strategy:
// - Data files (JSON): Stale-while-revalidate (serve cached, update in background)
// - JS/CSS: Network-first (fetch fresh, fall back to cache offline) — so a
//   DATA_VERSION/CACHE_VERSION bump takes effect on the NEXT load instead of
//   needing the stale-while-revalidate double-reload. utils.js is the version
//   oracle for the IndexedDB data cache, so it must not be served stale.
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

    // JS/CSS: network-first (fresh on next load; cache is the offline fallback)
    if (url.pathname.match(/\.(js|css)$/)) {
        event.respondWith(networkFirst(event.request, STATIC_CACHE));
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
 * Network-first: fetch fresh from the network (with `cache: 'no-cache'` so the
 * browser revalidates against the origin instead of honoring GitHub Pages'
 * fixed max-age), update the cache, and fall back to the cached copy only when
 * the network is unavailable. Keeps offline support while guaranteeing a
 * version bump is live on the next load.
 */
async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (e) {
        const cached = await cache.match(request);
        return cached || new Response('Offline', { status: 503 });
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

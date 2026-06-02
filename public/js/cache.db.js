/**
 * cache.db.js
 * IndexedDB-backed JSON cache for the ALtoy viewer — extracted from utils.js.
 *
 * Owns the `altoy-cache` IndexedDB store and the DATA_VERSION-gated invalidation
 * that guarantees users get fresh data after a deploy. utils.js re-exports
 * `fetchJSONWithCache` so existing callers (which import it from utils.js) are
 * unaffected.
 *
 * Depends on utils.js for DATA_VERSION (cache-busting key), getBasePath
 * (cache-key normalization), and fetchJSON (network fetch). This forms a
 * utils.js <-> cache.db.js import cycle, which is safe because nothing here runs
 * at import time: every cross-module symbol is read inside a function body (call
 * time), by which point both modules are fully initialized. The periodic purge is
 * scheduled from utils.js initUtils(), never at import.
 */

import { DATA_VERSION, getBasePath, fetchJSON } from './utils.js';

/**
 * IndexedDB cache for JSON data.
 * Caches fetched JSON in IndexedDB for fast repeat visits.
 * @namespace CacheDB
 */
const CacheDB = {
    DB_NAME: 'altoy-cache',
    DB_VERSION: 1,
    STORE_NAME: 'json-cache',
    _db: null,

    /**
     * Open (or reuse) the IndexedDB connection
     * @returns {Promise<IDBDatabase>}
     */
    async open() {
        if (this._db) return this._db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'url' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };

            request.onerror = (e) => {
                console.warn('IndexedDB open failed:', e.target.error);
                reject(e.target.error);
            };
        });
    },

    /**
     * Get cached data by URL key
     * @param {string} url - The cache key
     * @returns {Promise<{url: string, data: any, timestamp: number}|null>}
     */
    async get(url) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(url);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Store data in cache
     * @param {string} url - The cache key
     * @param {any} data - The data to cache
     * @returns {Promise<void>}
     */
    async put(url, data) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            store.put({ url, data, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    /**
     * Delete a specific cache entry
     * @param {string} url - The cache key to delete
     * @returns {Promise<void>}
     */
    async delete(url) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            store.delete(url);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    /**
     * Clear all cached data
     * @returns {Promise<void>}
     */
    async clear() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            store.clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    /**
     * Remove entries older than maxAge
     * @param {number} maxAge - Maximum age in milliseconds
     * @returns {Promise<number>} - Number of entries removed
     */
    async purgeOld(maxAge) {
        const db = await this.open();
        const cutoff = Date.now() - maxAge;
        let removed = 0;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const index = store.index('timestamp');
            const range = IDBKeyRange.upperBound(cutoff);
            const cursor = index.openCursor(range);

            cursor.onsuccess = (e) => {
                const c = e.target.result;
                if (c) {
                    c.delete();
                    removed++;
                    c.continue();
                }
            };

            tx.oncomplete = () => resolve(removed);
            tx.onerror = () => reject(tx.error);
        });
    }
};

/**
 * One-time check: if DATA_VERSION changed since last visit, clear all cached data.
 * This guarantees users always get fresh data after a deploy that bumps the version.
 */
let _cacheVersionChecked = false;
async function _ensureCacheVersion() {
    if (_cacheVersionChecked) return;
    _cacheVersionChecked = true;
    try {
        const key = '__data_version__';
        const cached = await CacheDB.get(key);
        if (!cached || cached.data !== DATA_VERSION) {
            await CacheDB.clear();
            await CacheDB.put(key, DATA_VERSION);
        }
    } catch (e) { /* IndexedDB unavailable, skip */ }
}

/**
 * Fetch JSON with IndexedDB caching.
 * On first load, fetches from network and stores in IndexedDB.
 * On subsequent loads, returns cached data if within maxAge.
 * Automatically clears all cached data when DATA_VERSION changes.
 *
 * @param {string} url - The URL to fetch (relative or absolute)
 * @param {Object} [options] - Cache options
 * @param {number} [options.maxAge=86400000] - Cache duration in ms (default: 24 hours)
 * @param {boolean} [options.forceRefresh=false] - Skip cache and fetch fresh data
 * @returns {Promise<any>} - The parsed JSON data
 */
export async function fetchJSONWithCache(url, options = {}) {
    const { maxAge = 24 * 60 * 60 * 1000, forceRefresh = false } = options;

    // Clear stale cache if DATA_VERSION changed (runs once per page load)
    await _ensureCacheVersion();

    // Resolve the URL for consistent cache keys
    let cacheKey = url;
    if (!url.startsWith('http') && !url.startsWith('/')) {
        cacheKey = `${getBasePath()}/${url}`;
    }

    // Try cache first (unless forced refresh)
    if (!forceRefresh) {
        try {
            const cached = await CacheDB.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < maxAge) {
                return cached.data;
            }
        } catch (e) {
            // IndexedDB unavailable, fall through to network
        }
    }

    // Fetch from network
    const data = await fetchJSON(url);

    // Store in cache (fire-and-forget — no await so we return data immediately)
    CacheDB.put(cacheKey, data).catch(() => {});

    return data;
}

/**
 * Clear all cached JSON data
 * @returns {Promise<void>}
 */
export async function clearJSONCache() {
    try {
        await CacheDB.clear();
    } catch (e) {
        console.warn('Failed to clear cache:', e);
    }
}

/**
 * Purge old cache entries (call periodically or on app start)
 * @param {number} [maxAge=604800000] - Max age in ms (default: 7 days)
 * @returns {Promise<number>} - Number of entries removed
 */
export async function purgeOldCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
        return await CacheDB.purgeOld(maxAge);
    } catch (e) {
        console.warn('Failed to purge cache:', e);
        return 0;
    }
}

/**
 * utils.js
 * Centralized utility library shared by all page scripts in the ALtoy viewer.
 * Loaded as an ES module via Layout.astro on every page; all page scripts import from here.
 * Provides: data fetching, IndexedDB caching, URL params, visibility, modals, search, toast,
 * cross-tab synchronized localStorage.
 */

// ===== Module Constants =====

/**
 * Centralized data version for IndexedDB cache invalidation (semver).
 * Bump this when ANY data file changes to force fresh fetches.
 * Used by fetchJSONWithCache — when this changes, the entire IndexedDB cache is cleared on next page load.
 *
 * Must stay in sync with public/sw.js CACHE_VERSION. Bumping just one
 * leaves the other cache stale on first visit. See CLAUDE.md "Cache & Data Versioning".
 */
const DATA_VERSION = '1.13.0';

/**
 * localStorage keys that participate in Google Drive sync.
 * Writing any of these keys via setStorageItem automatically flips
 * altoy:sync:localDirty to "1", signalling pending local changes.
 *
 * Synced: tracker progress, completion markers, collections, planners,
 * fleet sim saves, restaurant settings, season calculator quantities.
 *
 * NOT synced: UI preferences (theme, view-mode, active-tab, filter selections,
 * UI collapse states), IndexedDB version caches, buildSimulatorStats.
 *
 * When adding a new progress-tracking localStorage key in any consumer module,
 * add it to this Set so writes flip the dirty flag.
 */
const SYNCED_KEYS = new Set([
    // Shipgirl tracker (shared between shipgirl-tracker.js and research-tracker.js)
    'shipgirlTrackerProgress',
    'shipgirlTrackerSelectedGoal',
    'researchTrackerPinned',

    // Secretary story completion
    'secretaryStoryCompletion',

    // Skin collection
    'skinCollection',

    // Island restaurant calculator settings
    'island-restaurant-rank',
    'island-restaurant-events',
    'island-restaurant-shipgirl1',
    'island-restaurant-shipgirl2',

    // Island restaurant planner
    'island-restaurant-planner-plan-v2',
    'island-restaurant-planner-presets-v2',

    // Island season calculator (quantities + owned points are progress; pass-collapsed is UI)
    'island-season-quantities',
    'island-season-owned-points',

    // Island technology completion
    'island-tech-completion',

    // Fleet simulator saves
    'fleetSimSaves',
]);

// ===== Core Utilities =====

/**
 * Debounce function to limit the rate at which a function can fire.
 * Useful for search inputs, resize events, etc.
 * @param {Function} func - The function to debounce
 * @param {number} wait - The delay in milliseconds
 * @returns {Function} - The debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function to limit the execution of a function to once every X milliseconds.
 * Useful for scroll events, resize events, etc.
 * @param {Function} func - The function to throttle
 * @param {number} delay - The delay in milliseconds
 * @returns {Function} - The throttled function
 */
function throttle(func, delay) {
    let timeout = null;
    return function(...args) {
        if (timeout) return;
        timeout = setTimeout(() => {
            func.apply(this, args);
            timeout = null;
        }, delay);
    };
}

/**
 * Get the base path for the site (handles GitHub Pages deployment)
 * @returns {string} - The base path (e.g., '/altoy' or '')
 */
function getBasePath() {
    // Check if we're on GitHub Pages with /altoy base
    const path = window.location.pathname;
    if (path.startsWith('/altoy')) {
        return '/altoy';
    }
    return '';
}

/**
 * Resolve a relative URL with the base path
 * @param {string} url - The URL to resolve
 * @returns {string} - The resolved URL with base path
 */
function resolveUrl(url) {
    if (!url.startsWith('http') && !url.startsWith('/')) {
        return `${getBasePath()}/${url}`;
    }
    return url;
}

/**
 * Fetch a JSON resource with error handling
 * Automatically prepends base path for relative URLs
 * @param {string} url - The URL to fetch
 * @returns {Promise<any>} - The parsed JSON data
 */
async function fetchJSON(url) {
    let finalUrl = url;
    if (!url.startsWith('http') && !url.startsWith('/')) {
        finalUrl = `${getBasePath()}/${url}`;
    }
    const response = await fetch(finalUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${finalUrl}: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Format time from deciseconds to "Xh Ym Zs"
 * @param {number} deciseconds - Time in 1/10th of a second
 * @returns {string} - Formatted time string
 */
function formatTime(deciseconds) {
    if (!deciseconds) return '0s';

    const totalSeconds = deciseconds / 10;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
}

/**
 * Setup scroll-to-top button functionality
 * Shows button when user scrolls down 300px, hides when at top
 * Applies to pages that have #scroll-to-top element in HTML
 * @param {string} buttonId - The ID of the scroll-to-top button (default: 'scroll-to-top')
 */
function setupScrollToTop(buttonId = 'scroll-to-top') {
    const scrollToTopBtn = document.getElementById(buttonId);
    if (!scrollToTopBtn) return; // Exit gracefully if button doesn't exist

    const toggleButton = () => {
        if (window.scrollY > 300) {
            showElement(scrollToTopBtn, true);
        } else {
            hideElement(scrollToTopBtn, true);
        }
    };

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Guard against throttle not being defined yet (utils.js is self-contained)
    const handler = (typeof throttle === 'function')
        ? throttle(toggleButton, 100)
        : toggleButton;

    window.addEventListener('scroll', handler, { passive: true });
    scrollToTopBtn.addEventListener('click', scrollToTop);
    toggleButton();
}

/**
 * Common SVG fallback images for onerror handlers
 */
const IMG_FALLBACKS = {
    // Generic placeholder with "이미지 없음" text. Single quotes are %27-encoded —
    // the legacy inline-onerror path required it; harmless to keep.
    DEFAULT: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3Crect fill=%27%23ddd%27 width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27%3E?%3C/text%3E%3C/svg%3E",
    // Larger placeholder for card images
    CARD: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27250%27 height=%27200%27%3E%3Crect fill=%27%23ddd%27 width=%27250%27 height=%27200%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27%3E이미지 없음%3C/text%3E%3C/svg%3E",
    // Detail view placeholder
    DETAIL: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%27%23ddd%27 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27%3E이미지 없음%3C/text%3E%3C/svg%3E"
};

/**
 * Named img-error actions handled by the document-level capture listener installed below.
 * Strict CSP forbids inline `onerror=`, so callers describe the desired action via
 * `data-onfail="…"` (or `data-fallback="<url>"`) and the listener performs it.
 */
const IMG_ONFAIL_ACTIONS = {
    hide:          (img) => { img.style.display = 'none'; },
    'hide-parent': (img) => { if (img.parentElement) img.parentElement.style.display = 'none'; },
    dim:           (img) => { img.style.opacity = '0.3'; },
    invisible:     (img) => { img.style.visibility = 'hidden'; },
    // Used by patterns where an `<img>` is followed by a sibling fallback element
    // that is initially `display:none`; on error, hide the image and reveal the fallback.
    'swap-fallback': (img) => {
        img.style.display = 'none';
        if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    },
};

/**
 * Document-level fallback handler. The `error` event does not bubble, so we
 * listen in capture phase. Runs once per failed image; clears the attribute
 * afterwards so a fallback URL that itself fails won't loop.
 */
function handleImgError(e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;

    const fallback = img.getAttribute('data-fallback');
    if (fallback) {
        img.removeAttribute('data-fallback');
        img.src = fallback;
        return;
    }

    const action = img.getAttribute('data-onfail');
    if (action && IMG_ONFAIL_ACTIONS[action]) {
        img.removeAttribute('data-onfail');
        IMG_ONFAIL_ACTIONS[action](img);
    }
}
document.addEventListener('error', handleImgError, true);

/**
 * Escape characters that would break a double-quoted HTML attribute value.
 * Used by `createImg` because data-driven URLs/alt text may contain `&`, `"`, or `<`.
 * Prefer `createImgElement` over `createImg` when possible — it avoids string assembly entirely.
 */
function escapeHtmlAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

/**
 * Create an image HTML string with lazy loading.
 * Strict CSP forbids inline `onerror=`, so error behavior is encoded as data
 * attributes consumed by the global handler above.
 * Attribute values are escaped to prevent injection from data-driven inputs.
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text
 * @param {Object} options - Additional options
 * @param {string} options.className - CSS class(es)
 * @param {string} options.onFail - Named action: 'hide' | 'hide-parent' | 'dim' | 'invisible'
 * @param {string} options.fallback - Fallback image URL applied on first error
 * @param {string} options.title - Title attribute for tooltip
 * @param {boolean} options.eager - If true, load immediately (default: false/lazy)
 * @returns {string} - HTML string for the image
 */
function createImg(src, alt = '', options = {}) {
    const { className = '', onFail = '', fallback = '', title = '', eager = false } = options;
    const loading = eager ? 'eager' : 'lazy';
    const classAttr = className ? ` class="${escapeHtmlAttr(className)}"` : '';
    const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : '';

    let errorAttr = '';
    if (fallback) {
        errorAttr = ` data-fallback="${escapeHtmlAttr(fallback)}"`;
    } else if (onFail) {
        errorAttr = ` data-onfail="${escapeHtmlAttr(onFail)}"`;
    }

    return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" loading="${loading}"${classAttr}${titleAttr}${errorAttr}>`;
}

/**
 * Create an image element with lazy loading
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text
 * @param {Object} options - Additional options
 * @returns {HTMLImageElement} - Image element
 */
function createImgElement(src, alt = '', options = {}) {
    const { className = '', eager = false, onError = null, fallback = '' } = options;
    const img = new Image();
    img.src = src;
    img.alt = alt;
    img.loading = eager ? 'eager' : 'lazy';
    if (className) img.className = className;
    if (onError) {
        img.onerror = onError;
    } else if (fallback) {
        // Detach the handler before swapping in the fallback so a fallback that
        // also fails to load does NOT loop. The previous `img.src !== fallback`
        // guard was unreliable for relative fallback URLs because `img.src` returns
        // the resolved absolute URL after assignment.
        img.onerror = () => {
            img.onerror = null;
            img.src = fallback;
        };
    }
    return img;
}

/**
 * Create a Font Awesome icon element with `aria-hidden="true"` by default.
 * Decorative icons should be hidden from assistive tech; pass ariaHidden=false
 * for icons that convey meaning without an accompanying label.
 * @param {string} className - Icon class string (e.g., 'fas fa-play')
 * @param {Object} [options]
 * @param {boolean} [options.ariaHidden=true]
 * @returns {HTMLElement}
 */
function createIcon(className, { ariaHidden = true } = {}) {
    const icon = document.createElement('i');
    icon.className = className;
    if (ariaHidden) icon.setAttribute('aria-hidden', 'true');
    return icon;
}

/**
 * Create a Material Symbols Outlined icon span with `aria-hidden="true"` by default.
 * Sibling of `createIcon` for the Material Symbols icon family used across pages.
 * @param {string} name - Material Symbols glyph name (e.g., 'cake', 'celebration')
 * @param {Object} [options]
 * @param {boolean} [options.ariaHidden=true]
 * @param {string} [options.className=''] - Extra class(es) appended after `material-symbols-outlined`
 * @returns {HTMLSpanElement}
 */
function createMaterialIcon(name, { ariaHidden = true, className = '' } = {}) {
    const span = document.createElement('span');
    span.className = className
        ? `material-symbols-outlined ${className}`
        : 'material-symbols-outlined';
    if (ariaHidden) span.setAttribute('aria-hidden', 'true');
    span.textContent = name;
    return span;
}

/**
 * Create the shared gem-icon `<img>` element used across skin pages for price displays.
 * Always uses the canonical Ruby asset and the `gem-icon` class so visual treatment
 * stays consistent (sizing/drop-shadow lives in skin.common.css).
 * @returns {HTMLImageElement}
 */
function createGemIconImg() {
    const img = document.createElement('img');
    img.src = resolveUrl('assets/icon/60px-Ruby.webp');
    img.className = 'gem-icon';
    img.alt = 'Gem';
    return img;
}

// ===== Game item / material icons =====

/** Base for the JforPlay/data_for_toy icon host. */
const DATA_FOR_TOY_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main';

/**
 * Resolve an in-game item/material icon to its hosted webp URL.
 *
 * Accepts either a bare numeric item id (e.g. 18002 — treated as a `props`
 * item) or a config icon path (`Props/18002`, `Equips/85120`,
 * `islandprops/xxxx`). The `domain` argument overrides the folder for a bare
 * id ('props' | 'equips' | 'islandprops').
 *
 * @param {string|number} ref - item id, or a `Domain/id` path
 * @param {string} [domain='props'] - icon folder for a bare id
 * @returns {string} the webp URL, or '' for a falsy ref
 */
function getItemIconUrl(ref, domain = 'props') {
    if (ref === null || ref === undefined || ref === '') return '';
    const s = String(ref);
    const m = s.match(/^([A-Za-z]+)\/(.+)$/);
    if (m) {
        return `${DATA_FOR_TOY_BASE}/${m[1].toLowerCase()}/${m[2]}.webp`;
    }
    return `${DATA_FOR_TOY_BASE}/${domain}/${s}.webp`;
}

// ===== IndexedDB Caching =====

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
async function fetchJSONWithCache(url, options = {}) {
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
async function clearJSONCache() {
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
async function purgeOldCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
        return await CacheDB.purgeOld(maxAge);
    } catch (e) {
        console.warn('Failed to purge cache:', e);
        return 0;
    }
}

// ===== Storage Utilities =====

/**
 * Safely get item from localStorage.
 * Handles private browsing mode and permission errors.
 * @param {string} key - Storage key
 * @param {string} defaultValue - Default if unavailable
 * @returns {string} Stored value or default
 */
function getStorageItem(key, defaultValue) {
    try {
        return localStorage.getItem(key) || defaultValue;
    } catch (e) {
        console.warn('localStorage unavailable:', e);
        return defaultValue;
    }
}

/**
 * Safely set item in localStorage.
 * Handles private browsing mode and permission errors.
 * If key is in SYNCED_KEYS, also sets altoy:sync:localDirty="1"
 * so the Drive sync engine knows local data has changed.
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 */
function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, value);
        if (SYNCED_KEYS.has(key)) {
            // Keys duplicated in drive-sync.config.js STORAGE_KEYS. utils.js is
            // the foundational module (imported BY the sync module), so we can't
            // import from it without inverting the dependency direction.
            localStorage.setItem('altoy:sync:localDirty', '1');
            localStorage.setItem('altoy:sync:localDirtyAt', String(Date.now()));
        }
    } catch (e) {
        console.warn('localStorage unavailable:', e);
    }
}

// ===== Cross-Tab Synchronized Storage =====

/**
 * Cross-tab synchronized localStorage primitive.
 * Wraps localStorage with: storage-event subscription (cross-tab updates),
 * try/catch isolation, optional write debouncing, and optional schema versioning.
 *
 * Use this for any feature that wants other open tabs to see its writes
 * (trackers, planners, fleet sim saves, restaurant menus, etc.). Each feature
 * defines the *contract* (parse/onRemoteChange callbacks); this helper owns
 * the *transport* (storage event, JSON, envelope, debounce).
 *
 * Goes through setStorageItem on writes, so keys listed in SYNCED_KEYS
 * still trigger the Drive-sync dirty flag.
 *
 * @param {string} key - localStorage key. Caller defines the constant.
 * @param {object} options
 * @param {(value: any) => any} options.parse - Validate untrusted JS value (post-JSON.parse,
 *   post-envelope-unwrap) into clean state. Receives null when storage is empty/malformed.
 *   Must never throw — return a sane empty state for null input.
 * @param {(newState: any) => void} [options.onRemoteChange] - Called when another tab writes
 *   this key. Receives the post-parse state. Not called for writes from the current tab.
 * @param {number} [options.debounce] - If > 0, coalesce save() calls within this many ms.
 * @param {number} [options.version] - If set, wrap writes in {v, d} envelope. Lets future
 *   schema changes detect old payloads via `migrate`.
 * @param {(oldVersion: number, oldData: any) => any} [options.migrate] - Run on read when
 *   stored version differs. For legacy un-versioned payloads, oldVersion is 0.
 * @returns {{ load(): any, save(state: any): void, close(): void }}
 *
 * @example
 *   const store = syncedStorage('myFeatureProgress', {
 *       parse: (v) => (v && typeof v === 'object') ? v : {},
 *       onRemoteChange: (next) => { state = next; render(); },
 *       debounce: 200,
 *       version: 1,
 *   });
 *   state = store.load();
 *   store.save(state);
 */
function syncedStorage(key, options) {
    const {
        parse,
        onRemoteChange,
        debounce: debounceMs,
        version,
        migrate,
    } = options || {};

    if (!key || typeof parse !== 'function') {
        throw new Error('syncedStorage requires a key and a parse function');
    }

    function unwrap(raw) {
        if (raw == null || raw === '') return null;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return null;
        }
        if (version == null) return parsed;
        const isEnvelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            && 'v' in parsed && 'd' in parsed;
        if (isEnvelope) {
            if (parsed.v === version) return parsed.d;
            return typeof migrate === 'function' ? migrate(parsed.v, parsed.d) : parsed.d;
        }
        // Un-versioned (legacy) payload — let migrate decide what to do with it.
        return typeof migrate === 'function' ? migrate(0, parsed) : parsed;
    }

    function wrap(state) {
        const payload = version != null ? { v: version, d: state } : state;
        return JSON.stringify(payload);
    }

    function load() {
        try {
            return parse(unwrap(getStorageItem(key, null)));
        } catch (err) {
            console.error(`syncedStorage(${key}): load failed`, err);
            return parse(null);
        }
    }

    function writeNow(state) {
        try {
            setStorageItem(key, wrap(state));
        } catch (err) {
            console.error(`syncedStorage(${key}): save failed`, err);
        }
    }

    const save = debounceMs > 0 ? debounce(writeNow, debounceMs) : writeNow;

    function onStorage(e) {
        if (e.key !== key || typeof onRemoteChange !== 'function') return;
        // storage event fires only in OTHER tabs — always remote.
        try {
            onRemoteChange(parse(unwrap(e.newValue)));
        } catch (err) {
            console.error(`syncedStorage(${key}): onRemoteChange failed`, err);
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
    }

    return {
        load,
        save,
        close() {
            if (typeof window !== 'undefined') {
                window.removeEventListener('storage', onStorage);
            }
        },
    };
}

// ===== String Normalization =====

/**
 * Normalize ASCII Roman numerals (I-X) to Unicode equivalents.
 * Used for consistent shipgirl name matching across data sources.
 * Order matters: longer patterns must be replaced first to avoid partial matches.
 * @param {string} str - The string to normalize
 * @returns {string} - Normalized string with Unicode Roman numerals
 */
function normalizeRomanNumerals(str) {
    if (!str) return str;
    return str
        .replace(/VIII/g, 'Ⅷ')  // ASCII VIII → Roman numeral 8
        .replace(/VII/g, 'Ⅶ')   // ASCII VII → Roman numeral 7
        .replace(/VI/g, 'Ⅵ')    // ASCII VI → Roman numeral 6
        .replace(/III/g, 'Ⅲ')   // ASCII III → Roman numeral 3
        .replace(/II/g, 'Ⅱ')    // ASCII II → Roman numeral 2
        .replace(/IV/g, 'Ⅳ')    // ASCII IV → Roman numeral 4
        .replace(/IX/g, 'Ⅸ')    // ASCII IX → Roman numeral 9
        .replace(/X/g, 'Ⅹ')     // ASCII X → Roman numeral 10
        .replace(/V/g, 'Ⅴ')     // ASCII V → Roman numeral 5
        .trim();
}

// ===== URL Parameters =====

/**
 * Get a URL parameter value
 * @param {string} key - Parameter name
 * @param {string} defaultValue - Default value if not found
 * @returns {string|null} - Parameter value or default
 */
function getUrlParam(key, defaultValue = null) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) ?? defaultValue;
}

/**
 * Set URL parameters without page reload
 * @param {Object} params - Key-value pairs to set (null/undefined/'' removes the key)
 * @param {boolean|Object} options - true/false for replaceState (legacy), or options object
 * @param {boolean} [options.replace=true] - Use replaceState instead of pushState
 * @param {boolean} [options.clear=false] - Start from empty params (ignore current URL params)
 */
function setUrlParams(params, options = true) {
    const opts = typeof options === 'boolean' ? { replace: options } : options;
    const { replace = true, clear = false } = opts;
    const urlParams = clear ? new URLSearchParams() : new URLSearchParams(window.location.search);
    Object.entries(params).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
            urlParams.delete(key);
        } else {
            urlParams.set(key, value);
        }
    });
    const newUrl = `${window.location.pathname}${urlParams.toString() ? '?' + urlParams.toString() : ''}`;
    if (replace) {
        history.replaceState(null, '', newUrl);
    } else {
        history.pushState(null, '', newUrl);
    }
}

/**
 * Get all URL parameters as an object
 * @returns {Object} - All URL parameters
 */
function getAllUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const result = {};
    params.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

// ===== Visibility Utilities =====

/**
 * Show an element (remove hidden class, optionally add visible class)
 * @param {HTMLElement|string} element - Element or element ID
 * @param {boolean} addVisible - Also add 'visible' class (default: false)
 */
function showElement(element, addVisible = false) {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!el) return;
    el.classList.remove('hidden');
    if (addVisible) el.classList.add('visible');
}

/**
 * Hide an element (add hidden class, optionally remove visible class)
 * @param {HTMLElement|string} element - Element or element ID
 * @param {boolean} removeVisible - Also remove 'visible' class (default: false)
 */
function hideElement(element, removeVisible = false) {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!el) return;
    el.classList.add('hidden');
    if (removeVisible) el.classList.remove('visible');
}

/**
 * Toggle element visibility
 * @param {HTMLElement|string} element - Element or element ID
 * @param {boolean} [show] - Force show (true) or hide (false), or toggle if undefined
 */
function toggleElement(element, show) {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!el) return;
    if (show === undefined) {
        el.classList.toggle('hidden');
    } else if (show) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

// ===== Modal Utilities =====

// Reference-counted body-scroll lock and per-modal state (previously focused
// element, before-open overflow value). Stacked modals release the lock only
// when ALL of them have closed. `activeModalIds` makes open/close idempotent
// per modal — calling openModal('foo') twice without an intervening close
// won't double-increment the lock count.
const _modalState = {
    lockCount: 0,
    bodyOverflowSnapshot: null,
    previousFocus: new Map(),  // modalId → element (or null)
    activeModalIds: new Set(),
};

/**
 * Reference-counted body-scroll lock primitive.
 * Exported so non-modal slide-in panels (e.g. the equip detail aside) can
 * participate in the same lock count as openModal/closeModal — preventing
 * the lock from being released early when a stacked modal closes first.
 */
function lockBodyScroll() {
    if (_modalState.lockCount === 0) {
        _modalState.bodyOverflowSnapshot = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    _modalState.lockCount++;
}

function unlockBodyScroll() {
    if (_modalState.lockCount === 0) return;
    _modalState.lockCount--;
    if (_modalState.lockCount === 0) {
        document.body.style.overflow = _modalState.bodyOverflowSnapshot ?? '';
        _modalState.bodyOverflowSnapshot = null;
    }
}

/**
 * Open a modal dialog.
 * @param {string} modalId - The modal element ID
 * @param {Object} [options]
 * @param {boolean} [options.lockBody=true] - Prevent body scroll (reference-counted across stacked modals)
 * @param {boolean} [options.setAriaHidden=true] - Toggle aria-hidden on the modal
 * @param {boolean} [options.restoreFocus=false] - Record document.activeElement so closeModal can restore it
 * @param {boolean} [options.focusFirst=false] - Move focus to the first focusable element inside the modal
 * @param {Function} [options.onOpen] - Callback receiving the modal element after it opens
 */
function openModal(modalId, options = {}) {
    const {
        lockBody = true,
        setAriaHidden = true,
        restoreFocus = false,
        focusFirst = false,
        onOpen = null,
    } = options;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Idempotent per modal — repeat opens are no-ops so the body lock count
    // and previousFocus capture only happen once until a close.
    if (_modalState.activeModalIds.has(modalId)) {
        if (onOpen) onOpen(modal);
        return;
    }
    _modalState.activeModalIds.add(modalId);

    if (restoreFocus) {
        _modalState.previousFocus.set(modalId, document.activeElement);
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
    modal.classList.remove('hidden');
    if (setAriaHidden) modal.setAttribute('aria-hidden', 'false');

    if (lockBody) lockBodyScroll();

    if (focusFirst) {
        // First tabbable element inside the modal — buttons, links, inputs, etc.
        const focusable = modal.querySelector(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable) {
            // Defer until the modal is actually visible; some browsers no-op focus on display:none.
            requestAnimationFrame(() => focusable.focus());
        }
    }

    if (onOpen) onOpen(modal);
}

/**
 * Close a modal dialog.
 * @param {string} modalId - The modal element ID
 * @param {Object} [options]
 * @param {boolean} [options.unlockBody=true] - Release body-scroll lock (reference-counted)
 * @param {boolean} [options.setAriaHidden=true] - Toggle aria-hidden on the modal
 * @param {boolean} [options.restoreFocus=false] - Refocus the element captured by openModal
 * @param {Function} [options.onClose] - Callback receiving the modal element after it closes
 */
function closeModal(modalId, options = {}) {
    const {
        unlockBody = true,
        setAriaHidden = true,
        restoreFocus = false,
        onClose = null,
    } = options;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Match the idempotent guard in openModal — closing a modal that's not
    // tracked as open mustn't decrement the lock count.
    if (!_modalState.activeModalIds.has(modalId)) {
        if (onClose) onClose(modal);
        return;
    }
    _modalState.activeModalIds.delete(modalId);

    // Focus management must run BEFORE we set aria-hidden / display:none.
    // Setting aria-hidden on an ancestor of the focused element triggers a
    // browser a11y violation ("Blocked aria-hidden on an element because its
    // descendant retained focus"). If a previous-focus target was captured,
    // restore to it; otherwise blur the focused element so it leaves the
    // modal subtree before the ARIA attribute is applied.
    const previous = _modalState.previousFocus.get(modalId);
    _modalState.previousFocus.delete(modalId);
    const focusedInside = modal.contains(document.activeElement);
    if (restoreFocus && previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus();
    } else if (focusedInside && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }

    modal.style.display = 'none';
    modal.classList.remove('active');
    modal.classList.add('hidden');
    if (setAriaHidden) modal.setAttribute('aria-hidden', 'true');

    if (unlockBody) unlockBodyScroll();

    if (onClose) onClose(modal);
}

/**
 * Setup modal with common behaviors (close on backdrop click, ESC key).
 * @param {string} modalId - The modal element ID
 * @param {Object} [options]
 * @param {string}   [options.closeButtonSelector='.close-button, .modal-close']
 * @param {boolean}  [options.closeOnBackdrop=true]
 * @param {boolean}  [options.closeOnEscape=true]
 * @param {boolean}  [options.setAriaHidden=true] - Forwarded to closeModal
 * @param {boolean}  [options.restoreFocus=false] - Forwarded to closeModal
 * @param {Function} [options.onClose] - Forwarded to closeModal
 */
function setupModal(modalId, options = {}) {
    const {
        closeButtonSelector = '.close-button, .modal-close',
        closeOnBackdrop = true,
        closeOnEscape = true,
        setAriaHidden = true,
        restoreFocus = false,
        onClose = null,
    } = options;

    const modal = document.getElementById(modalId);
    if (!modal) return;

    const doClose = () => closeModal(modalId, { setAriaHidden, restoreFocus, onClose });

    const closeButtons = modal.querySelectorAll(closeButtonSelector);
    closeButtons.forEach(btn => {
        btn.addEventListener('click', doClose);
    });

    if (closeOnBackdrop) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) doClose();
        });
    }

    if (closeOnEscape) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                doClose();
            }
        });
    }
}

// ===== Dropdown / Autocomplete Helper =====

/**
 * Wire a text input to a dropdown of selectable options.
 * Handles: input/focus → open, typing → filter (substring),
 * Arrow Up/Down navigation, Enter/click selection, Escape close,
 * outside-click close, and the matching ARIA combobox attributes.
 *
 * Pages with custom dropdown markup pass a `renderItem(item)` callback
 * that returns the option element; the helper attaches the click+keyboard
 * wiring for them. Default rendering produces a `<button class="dropdown-option">`
 * matching the juustagram pattern.
 *
 * @param {Object} config
 * @param {HTMLInputElement} config.input - Input the user types into
 * @param {HTMLElement} config.dropdown - Container for rendered options
 * @param {Array} [config.items=[]] - Initial items (replace via the returned setItems)
 * @param {(item) => string} [config.getLabel] - Maps item → label (default: item.name)
 * @param {(item) => HTMLElement} [config.renderItem] - Custom option renderer
 * @param {(item) => void} config.onSelect - Selection handler
 * @param {(query: string) => void} [config.onInputChange] - Fired on every input
 * @param {string} [config.emptyMessage='결과 없음'] - Shown when filter has no matches
 * @param {string} [config.optionSelector='.dropdown-option'] - For keyboard nav lookup
 * @param {number} [config.maxResults=50] - Cap to avoid rendering huge lists
 * @returns {{ setItems(items): void, open(): void, close(): void, dispose(): void } | null}
 */
function setupDropdown(config) {
    const {
        input,
        dropdown,
        items = [],
        getLabel = (item) => item?.name ?? String(item ?? ''),
        renderItem,
        onSelect,
        onInputChange,
        emptyMessage = '결과 없음',
        optionSelector = '.dropdown-option',
        maxResults = 50,
    } = config || {};

    if (!input || !dropdown || typeof onSelect !== 'function') return null;

    let currentItems = Array.isArray(items) ? items : [];

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    if (dropdown.id) input.setAttribute('aria-controls', dropdown.id);
    input.setAttribute('aria-expanded', 'false');

    function defaultRenderItem(item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dropdown-option';
        button.setAttribute('role', 'option');
        button.textContent = getLabel(item);
        return button;
    }

    const renderFn = typeof renderItem === 'function' ? renderItem : defaultRenderItem;

    function filter(query) {
        const trimmed = String(query || '').trim().toLowerCase();
        if (!trimmed) return currentItems;
        return currentItems.filter(item => {
            const label = getLabel(item);
            return typeof label === 'string' && label.toLowerCase().includes(trimmed);
        });
    }

    function getOptions() {
        return [...dropdown.querySelectorAll(optionSelector)];
    }

    function render(filtered) {
        dropdown.replaceChildren();
        if (filtered.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'dropdown-empty';
            empty.textContent = emptyMessage;
            dropdown.appendChild(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        filtered.slice(0, maxResults).forEach((item) => {
            const el = renderFn(item);
            if (!(el instanceof HTMLElement)) return;
            el.addEventListener('click', () => {
                onSelect(item);
                close();
            });
            fragment.appendChild(el);
        });
        dropdown.appendChild(fragment);
    }

    function open() {
        dropdown.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
    }

    function close() {
        dropdown.classList.remove('open');
        input.setAttribute('aria-expanded', 'false');
    }

    function onInput() {
        render(filter(input.value));
        open();
        if (typeof onInputChange === 'function') onInputChange(input.value);
    }

    function onInputKeydown(event) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            open();
            getOptions()[0]?.focus();
        } else if (event.key === 'Escape') {
            close();
        }
    }

    function onDropdownKeydown(event) {
        const options = getOptions();
        const index = options.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            options[Math.min(index + 1, options.length - 1)]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (index <= 0) input.focus();
            else options[index - 1]?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
            input.focus();
        }
    }

    function onOutsideClick(event) {
        if (input.contains(event.target) || dropdown.contains(event.target)) return;
        close();
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onInputKeydown);
    dropdown.addEventListener('keydown', onDropdownKeydown);
    document.addEventListener('click', onOutsideClick);

    render(currentItems);

    return {
        setItems(next) {
            currentItems = Array.isArray(next) ? next : [];
            render(filter(input.value));
        },
        open,
        close,
        dispose() {
            input.removeEventListener('focus', open);
            input.removeEventListener('input', onInput);
            input.removeEventListener('keydown', onInputKeydown);
            dropdown.removeEventListener('keydown', onDropdownKeydown);
            document.removeEventListener('click', onOutsideClick);
        },
    };
}

// ===== Interaction Utilities =====

/**
 * Make a non-button element behave like a button: keyboard-activatable
 * via Enter or Space, with role and tabindex set correctly. Both click
 * and keyboard activation route through the same callback.
 *
 * Use for clickable <div>/<a> cards, gallery items, custom toggles, etc.
 * Don't use on real <button> or <a href="..."> — they're already activatable.
 *
 * @param {HTMLElement} element - The element to make activatable.
 * @param {(event: Event) => void} onActivate - Handler invoked on click or Enter/Space.
 * @param {Object} [options]
 * @param {string} [options.role='button'] - ARIA role to apply (e.g. 'button', 'checkbox', 'tab').
 *   Pass `null` to skip setting role (caller manages it).
 * @param {boolean} [options.preventDefault=true] - Call preventDefault() before invoking onActivate.
 *   Needed to stop Space-key page scroll; harmless for click on a div.
 */
function makeKeyboardActivatable(element, onActivate, options = {}) {
    const { role = 'button', preventDefault = true } = options;
    if (!element) return;

    if (role) element.setAttribute('role', role);
    if (!element.hasAttribute('tabindex')) element.tabIndex = 0;

    const activate = (event) => {
        if (preventDefault) event.preventDefault();
        onActivate(event);
    };
    element.addEventListener('click', activate);
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
}

// ===== Search Utilities =====

const FUSE_CDN_URL = 'https://cdn.jsdelivr.net/npm/fuse.js/dist/fuse.min.js';
let _fuseLoadPromise = null;

/**
 * Lazy-load Fuse.js. Resolves to the global `Fuse` constructor (also accessible
 * as `window.Fuse` after the call) or `null` if loading fails. Concurrent calls
 * share one network fetch via the cached promise.
 *
 * Pages that need fuzzy search should `await ensureFuse()` before calling
 * `createSearchIndex()`. Pages with substring fallbacks can keep them as
 * defense-in-depth — `ensureFuse()` resolves to `null` on a network error
 * (e.g. CDN outage), letting the fallback path engage.
 *
 * Reuses an existing `<script>` tag for the same URL if one is already in
 * the DOM (handles overlap with the eager Layout.astro script during the
 * staged migration).
 *
 * @returns {Promise<Function|null>}
 */
function ensureFuse() {
    if (typeof Fuse !== 'undefined') return Promise.resolve(Fuse);
    if (_fuseLoadPromise) return _fuseLoadPromise;

    _fuseLoadPromise = new Promise((resolve) => {
        const finish = () => resolve(typeof Fuse !== 'undefined' ? Fuse : null);

        const existing = document.querySelector(`script[src="${FUSE_CDN_URL}"]`);
        if (existing) {
            if (typeof Fuse !== 'undefined') {
                resolve(Fuse);
                return;
            }
            existing.addEventListener('load', finish, { once: true });
            existing.addEventListener('error', () => resolve(null), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = FUSE_CDN_URL;
        script.async = true;
        script.addEventListener('load', finish, { once: true });
        script.addEventListener('error', () => resolve(null), { once: true });
        document.head.appendChild(script);
    });

    return _fuseLoadPromise;
}

/**
 * Create a Fuse.js search index with common defaults.
 * Requires Fuse.js to be loaded — `await ensureFuse()` first to guarantee it.
 * Returns null silently if Fuse isn't available; callers handle that case
 * (substring fallback or deferred wrapper). Returning null is a normal
 * transient state under lazy loading, so no warning is emitted.
 * @param {Array} data - Array of items to search
 * @param {Object} options - Fuse.js options (keys required)
 * @returns {Fuse|null} - Fuse instance or null if Fuse not loaded yet
 * @see ensureFuse
 */
function createSearchIndex(data, options = {}) {
    if (typeof Fuse === 'undefined') return null;

    const defaultOptions = {
        threshold: 0.3,
        includeScore: true,
        includeMatches: true,
        ignoreLocation: true,
        ...options
    };

    return new Fuse(data, defaultOptions);
}

// ===== Toast Notifications =====

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'info', 'success', 'error' (default: 'info')
 * @param {number} duration - Duration in ms (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
    let toastContainer = document.getElementById('global-toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'global-toast-container';
        toastContainer.className = 'global-toast-container';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `global-toast toast-${type}`;
    toast.textContent = message;
    
    // Add icon based on type
    const icon = document.createElement('i');
    icon.className = 'fas';
    if (type === 'success') icon.classList.add('fa-check-circle');
    else if (type === 'error') icon.classList.add('fa-exclamation-circle');
    else icon.classList.add('fa-info-circle');
    
    toast.prepend(icon);

    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, duration);
}

/**
 * Drive an FPS counter into the given element via requestAnimationFrame, with
 * automatic pause/resume on tab visibility and teardown on `pagehide`.
 * @param {HTMLElement|null} fpsDisplay
 * @returns {() => void} A `stop` function for explicit teardown (HMR/tests).
 */
function setupFpsDisplay(fpsDisplay) {
    if (!fpsDisplay) return () => {};

    let lastTime = performance.now();
    let frameCount = 0;
    let fpsAnimId = null;

    const updateFPS = () => {
        const now = performance.now();
        frameCount++;
        if (now >= lastTime + 1000) {
            fpsDisplay.textContent = `FPS: ${Math.round((frameCount * 1000) / (now - lastTime))}`;
            frameCount = 0;
            lastTime = now;
        }
        fpsAnimId = requestAnimationFrame(updateFPS);
    };

    const start = () => {
        if (fpsAnimId) return;
        lastTime = performance.now();
        frameCount = 0;
        fpsAnimId = requestAnimationFrame(updateFPS);
    };

    const stop = () => {
        if (!fpsAnimId) return;
        cancelAnimationFrame(fpsAnimId);
        fpsAnimId = null;
    };

    const onVisibility = () => {
        if (document.hidden) stop();
        else start();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => {
        document.removeEventListener('visibilitychange', onVisibility);
        stop();
    }, { once: true });

    start();
    return stop;
}

// ===== DOM Lifecycle Utilities =====

/**
 * Verify all required DOM elements are present. Logs a diagnostic listing the
 * missing keys and returns false so callers can early-return cleanly. The element
 * map's keys serve as the diagnostic labels — pass `{ gallery, lightbox, ... }`
 * with shorthand property names for the most useful errors.
 * @param {Record<string, HTMLElement|null>} elements - Map of label → element ref
 * @param {string} [contextLabel='Page'] - Prefix for the diagnostic
 * @returns {boolean} True if every value is truthy
 */
function requireElements(elements, contextLabel = 'Page') {
    const missing = Object.entries(elements)
        .filter(([, el]) => !el)
        .map(([key]) => key);
    if (missing.length === 0) return true;
    console.error(`${contextLabel}: missing required DOM elements (${missing.join(', ')}). Initialization aborted.`);
    return false;
}

/**
 * Render a status/empty/error message into a container, replacing its children
 * with a single `<p>` element. Pass an empty `message` to clear without inserting.
 * The status element is given `class="page-status page-status-{type}"` so pages
 * can style each state via theme tokens. Container should have `aria-live` set
 * if its updates need to be announced.
 *
 * Used by pages that surface "no results", "loading", or "load failed" inside
 * the gallery container itself. Pages with a separate inline status banner can
 * keep updating that element directly — this helper is for the replace-children
 * pattern.
 *
 * @param {HTMLElement|null} container - Container to fill
 * @param {string} message - Text to display (empty string clears)
 * @param {'info'|'success'|'error'|'empty'|'loading'} [type='info']
 * @param {Object} [options]
 * @param {string} [options.tag='p'] - Element tag for the status node
 * @param {string} [options.className='page-status'] - Base class (variant suffix is auto-appended)
 * @returns {HTMLElement|null} The created status element, or null if nothing was rendered
 */
function renderStatus(container, message, type = 'info', options = {}) {
    const { tag = 'p', className = 'page-status' } = options;
    if (!container) return null;
    if (!message) {
        container.replaceChildren();
        return null;
    }
    const status = document.createElement(tag);
    status.className = type ? `${className} ${className}-${type}` : className;
    status.textContent = message;
    container.replaceChildren(status);
    return status;
}

/**
 * Observe `<img class="lazy" data-src="...">` descendants of `root` and swap
 * `data-src` to `src` when each enters the viewport. Falls back to immediate
 * load when IntersectionObserver is unavailable.
 *
 * Caller is responsible for cleanup: hold the returned observer and call
 * `.disconnect()` on `pagehide` (or before re-rendering the gallery).
 *
 * @param {HTMLElement|null} root - Element to scan for `img.lazy`
 * @param {Object} [options]
 * @param {string} [options.rootMargin='200px'] - Pre-load margin
 * @param {number} [options.threshold=0.01]
 * @param {boolean} [options.useViewportRoot=false] - Observe against viewport instead of `root`
 * @param {boolean} [options.addLoadedClass=true] - Add `loaded` class after src swap
 * @returns {IntersectionObserver|null} Observer to disconnect, or null if fallback was used
 */
function observeLazyImages(root, options = {}) {
    const { rootMargin = '200px', threshold = 0.01, useViewportRoot = false, addLoadedClass = true } = options;
    if (!root) return null;
    const lazyImages = root.querySelectorAll('img.lazy');
    if (lazyImages.length === 0) return null;

    const swap = (img) => {
        if (img.dataset.src) {
            img.src = img.dataset.src;
            delete img.dataset.src;
        }
        img.classList.remove('lazy');
        if (addLoadedClass) img.classList.add('loaded');
    };

    if (!('IntersectionObserver' in window)) {
        lazyImages.forEach(swap);
        return null;
    }

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            swap(entry.target);
            obs.unobserve(entry.target);
        });
    }, {
        root: useViewportRoot ? null : root,
        rootMargin,
        threshold,
    });

    lazyImages.forEach(img => observer.observe(img));
    return observer;
}

// ===== Initialization =====

// Safari pre-16.4 lacks requestIdleCallback. Fall back to setTimeout so module init never throws.
const _ric = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 100);

if (typeof indexedDB !== 'undefined') {
    _ric(() => purgeOldCache(), { timeout: 5000 });
    // Re-purge every 6h while the tab is open. Browsers throttle setInterval to
    // ~1Hz on hidden tabs, so the wake cost on a backgrounded tab is negligible
    // — but a tab kept open for days won't accumulate stale entries up to the
    // IndexedDB quota.
    setInterval(() => _ric(() => purgeOldCache(), { timeout: 5000 }), 6 * 60 * 60 * 1000);
}

// ===== ES Module Exports =====
export {
    // Module constants
    DATA_VERSION,

    // Core utilities
    debounce,
    throttle,
    getBasePath,
    resolveUrl,
    fetchJSON,
    formatTime,
    setupScrollToTop,

    // Image utilities
    IMG_FALLBACKS,
    createImg,
    createImgElement,
    createIcon,
    createMaterialIcon,
    createGemIconImg,
    getItemIconUrl,

    // Cache utilities (CacheDB / clearJSONCache / purgeOldCache are internal —
    // not exported; the recurring purge runs from the init block below)
    fetchJSONWithCache,

    // URL parameter utilities
    getUrlParam,
    setUrlParams,
    getAllUrlParams,

    // Visibility utilities
    showElement,
    hideElement,
    toggleElement,

    // Modal utilities
    openModal,
    closeModal,
    setupModal,
    lockBodyScroll,
    unlockBodyScroll,

    // Interaction utilities
    makeKeyboardActivatable,
    setupDropdown,

    // Storage utilities
    getStorageItem,
    setStorageItem,
    SYNCED_KEYS,
    syncedStorage,

    // String normalization
    normalizeRomanNumerals,

    // Search utilities
    createSearchIndex,
    ensureFuse,

    // Toast notifications
    showToast,

    // Performance display
    setupFpsDisplay,

    // DOM lifecycle utilities
    requireElements,
    renderStatus,
    observeLazyImages
};

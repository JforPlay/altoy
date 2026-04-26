/**
 * utils.js
 * Centralized utility library shared by all page scripts in the ALtoy viewer.
 * Loaded as an ES module via Layout.astro on every page; all page scripts import from here.
 * Provides: data fetching, IndexedDB caching, URL params, visibility, modals, search, toast,
 * cross-tab synchronized localStorage.
 */

// ===== Module Constants =====

/**
 * Centralized data version for IndexedDB cache invalidation.
 * Bump this when ANY data file changes to force fresh fetches.
 * Used by fetchJSONWithCache — when this changes, the entire IndexedDB cache is cleared on next page load.
 */
const DATA_VERSION = '1.3.1';

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

    window.addEventListener('scroll', handler);
    scrollToTopBtn.addEventListener('click', scrollToTop);
    toggleButton();
}

/**
 * Common SVG fallback images for onerror handlers
 */
const IMG_FALLBACKS = {
    // Generic placeholder with "이미지 없음" text
    // Single quotes encoded as %27 to avoid breaking onerror="this.src='...'" handlers
    DEFAULT: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3Crect fill=%27%23ddd%27 width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27%3E?%3C/text%3E%3C/svg%3E",
    // Larger placeholder for card images
    CARD: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27250%27 height=%27200%27%3E%3Crect fill=%27%23ddd%27 width=%27250%27 height=%27200%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27%3E이미지 없음%3C/text%3E%3C/svg%3E",
    // Detail view placeholder
    DETAIL: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%27%23ddd%27 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23999%27%3E이미지 없음%3C/text%3E%3C/svg%3E"
};

/**
 * Create an image HTML string with lazy loading
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text
 * @param {Object} options - Additional options
 * @param {string} options.className - CSS class(es)
 * @param {string} options.onerror - Error handler code (e.g., "this.style.display='none'")
 * @param {string} options.fallback - Fallback image URL for onerror (alternative to onerror)
 * @param {string} options.title - Title attribute for tooltip
 * @param {boolean} options.eager - If true, load immediately (default: false/lazy)
 * @returns {string} - HTML string for the image
 */
function createImg(src, alt = '', options = {}) {
    const { className = '', onerror = '', fallback = '', title = '', eager = false } = options;
    const loading = eager ? 'eager' : 'lazy';
    const classAttr = className ? ` class="${className}"` : '';
    const titleAttr = title ? ` title="${title}"` : '';

    // Support both onerror code and fallback URL
    let errorAttr = '';
    if (onerror) {
        errorAttr = ` onerror="${onerror}"`;
    } else if (fallback) {
        errorAttr = ` onerror="this.src='${fallback}'"`;
    }

    return `<img src="${src}" alt="${alt}" loading="${loading}"${classAttr}${titleAttr}${errorAttr}>`;
}

/**
 * Create an image element with lazy loading
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text
 * @param {Object} options - Additional options
 * @returns {HTMLImageElement} - Image element
 */
function createImgElement(src, alt = '', options = {}) {
    const { className = '', eager = false, onError = null } = options;
    const img = new Image();
    img.src = src;
    img.alt = alt;
    img.loading = eager ? 'eager' : 'lazy';
    if (className) img.className = className;
    if (onError) img.onerror = onError;
    return img;
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

/**
 * Open a modal dialog
 * @param {string} modalId - The modal element ID
 * @param {Object} options - Options
 * @param {boolean} options.lockBody - Prevent body scroll (default: true)
 * @param {Function} options.onOpen - Callback when modal opens
 */
function openModal(modalId, options = {}) {
    const { lockBody = true, onOpen = null } = options;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'flex';
    modal.classList.add('active');
    modal.classList.remove('hidden');

    if (lockBody) {
        document.body.style.overflow = 'hidden';
    }

    if (onOpen) onOpen(modal);
}

/**
 * Close a modal dialog
 * @param {string} modalId - The modal element ID
 * @param {Object} options - Options
 * @param {boolean} options.unlockBody - Restore body scroll (default: true)
 * @param {Function} options.onClose - Callback when modal closes
 */
function closeModal(modalId, options = {}) {
    const { unlockBody = true, onClose = null } = options;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'none';
    modal.classList.remove('active');
    modal.classList.add('hidden');

    if (unlockBody) {
        document.body.style.overflow = '';
    }

    if (onClose) onClose(modal);
}

/**
 * Setup modal with common behaviors (close on backdrop click, ESC key)
 * @param {string} modalId - The modal element ID
 * @param {Object} options - Options
 * @param {string} options.closeButtonSelector - Selector for close button (default: '.close-button, .modal-close')
 * @param {boolean} options.closeOnBackdrop - Close when clicking backdrop (default: true)
 * @param {boolean} options.closeOnEscape - Close on ESC key (default: true)
 * @param {Function} options.onClose - Callback when modal closes (passed to closeModal)
 */
function setupModal(modalId, options = {}) {
    const {
        closeButtonSelector = '.close-button, .modal-close',
        closeOnBackdrop = true,
        closeOnEscape = true,
        onClose = null
    } = options;

    const modal = document.getElementById(modalId);
    if (!modal) return;

    const doClose = () => closeModal(modalId, { onClose });

    // Close button handler
    const closeButtons = modal.querySelectorAll(closeButtonSelector);
    closeButtons.forEach(btn => {
        btn.addEventListener('click', doClose);
    });

    // Backdrop click handler
    if (closeOnBackdrop) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) doClose();
        });
    }

    // ESC key handler
    if (closeOnEscape) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                doClose();
            }
        });
    }
}

// ===== Search Utilities =====

/**
 * Create a Fuse.js search index with common defaults
 * Requires Fuse.js to be loaded
 * @param {Array} data - Array of items to search
 * @param {Object} options - Fuse.js options (keys required)
 * @returns {Fuse|null} - Fuse instance or null if Fuse not available
 */
function createSearchIndex(data, options = {}) {
    if (typeof Fuse === 'undefined') {
        console.warn('Fuse.js not loaded. Search functionality disabled.');
        return null;
    }

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

// ===== Initialization =====

// Auto-purge old cache entries on page load (7 days)
if (typeof indexedDB !== 'undefined') {
    requestIdleCallback(() => purgeOldCache(), { timeout: 5000 });
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

    // Cache utilities
    CacheDB,
    fetchJSONWithCache,
    clearJSONCache,
    purgeOldCache,

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

    // Storage utilities
    getStorageItem,
    setStorageItem,
    SYNCED_KEYS,
    syncedStorage,

    // String normalization
    normalizeRomanNumerals,

    // Search utilities
    createSearchIndex,

    // Toast notifications
    showToast
};
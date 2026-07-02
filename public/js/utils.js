/**
 * utils.js
 * Centralized utility library shared by all page scripts in the ALtoy viewer.
 * Loaded as an ES module via Layout.astro on every page; all page scripts import from here.
 * Provides: data fetching, IndexedDB caching, URL params, visibility, modals, search, toast,
 * cross-tab synchronized localStorage.
 *
 * The IndexedDB cache (./cache.db.js) and cross-tab syncedStorage
 * (./synced-storage.js) live in sibling modules and are re-exported below.
 * Importing utils.js has NO side effects — call initUtils() once from global.init.js.
 */

import { fetchJSONWithCache, purgeOldCache } from './cache.db.js';
import { syncedStorage } from './synced-storage.js';

// ===== Module Constants =====

/**
 * Centralized data version for IndexedDB cache invalidation (semver).
 * Bump this when ANY data file changes to force fresh fetches.
 * Used by fetchJSONWithCache — when this changes, the entire IndexedDB cache is cleared on next page load.
 *
 * Must stay in sync with public/sw.js CACHE_VERSION. Bumping just one
 * leaves the other cache stale on first visit. See CLAUDE.md "Cache & Data Versioning".
 */
const DATA_VERSION = '1.43.1';

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

    // BGM misc player (queue + repeat + shuffle)
    'bgm-misc-player',
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
// The capture-phase listener for handleImgError is registered in initUtils()
// (not at import time) so importing utils.js stays side-effect-free.

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

/** Base for the JforPlay/data_for_toy asset host (icons, illustrations, audio, …). */
export const DATA_FOR_TOY_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main';

/**
 * Build a data_for_toy asset URL from a repo-relative path.
 * Centralizes the CDN host so it lives in exactly one place.
 * @param {string} path - e.g. "memoryicon/akashi.webp" (a leading slash is fine)
 * @returns {string} absolute raw.githubusercontent URL
 */
export function dataForToyUrl(path) {
    return `${DATA_FOR_TOY_BASE}/${String(path).replace(/^\/+/, '')}`;
}

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

// ===== Rarity =====

/** Canonical rarity rank, rarest first (UR=0 … N=4). Lower value = rarer. */
export const RARITY_ORDER = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };

/** Canonical rarity tiers, rarest → most common. */
export const RARITY_TIERS_DESC = ['UR', 'SSR', 'SR', 'R', 'N'];

/**
 * Sort comparator by rarity, rarest first. Unknown rarities sort last.
 * @param {string} a @param {string} b @returns {number}
 */
export function compareByRarity(a, b) {
    return (RARITY_ORDER[a] ?? 99) - (RARITY_ORDER[b] ?? 99);
}

/**
 * Escape a value for safe interpolation into HTML text or a double-quoted
 * attribute. Full &<>"' set — safe in both contexts. Mirrors the former
 * per-page copies (equip.upgrade / shipgirl-info / fleet-sim.ui / skill-search).
 * @param {*} value @returns {string}
 */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

/**
 * Sanitize an arbitrary value into a safe CSS class token.
 * Strips everything outside [A-Za-z0-9_-]. Mirrors the former per-page copies.
 * @param {string} value @returns {string}
 */
export function sanitizeClassToken(value) {
    return String(value ?? '').replace(/[^a-z0-9_-]/gi, '');
}

// ===== IndexedDB Caching =====
//
// The IndexedDB JSON cache (CacheDB, fetchJSONWithCache, clearJSONCache,
// purgeOldCache) lives in ./cache.db.js. utils.js imports fetchJSONWithCache +
// purgeOldCache from there: fetchJSONWithCache is re-exported below; purgeOldCache
// is scheduled by initUtils(). The utils <-> cache.db import cycle is import-safe
// (no cross-module reads at module-eval time).

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
//
// The syncedStorage primitive lives in ./synced-storage.js (it builds on
// getStorageItem/setStorageItem + debounce, which stay here). utils.js imports
// and re-exports syncedStorage below. SYNCED_KEYS stays in this module (its only
// consumer is setStorageItem above).

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
/**
 * Modal elements already wired by setupModal. Repeat calls on the same element
 * are no-ops — without this, each call stacks another document-level Escape
 * listener and re-binds close buttons. Keyed on the element (not the id) so a
 * re-rendered replacement modal still gets wired.
 */
const setupModalRegistry = new WeakSet();

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
    if (setupModalRegistry.has(modal)) return;
    setupModalRegistry.add(modal);

    const doClose = () => closeModal(modalId, { setAriaHidden, restoreFocus, onClose });

    const closeButtons = modal.querySelectorAll(closeButtonSelector);
    closeButtons.forEach(btn => {
        btn.addEventListener('click', doClose);
    });

    if (closeOnBackdrop) {
        // Close only when BOTH the press and the release land on the backdrop.
        // A `click` targets the common ancestor of its mousedown/mouseup nodes, so a
        // text-selection drag that starts in the dialog and ends on the dim area would
        // otherwise resolve to the overlay and wrongly close the modal. Pairing the
        // down/up targets also makes the intended click-to-close work for markup that
        // uses a dedicated `.modal-backdrop` child (where the overlay never is e.target).
        const isBackdrop = (node) =>
            node === modal || (node instanceof Element && node.classList.contains('modal-backdrop'));
        let pressedOnBackdrop = false;
        modal.addEventListener('mousedown', (e) => {
            pressedOnBackdrop = isBackdrop(e.target);
        });
        modal.addEventListener('mouseup', (e) => {
            if (pressedOnBackdrop && isBackdrop(e.target)) doClose();
            pressedOnBackdrop = false;
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

// ===== File Download =====

/**
 * Make a string safe for use as a filename across Windows / macOS / Linux.
 * Strips reserved characters, collapses whitespace, caps length, and falls
 * back to a sensible default for empty input.
 * @param {string} name
 * @param {string} [fallback='image']
 * @returns {string}
 */
function sanitizeFilename(name, fallback = 'image') {
    if (!name) return fallback;
    const cleaned = String(name)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
    return cleaned || fallback;
}

/**
 * Decode a base64 `data:` URL into a Blob without going through fetch().
 * The CSP `connect-src` directive doesn't list `data:`, so fetch() on a data
 * URL is blocked — atob + Uint8Array is the CSP-safe path.
 * @param {string} dataUrl
 * @returns {Blob}
 */
function dataUrlToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/**
 * Trigger a browser download for an image given its URL.
 *
 * Why this exists: canvas-derived `data:` URLs (used by the expression
 * composite lightboxes) don't reliably surface the long-press "Save Image"
 * menu on mobile — iOS Safari and Chrome Android frequently show no menu at
 * all for large data URLs. Converting to a Blob → object URL → `<a download>`
 * is the reliable cross-platform save path. Data URLs are decoded directly
 * (CSP blocks fetch on `data:`); http(s) sources go through fetch.
 *
 * @param {string} src - image URL (data: or http(s))
 * @param {string} [filename='image.png'] - suggested filename
 * @returns {Promise<boolean>} resolves true on success
 */
async function downloadImage(src, filename = 'image.png') {
    if (!src) return false;
    try {
        const blob = src.startsWith('data:')
            ? dataUrlToBlob(src)
            : await (await fetch(src)).blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke on next tick so the browser has finished kicking off the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    } catch (e) {
        console.warn('Image download failed', e);
        return false;
    }
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

// Default leading icon per status type (loading uses the .spinner instead).
const STATUS_ICONS = { empty: 'inbox', error: 'error', success: 'check_circle' };

/**
 * Render a status/empty/error/loading state into a container, replacing its
 * children with the canonical `.page-status` component (components/status.css):
 * a leading visual + a `.page-status-msg` text line. The visual is a `.spinner`
 * for `loading`, otherwise a Material-symbols icon (empty → inbox, error →
 * error, success → check_circle; override via `options.icon`, suppress with
 * `options.icon = ''`). Pass an empty `message` to clear without inserting.
 * Give the container `aria-live` if its updates need to be announced.
 *
 * This is the ONE site-wide status renderer — pages must not hand-roll their
 * own loading/empty/error markup or CSS.
 *
 * @param {HTMLElement|null} container - Container to fill
 * @param {string} message - Text to display (empty string clears)
 * @param {'info'|'success'|'error'|'empty'|'loading'} [type='info']
 * @param {Object} [options]
 * @param {string} [options.className='page-status'] - Base class (variant suffix auto-appended)
 * @param {string} [options.icon] - Material-symbols glyph override ('' suppresses the icon)
 * @param {boolean} [options.compact=false] - Add the --compact modifier (small icon, tight padding)
 * @returns {HTMLElement|null} The created `.page-status` element, or null if nothing was rendered
 */
function renderStatus(container, message, type = 'info', options = {}) {
    const { className = 'page-status', icon, compact = false } = options;
    if (!container) return null;
    if (!message) {
        container.replaceChildren();
        return null;
    }
    const status = document.createElement('div');
    status.className = type ? `${className} ${className}-${type}` : className;
    if (compact) status.classList.add(`${className}--compact`);
    status.setAttribute('role', 'status');

    // Leading visual: a spinner for loading; otherwise a Material icon.
    if (type === 'loading') {
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        status.appendChild(spinner);
    } else {
        const glyph = icon !== undefined ? icon : STATUS_ICONS[type];
        if (glyph) {
            const iconEl = document.createElement('span');
            iconEl.className = 'material-symbols-outlined page-status-icon';
            iconEl.textContent = glyph;
            iconEl.setAttribute('aria-hidden', 'true');
            status.appendChild(iconEl);
        }
    }

    const msg = document.createElement('p');
    msg.className = `${className}-msg`;
    msg.textContent = message;
    status.appendChild(msg);

    container.replaceChildren(status);
    return status;
}

/**
 * Standard page-data bootstrap: shows a loading status in `container`, runs
 * `load()`, and on failure replaces it with a standardized error message plus
 * a retry button that re-runs `load()`. Resolves with load()'s return value
 * once it (eventually) succeeds, so page init stays linear:
 *
 *   const data = await loadPageData(() => fetchJSONWithCache('data/x.json'), listEl,
 *       { contextLabel: 'My page' });
 *   if (data === null) return; // only when container is missing
 *   render(data);
 *
 * The loader must THROW (reject) on failure — don't pre-catch inside it.
 * On success the container is cleared; render content into it right after.
 * Without a container there is nowhere to mount the retry UI, so a failure
 * resolves null and the caller should abort init.
 *
 * @template T
 * @param {() => Promise<T>} load - Data loader; rejects on failure
 * @param {HTMLElement|null} container - Status host (the page's list/gallery/status element)
 * @param {Object} [options]
 * @param {string} [options.loadingMessage='데이터를 불러오는 중...']
 * @param {string} [options.errorMessage='데이터를 불러오지 못했습니다.']
 * @param {string} [options.retryLabel='다시 시도']
 * @param {string} [options.contextLabel='Page'] - Console diagnostic prefix
 * @param {(err: Error) => void} [options.onError] - Per-attempt failure hook (toast etc.)
 * @returns {Promise<T|null>}
 */
function loadPageData(load, container, options = {}) {
    const {
        loadingMessage = '데이터를 불러오는 중...',
        errorMessage = '데이터를 불러오지 못했습니다.',
        retryLabel = '다시 시도',
        contextLabel = 'Page',
        onError,
    } = options;

    return new Promise((resolve) => {
        const attempt = async () => {
            renderStatus(container, loadingMessage, 'loading');
            try {
                const data = await load();
                renderStatus(container, '');
                resolve(data);
            } catch (err) {
                console.error(`${contextLabel}: data load failed`, err);
                if (typeof onError === 'function') onError(err);
                const status = renderStatus(container, errorMessage, 'error');
                if (!status) { resolve(null); return; }
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'page-status-retry';
                retry.textContent = retryLabel;
                retry.addEventListener('click', attempt, { once: true });
                status.appendChild(retry);
            }
        };
        attempt();
    });
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

// ===== Theme =====

let _themeObserver = null;
let _themeIsDark = null;
const _themeListeners = new Set();

/**
 * Subscribe to dark-mode toggles. CSS handles theme switches declaratively, but
 * canvas/Chart.js pages bake colors in at draw time and must redraw — use this
 * instead of a per-page MutationObserver on body's class.
 *
 * The single shared observer is created lazily on first subscription (keeps the
 * module side-effect-free on import) and filters out unrelated body-class
 * changes, so callbacks fire only when `dark-mode` actually flips.
 *
 * @param {(isDark: boolean) => void} callback - Invoked with the new state
 * @returns {() => void} Unsubscribe function
 */
function onThemeChange(callback) {
    _themeListeners.add(callback);
    if (!_themeObserver && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        _themeIsDark = document.body.classList.contains('dark-mode');
        _themeObserver = new MutationObserver(() => {
            const isDark = document.body.classList.contains('dark-mode');
            if (isDark === _themeIsDark) return;
            _themeIsDark = isDark;
            _themeListeners.forEach(listener => {
                try {
                    listener(isDark);
                } catch (err) {
                    console.error('onThemeChange listener failed:', err);
                }
            });
        });
        _themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    return () => _themeListeners.delete(callback);
}

// ===== Initialization =====

// Safari pre-16.4 lacks requestIdleCallback. Fall back to setTimeout so init never throws.
const _ric = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 100);

let _initialized = false;
/**
 * Register utils.js's runtime side effects. Call ONCE per page — global.init.js
 * does this on every page. Kept out of module-eval so importing utils.js (or
 * anything importing it) is side-effect-free and safe in a non-DOM context such
 * as node tests.
 *
 * Registers the document-level image-error fallback handler (data-fallback /
 * data-onfail) and schedules the periodic IndexedDB stale-entry purge.
 */
function initUtils() {
    if (_initialized) return;
    _initialized = true;

    // Image fallback handler. The `error` event doesn't bubble — listen in capture phase.
    if (typeof document !== 'undefined') {
        document.addEventListener('error', handleImgError, true);
    }

    // Periodic IndexedDB cache purge.
    if (typeof indexedDB !== 'undefined') {
        _ric(() => purgeOldCache(), { timeout: 5000 });
        // Re-purge every 6h while the tab is open. Browsers throttle setInterval to
        // ~1Hz on hidden tabs, so the wake cost on a backgrounded tab is negligible
        // — but a tab kept open for days won't accumulate stale entries up to the
        // IndexedDB quota.
        setInterval(() => _ric(() => purgeOldCache(), { timeout: 5000 }), 6 * 60 * 60 * 1000);
    }
}

// ===== ES Module Exports =====
export {
    // Module constants
    DATA_VERSION,

    // Initialization (call once per page from global.init.js)
    initUtils,

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

    // Cache utilities — implemented in ./cache.db.js, re-exported here.
    // (CacheDB / clearJSONCache / purgeOldCache stay internal to that module;
    //  the recurring purge is scheduled from initUtils().)
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

    // File download
    downloadImage,
    sanitizeFilename,

    // Performance display
    setupFpsDisplay,

    // DOM lifecycle utilities
    requireElements,
    renderStatus,
    loadPageData,
    observeLazyImages,

    // Theme
    onThemeChange
};

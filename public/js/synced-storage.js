/**
 * synced-storage.js
 * Cross-tab synchronized localStorage primitive — extracted from utils.js.
 *
 * Owns the transport: storage-event subscription (cross-tab updates), try/catch
 * isolation, optional write debouncing, and the optional {v, d} schema envelope.
 * utils.js re-exports `syncedStorage` so existing callers are unaffected.
 *
 * Depends on utils.js for getStorageItem / setStorageItem (localStorage I/O — and
 * setStorageItem's SYNCED_KEYS dirty-flag hook for Drive sync) and debounce. The
 * utils.js <-> synced-storage.js import cycle is safe: every cross-module symbol
 * is read inside a function body, never at import time.
 */

import { getStorageItem, setStorageItem, debounce } from './utils.js';

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
export function syncedStorage(key, options) {
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
